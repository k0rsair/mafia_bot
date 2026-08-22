import type { Game, Player } from '@prisma/client';

import {
  renderCommissionerResult,
  renderMafiaCouncilPanel,
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
import { isVirtualTestPlayer } from './TestGameService.js';

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
  callbackQueryId?: string;
  ephemeralMessageId?: number;
}>;

type NightCallbackInput = NightPanelInput & Readonly<{
  callbackQueryId: string;
}>;

export class NightActionService {
  private readonly mafiaCouncilPanels = new Map<string, Map<string, Set<number>>>();

  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly nightActionRepository: NightActionRepository,
    private readonly ephemeralAdapter: TelegramEphemeralAdapter,
    private readonly logger: AppLogger,
    private readonly callbackGuard: CallbackGuardService = new CallbackGuardService(),
  ) {}

  public async openNightPanel(input: NightPanelInput): Promise<void> {
    this.logger.debug(
      { gameId: input.gameId, phaseVersion: input.phaseVersion, chatId: input.chatId, userId: input.userId, hasCallbackQuery: input.callbackQueryId !== undefined, hasEphemeralMessageId: input.ephemeralMessageId !== undefined },
      '[NightActionService.openNightPanel] Opening night panel',
    );
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role === null || player.role === 'CIVILIAN') {
      await this.ephemeralAdapter.sendText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }),
        text: renderNoNightAction(),
      });
      this.logger.debug({ gameId: game.id, phase: game.phase }, '[NightActionService.openNightPanel] Night panel opened');
      return;
    }

    if (player.role === 'MAFIA') {
      await this.sendMafiaCouncilPanel(input, game, player);
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
      ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }),
      text: panel.text,
      replyMarkup: panel.replyMarkup,
    });
    this.logger.debug({ gameId: game.id, phase: game.phase, candidateCount: candidates.length }, '[NightActionService.openNightPanel] Night panel opened');
  }

  public async deliverNightPanels(game: Game): Promise<void> {
    if (game.phase !== 'NIGHT') {
      return;
    }

    const recipients = (await this.playerRepository.listAlivePlayers(game.id))
      .filter((player) => player.role !== null && player.role !== 'CIVILIAN' && !isVirtualTestPlayer(player.userId));
    const deliveries = await Promise.allSettled(recipients.map((player) =>
      this.openNightPanel({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        chatId: game.chatId,
        userId: player.userId,
      }),
    ));
    const failedPanelCount = deliveries.filter((delivery) => delivery.status === 'rejected').length;

    this.logger.info(
      {
        gameId: game.id,
        phase: game.phase,
        stateVersion: game.stateVersion,
        recipientCount: recipients.length,
        deliveredPanelCount: deliveries.length - failedPanelCount,
        failedPanelCount,
      },
      '[NightActionService.deliverNightPanels] Automatic night panels delivered',
    );
  }

  public async submitTarget(input: NightCallbackInput & Readonly<{ targetIndex: number }>): Promise<void> {
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role === null || player.role === 'CIVILIAN') {
      throw new NightActionError('У вашей роли нет ночного действия.');
    }

    const target = (await this.playerRepository.listAlivePlayers(game.id))[input.targetIndex];
    if (target === undefined || target.role === null || !canRoleChooseTarget(player.role as Role, target.role as Role, target.id === player.id)) {
      throw new NightActionError('Эту цель выбрать нельзя. Откройте актуальную панель снова.');
    }

    const actionType = roleToActionType(player.role as Role);
    if (actionType === 'MAFIA_KILL') {
      await this.nightActionRepository.upsertMafiaDraft({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        actorPlayerId: player.id,
        targetPlayerId: target.id,
      });
      await this.sendMafiaCouncilPanel(input, game, player);
      this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion }, '[FIX:mafia-council] Mafia draft selected');
      return;
    }

    const actionInput = {
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actionType,
      actorPlayerId: player.id,
      targetPlayerId: target.id,
    };
    if (actionType === 'COMMISSIONER_CHECK' || actionType === 'DOCTOR_SAVE') {
      const created = await this.nightActionRepository.createSingleUseAction(actionInput);
      if (created === null) {
        throw new NightActionError(actionType === 'COMMISSIONER_CHECK'
          ? 'Вы уже завершили проверку этой ночью.'
          : 'Вы уже выбрали, кого спасать этой ночью.');
      }
    } else {
      await this.nightActionRepository.upsertAction(actionInput);
    }

    const text = actionType === 'COMMISSIONER_CHECK'
      ? renderCommissionerResult(target.displayName, target.role === 'MAFIA')
      : renderNightChoiceAccepted();
    if (actionType === 'COMMISSIONER_CHECK' && input.ephemeralMessageId !== undefined) {
      await this.ephemeralAdapter.editText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        ephemeralMessageId: input.ephemeralMessageId,
        text,
        replyMarkup: { inline_keyboard: [] },
      });
    } else {
      await this.ephemeralAdapter.sendText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        callbackQueryId: input.callbackQueryId,
        text,
      });
    }
    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, actionType },
      actionType === 'DOCTOR_SAVE' ? '[FIX:doctor-save-limit] Night target accepted' : '[FIX:commissioner-check-limit] Night target accepted',
    );
  }

  public async confirmMafiaTarget(input: NightCallbackInput): Promise<void> {
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (player.role !== 'MAFIA') {
      throw new NightActionError('Подтверждать общий выбор могут только мафии.');
    }

    if (!(await this.nightActionRepository.confirmMafiaDraft({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actorPlayerId: player.id,
    }))) {
      throw new NightActionError('Сначала выберите цель или обновите совет мафии.');
    }

    const allMafiaConfirmed = await this.areAllMafiaDraftsConfirmed(game);
    const panelDeletion = allMafiaConfirmed
      ? await this.deleteMafiaCouncilPanels(game, input)
      : { deletedPanelCount: 0, failedPanelDeletionCount: 0 };

    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, allMafiaConfirmed, ...panelDeletion },
      '[FIX:mafia-confirmation] Mafia draft confirmed without reopening council',
    );
  }

  private async sendMafiaCouncilPanel(input: NightPanelInput, game: Game, player: Player): Promise<void> {
    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const candidates = alivePlayers.flatMap((candidate, targetIndex) =>
      candidate.role !== null && canRoleChooseTarget('MAFIA', candidate.role as Role, candidate.id === player.id)
        ? [{ displayName: candidate.displayName, targetIndex }]
        : [],
    );
    const playerById = new Map(alivePlayers.map((alivePlayer) => [alivePlayer.id, alivePlayer]));
    const selections = (await this.nightActionRepository.listActions(game.id, game.stateVersion)).flatMap((action) => {
      if (action.actionType !== 'MAFIA_KILL') {
        return [];
      }
      const actor = playerById.get(action.actorPlayerId);
      const target = action.targetPlayerId === null ? undefined : playerById.get(action.targetPlayerId);
      if (actor === undefined || target === undefined || actor.role !== 'MAFIA') {
        return [];
      }
      return [{
        actorPlayerId: actor.id,
        actorDisplayName: actor.displayName,
        targetDisplayName: target.displayName,
        confirmed: action.confirmedAt !== null,
      }];
    });
    const ownSelection = selections.find((selection) => selection.actorPlayerId === player.id);
    const panel = renderMafiaCouncilPanel({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      candidates,
      selections,
      hasOwnDraft: ownSelection !== undefined,
      ownDraftConfirmed: ownSelection?.confirmed ?? false,
    });
    if (input.ephemeralMessageId !== undefined) {
      await this.ephemeralAdapter.editText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        ephemeralMessageId: input.ephemeralMessageId,
        text: panel.text,
        replyMarkup: panel.replyMarkup,
      });
      this.rememberMafiaCouncilPanel(game, player.userId, input.ephemeralMessageId);
    } else {
      const sentPanel = await this.ephemeralAdapter.sendText({
        chatId: input.chatId,
        receiverUserId: input.userId,
        ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }),
        text: panel.text,
        replyMarkup: panel.replyMarkup,
      });
      this.rememberMafiaCouncilPanel(game, player.userId, sentPanel.ephemeral_message_id);
    }
    this.logger.debug(
      { gameId: game.id, phase: game.phase, candidateCount: candidates.length, mafiaDraftCount: selections.length, confirmedMafiaDraftCount: selections.filter((selection) => selection.confirmed).length, updatedExistingPanel: input.ephemeralMessageId !== undefined },
      '[FIX:mafia-council] Mafia council panel rendered',
    );
  }

  private async areAllMafiaDraftsConfirmed(game: Game): Promise<boolean> {
    const [alivePlayers, actions] = await Promise.all([
      this.playerRepository.listAlivePlayers(game.id),
      this.nightActionRepository.listActions(game.id, game.stateVersion),
    ]);
    const aliveMafiaIds = alivePlayers
      .filter((alivePlayer) => alivePlayer.role === 'MAFIA')
      .map((alivePlayer) => alivePlayer.id);
    const confirmedMafiaIds = new Set(actions.flatMap((action) =>
      action.actionType === 'MAFIA_KILL' && action.confirmedAt !== null ? [action.actorPlayerId] : [],
    ));

    return aliveMafiaIds.length > 0 && aliveMafiaIds.every((playerId) => confirmedMafiaIds.has(playerId));
  }

  private async deleteMafiaCouncilPanels(game: Game, input: NightPanelInput): Promise<Readonly<{
    deletedPanelCount: number;
    failedPanelDeletionCount: number;
  }>> {
    if (input.ephemeralMessageId !== undefined) {
      this.rememberMafiaCouncilPanel(game, input.userId, input.ephemeralMessageId);
    }

    const panelKey = this.getMafiaCouncilPanelKey(game);
    const panelsByUser = this.mafiaCouncilPanels.get(panelKey);
    if (panelsByUser === undefined) {
      return { deletedPanelCount: 0, failedPanelDeletionCount: 0 };
    }

    const aliveMafiaUserIds = new Set((await this.playerRepository.listAlivePlayers(game.id))
      .filter((alivePlayer) => alivePlayer.role === 'MAFIA')
      .map((alivePlayer) => alivePlayer.userId));
    const panelTargets = [...panelsByUser].flatMap(([receiverUserId, panelIds]) =>
      aliveMafiaUserIds.has(receiverUserId)
        ? [...panelIds].map((ephemeralMessageId) => ({ receiverUserId, ephemeralMessageId }))
        : [],
    );
    const deletionResults = await Promise.allSettled(panelTargets.map((panel) =>
      this.ephemeralAdapter.deleteEphemeralMessage({
        chatId: game.chatId,
        receiverUserId: panel.receiverUserId,
        ephemeralMessageId: panel.ephemeralMessageId,
      }),
    ));
    this.mafiaCouncilPanels.delete(panelKey);

    const failedPanelDeletionCount = deletionResults.filter((result) => result.status === 'rejected').length;
    if (failedPanelDeletionCount > 0) {
      this.logger.warn(
        { gameId: game.id, phaseVersion: game.stateVersion, failedPanelDeletionCount },
        '[FIX:mafia-confirmation] Could not delete every confirmed mafia panel',
      );
    }
    return {
      deletedPanelCount: deletionResults.length - failedPanelDeletionCount,
      failedPanelDeletionCount,
    };
  }

  private rememberMafiaCouncilPanel(game: Game, receiverUserId: string, ephemeralMessageId: number): void {
    const panelKey = this.getMafiaCouncilPanelKey(game);
    const panelsByUser = this.mafiaCouncilPanels.get(panelKey) ?? new Map<string, Set<number>>();
    const panelIds = panelsByUser.get(receiverUserId) ?? new Set<number>();
    panelIds.add(ephemeralMessageId);
    panelsByUser.set(receiverUserId, panelIds);
    this.mafiaCouncilPanels.set(panelKey, panelsByUser);
  }

  private getMafiaCouncilPanelKey(game: Game): string {
    return `${game.id}:${game.stateVersion}`;
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
    case 'DON':
    case 'PROSTITUTE':
    case 'MANIAC':
      throw new NightActionError('Для этой роли нужен обработчик городских ночных правил.');
    case 'CIVILIAN':
      throw new NightActionError('A civilian has no night action');
  }
}
