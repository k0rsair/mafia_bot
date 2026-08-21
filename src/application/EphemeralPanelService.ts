import type { Game, Player } from '@prisma/client';

import { renderRoleConfirmation, renderRolePanel } from '../bot/views/ephemeralPanelView.js';
import type { AppLogger } from '../observability/logger.js';
import type { TelegramEphemeralAdapter } from '../bot/telegram/ephemeral.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { PhaseService } from './PhaseService.js';
import type { NightActionService } from './NightActionService.js';
import { CallbackGuardService } from './CallbackGuardService.js';

export class EphemeralPanelError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EphemeralPanelError';
  }
}

type PanelInput = Readonly<{
  gameId: string;
  phaseVersion: number;
  chatId: string;
  userId: string;
  callbackQueryId?: string;
}>;

type PanelCallbackInput = PanelInput & Readonly<{
  callbackQueryId: string;
}>;

export class EphemeralPanelService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly phaseService: PhaseService,
    private readonly nightActionService: NightActionService,
    private readonly ephemeralAdapter: TelegramEphemeralAdapter,
    private readonly logger: AppLogger,
    private readonly callbackGuard: CallbackGuardService = new CallbackGuardService(),
  ) {}

  public async openPanel(input: PanelCallbackInput): Promise<void> {
    const game = await this.gameRepository.findById(input.gameId);
    if (game?.phase === 'NIGHT' && game.stateVersion === input.phaseVersion) {
      await this.nightActionService.openNightPanel(input);
      return;
    }

    await this.openRolePanel(input);
  }

  public async restorePanel(input: Readonly<{ gameId: string; chatId: string; userId: string }>): Promise<void> {
    this.logger.debug({ gameId: input.gameId, chatId: input.chatId, userId: input.userId }, '[EphemeralPanelService.restorePanel] Restoring personal panel');
    const game = await this.gameRepository.findById(input.gameId);
    if (game === null) {
      this.logger.warn({ gameId: input.gameId, chatId: input.chatId, userId: input.userId }, '[EphemeralPanelService.restorePanel] Game was not found');
      throw new EphemeralPanelError('Активная игра не найдена.');
    }

    const panelInput = { ...input, phaseVersion: game.stateVersion };
    if (game.phase === 'NIGHT') {
      await this.nightActionService.openNightPanel(panelInput);
      this.logger.info({ gameId: game.id, phase: game.phase }, '[EphemeralPanelService.restorePanel] Personal panel restored');
      return;
    }
    if (game.phase !== 'ROLE_CONFIRMATION') {
      this.logger.warn({ gameId: game.id, phase: game.phase }, '[EphemeralPanelService.restorePanel] Panel restoration rejected outside private-panel phase');
      throw new EphemeralPanelError('Личную панель можно восстановить только во время подтверждения ролей или ночью.');
    }

    await this.openRolePanel(panelInput);
    this.logger.info({ gameId: game.id, phase: game.phase }, '[EphemeralPanelService.restorePanel] Personal panel restored');
  }

  private async openRolePanel(input: PanelInput): Promise<void> {
    const { game, player } = await this.getRoleConfirmationPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role === null) {
      throw new EphemeralPanelError('Роль ещё не назначена. Попробуйте позже.');
    }

    const panel = renderRolePanel({ gameId: game.id, phaseVersion: game.stateVersion, role: player.role });
    await this.ephemeralAdapter.sendText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }),
      text: panel.text,
      replyMarkup: panel.replyMarkup,
    });
    this.logger.debug({ gameId: game.id, phase: game.phase }, '[EphemeralPanelService.openRolePanel] Role panel opened');
  }

  public async confirmRole(input: PanelCallbackInput): Promise<Readonly<{ nightStarted: boolean; nightGame?: Game }>> {
    const { game, player } = await this.getRoleConfirmationPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    const confirmed = await this.playerRepository.confirmRole(game.id, player.userId);
    const confirmedCount = await this.playerRepository.countRoleConfirmations(game.id);
    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);

    await this.ephemeralAdapter.sendText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      callbackQueryId: input.callbackQueryId,
      text: renderRoleConfirmation(),
    });

    if (confirmedCount !== alivePlayers.length) {
      this.logger.info({ gameId: game.id, confirmedCount, playerCount: alivePlayers.length, confirmed }, '[EphemeralPanelService.confirmRole] Waiting for role confirmations');
      return { nightStarted: false };
    }

    const night = await this.phaseService.startNight(game);
    this.logger.info({ gameId: game.id, nightStarted: night !== null }, '[EphemeralPanelService.confirmRole] All roles confirmed');
    return night === null ? { nightStarted: false } : { nightStarted: true, nightGame: night };
  }

  public async recordControlMessage(gameId: string, messageId: number): Promise<void> {
    await this.gameRepository.setControlMessageId(gameId, messageId);
  }

  private async getRoleConfirmationPlayer(gameId: string, phaseVersion: number, chatId: string, userId: string): Promise<Readonly<{ game: Game; player: Player }>> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'ROLE_CONFIRMATION' || game.stateVersion !== phaseVersion) {
      throw new EphemeralPanelError('Эта панель устарела. Откройте её снова из сообщения игры.');
    }
    if (game.phaseDeadline !== null && game.phaseDeadline.getTime() <= Date.now()) {
      throw new EphemeralPanelError('Время подтверждения истекло. Дождитесь продления от организатора.');
    }
    try {
      this.callbackGuard.assertGameChat(game, chatId);
    } catch (error) {
      throw new EphemeralPanelError(error instanceof Error ? error.message : 'Эта кнопка принадлежит другому игровому чату.');
    }

    const player = await this.playerRepository.findByGameAndUserId(game.id, userId);
    if (player === null || player.status !== 'ALIVE') {
      throw new EphemeralPanelError('Вы не являетесь живым игроком этой партии.');
    }

    return { game, player };
  }
}
