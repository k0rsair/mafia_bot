import type { Game, Player } from '@prisma/client';

import {
  renderCommissionerResult,
  renderNightChoiceAccepted,
  renderNightPanel,
  renderNoNightAction,
} from '../bot/views/ephemeralPanelView.js';
import { canRoleChooseTarget } from '../domain/game/rules.js';
import type { NightActionType, Role } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { TelegramEphemeralAdapter } from '../bot/telegram/ephemeral.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { NightActionRepository } from '../infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import { CallbackGuardService } from './CallbackGuardService.js';

export class NightActionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NightActionError';
  }
}

type NightPanelInput = Readonly<{
  gameId: string;
  phaseVersion: number;
  chatId: string;
  userId: string;
  callbackQueryId: string;
}>;

export class NightActionService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly nightActionRepository: NightActionRepository,
    private readonly ephemeralAdapter: TelegramEphemeralAdapter,
    private readonly logger: AppLogger,
    private readonly callbackGuard: CallbackGuardService = new CallbackGuardService(),
  ) {}

  public async openNightPanel(input: NightPanelInput): Promise<void> {
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role === null || player.role === 'CIVILIAN') {
      await this.ephemeralAdapter.sendText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        callbackQueryId: input.callbackQueryId,
        text: renderNoNightAction(),
      });
      return;
    }

    const candidates = (await this.playerRepository.listAlivePlayers(game.id)).flatMap((candidate, targetIndex) =>
      candidate.role !== null && canRoleChooseTarget(player.role as Role, candidate.role as Role, candidate.id === player.id)
        ? [{ id: candidate.id, displayName: candidate.displayName, targetIndex }]
        : [],
    );
    const panel = renderNightPanel({ gameId: game.id, phaseVersion: game.stateVersion, candidates });
    await this.ephemeralAdapter.sendText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      callbackQueryId: input.callbackQueryId,
      text: panel.text,
      replyMarkup: panel.replyMarkup,
    });
    this.logger.debug({ gameId: game.id, phase: game.phase, candidateCount: candidates.length }, '[NightActionService.openNightPanel] Night panel opened');
  }

  public async submitTarget(input: NightPanelInput & Readonly<{ targetIndex: number }>): Promise<void> {
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role === null || player.role === 'CIVILIAN') {
      throw new NightActionError('У вашей роли нет ночного действия.');
    }

    const target = (await this.playerRepository.listAlivePlayers(game.id))[input.targetIndex];
    if (target === undefined || target.role === null || !canRoleChooseTarget(player.role as Role, target.role as Role, target.id === player.id)) {
      throw new NightActionError('Эту цель выбрать нельзя. Откройте актуальную панель снова.');
    }

    const actionType = roleToActionType(player.role as Role);
    await this.nightActionRepository.upsertAction({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actionType,
      actorPlayerId: player.id,
      targetPlayerId: target.id,
    });

    const text = actionType === 'COMMISSIONER_CHECK'
      ? renderCommissionerResult(target.displayName, target.role === 'MAFIA')
      : renderNightChoiceAccepted();
    await this.ephemeralAdapter.sendText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      callbackQueryId: input.callbackQueryId,
      text,
    });
    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, actionType }, '[NightActionService.submitTarget] Night target accepted');
  }

  private async getNightPlayer(gameId: string, phaseVersion: number, chatId: string, userId: string): Promise<Readonly<{ game: Game; player: Player }>> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'NIGHT' || game.stateVersion !== phaseVersion) {
      throw new NightActionError('Ночная панель устарела. Откройте её снова из сообщения ведущего.');
    }
    try {
      this.callbackGuard.assertGameChat(game, chatId);
    } catch (error) {
      throw new NightActionError(error instanceof Error ? error.message : 'Эта кнопка принадлежит другому игровому чату.');
    }

    const player = await this.playerRepository.findByGameAndUserId(game.id, userId);
    if (player === null || player.status !== 'ALIVE') {
      throw new NightActionError('Вы не можете выполнить ночное действие.');
    }

    return { game, player };
  }
}

function roleToActionType(role: Role): NightActionType {
  switch (role) {
    case 'MAFIA':
      return 'MAFIA_KILL';
    case 'DOCTOR':
      return 'DOCTOR_SAVE';
    case 'COMMISSIONER':
      return 'COMMISSIONER_CHECK';
    case 'CIVILIAN':
      throw new NightActionError('A civilian has no night action');
  }
}
