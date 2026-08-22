import type { Game, Player } from '@prisma/client';

import {
  renderCommissionerResult,
  renderDonCheckPanel,
  renderDonCheckResult,
  renderMafiaCouncilPanel,
  renderManiacPanel,
  renderNightActionBlocked,
  renderNightChoiceAccepted,
  renderNightPanel,
  renderNoNightAction,
} from '../bot/views/ephemeralPanelView.js';
import { canActionChooseTarget, isMafiaFaction, isMafiaVisibleToSheriff, isSheriffVisibleToDon } from '../domain/game/rules.js';
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

type NightCallbackInput = NightPanelInput & Readonly<{ callbackQueryId: string }>;

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
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion, hasCallbackQuery: input.callbackQueryId !== undefined }, '[NightActionService.openNightPanel] Opening night panel');
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (game.phase === 'NIGHT_PROSTITUTE') {
      await this.openProstitutePanel(input, game, player);
      return;
    }
    if (player.role === null || player.role === 'CIVILIAN' || player.role === 'PROSTITUTE') {
      await this.sendText(input, renderNoNightAction());
      return;
    }
    if (isMafiaFaction(player.role)) {
      await this.sendMafiaCouncilPanel(input, game, player);
      if (player.role === 'DON') {
        const { callbackQueryId: ignoredCallbackQueryId, ...withoutCallbackQuery } = input;
        const followUpInput = ignoredCallbackQueryId === undefined ? input : withoutCallbackQuery;
        if (await this.isPersonalActionBlocked(game, player)) {
          await this.sendText(followUpInput, renderNightActionBlocked());
        } else {
          await this.sendDonCheckPanel(followUpInput, game, player);
        }
      }
      return;
    }
    if (await this.isPersonalActionBlocked(game, player)) {
      await this.sendText(input, renderNightActionBlocked());
      this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, blockedActionPlayerCount: 1 }, '[NightActionService.openNightPanel] Blocked action panel delivered');
      return;
    }
    if (player.role === 'MANIAC') {
      await this.sendManiacPanel(input, game, player);
      return;
    }
    await this.sendTargetPanel(input, game, player, roleToPersonalAction(player.role));
  }

  public async deliverNightPanels(game: Game): Promise<void> {
    if (game.phase !== 'NIGHT' && game.phase !== 'NIGHT_PROSTITUTE') {
      return;
    }
    const recipients = (await this.playerRepository.listAlivePlayers(game.id)).filter((player) => {
      if (player.role === null || isVirtualTestPlayer(player.userId)) {
        return false;
      }
      return game.phase === 'NIGHT_PROSTITUTE' ? player.role === 'PROSTITUTE' : player.role !== 'CIVILIAN' && player.role !== 'PROSTITUTE';
    });
    const deliveries = await Promise.allSettled(recipients.map((player) =>
      this.openNightPanel({ gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: player.userId }),
    ));
    const failedPanelCount = deliveries.filter((delivery) => delivery.status === 'rejected').length;
    this.logger.info({ gameId: game.id, phase: game.phase, stateVersion: game.stateVersion, recipientCount: recipients.length, deliveredPanelCount: deliveries.length - failedPanelCount, failedPanelCount }, '[NightActionService.deliverNightPanels] Automatic night panels delivered');
  }

  public async submitTarget(input: NightCallbackInput & Readonly<{ targetIndex: number }>): Promise<void> {
    const { game, player } = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    await this.submitActionTarget(input, game, player, this.getDefaultActionType(game, player));
  }

  public async submitDonCheck(input: NightCallbackInput & Readonly<{ targetIndex: number }>): Promise<void> {
    const { game, player } = await this.getRegularNightPlayer(input);
    if (player.role !== 'DON') {
      throw new NightActionError('Эта проверка доступна только Дону.');
    }
    if (await this.isPersonalActionBlocked(game, player)) {
      throw new NightActionError('Ваше ночное действие заблокировано визитом Шлюхи.');
    }
    await this.submitActionTarget(input, game, player, 'DON_CHECK');
  }

  public async skipManiacAction(input: NightCallbackInput): Promise<void> {
    const { game, player } = await this.getRegularNightPlayer(input);
    if (player.role !== 'MANIAC') {
      throw new NightActionError('Пропустить ход может только Маньяк.');
    }
    if (await this.isPersonalActionBlocked(game, player)) {
      throw new NightActionError('Ваше ночное действие заблокировано визитом Шлюхи.');
    }
    const created = await this.nightActionRepository.createSingleUseAction({ gameId: game.id, phaseVersion: game.stateVersion, actionType: 'MANIAC_SKIP', actorPlayerId: player.id, targetPlayerId: null });
    if (created === null) {
      throw new NightActionError('Вы уже завершили действие этой ночью.');
    }
    await this.sendText(input, renderNightChoiceAccepted());
    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, skippedActionCount: 1 }, '[NightActionService.skipManiacAction] Night action skipped');
  }

  public async confirmMafiaTarget(input: NightCallbackInput): Promise<void> {
    const { game, player } = await this.getRegularNightPlayer(input);
    if (player.role === null || !isMafiaFaction(player.role)) {
      throw new NightActionError('Подтверждать общий выбор могут только участники мафии.');
    }
    const confirmed = await this.nightActionRepository.confirmMafiaDraft({ gameId: game.id, phaseVersion: game.stateVersion, actorPlayerId: player.id });
    if (!confirmed) {
      throw new NightActionError('Сначала выберите цель или обновите совет мафии.');
    }
    const allMafiaConfirmed = await this.areAllMafiaDraftsConfirmed(game);
    const panelDeletion = allMafiaConfirmed ? await this.deleteMafiaCouncilPanels(game, input) : { deletedPanelCount: 0, failedPanelDeletionCount: 0 };
    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, allMafiaConfirmed, ...panelDeletion }, '[NightActionService.confirmMafiaTarget] Mafia council confirmation accepted');
  }

  private async openProstitutePanel(input: NightPanelInput, game: Game, player: Player): Promise<void> {
    if (player.role !== 'PROSTITUTE') {
      await this.sendText(input, renderNoNightAction());
      return;
    }
    await this.sendTargetPanel(input, game, player, 'PROSTITUTE_VISIT');
  }

  private async submitActionTarget(input: NightCallbackInput & Readonly<{ targetIndex: number }>, game: Game, player: Player, actionType: NightActionType): Promise<void> {
    const target = (await this.playerRepository.listAlivePlayers(game.id))[input.targetIndex];
    if (target === undefined || target.role === null || player.role === null || !canActionChooseTarget({ actorRole: player.role as Role, actionType, targetRole: target.role as Role, isSelfTarget: target.id === player.id })) {
      throw new NightActionError('Эту цель выбрать нельзя. Откройте актуальную панель снова.');
    }
    if (actionType === 'MAFIA_KILL') {
      await this.nightActionRepository.upsertMafiaDraft({ gameId: game.id, phaseVersion: game.stateVersion, actorPlayerId: player.id, targetPlayerId: target.id });
      await this.sendMafiaCouncilPanel(input, game, player);
      this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, draftedActionCount: 1 }, '[NightActionService.submitActionTarget] Council draft selected');
      return;
    }
    const action = actionType === 'DOCTOR_SAVE' || actionType === 'PROSTITUTE_VISIT'
      ? await this.nightActionRepository.createRestrictedSingleUseAction({ gameId: game.id, phaseVersion: game.stateVersion, actionType, actorPlayerId: player.id, targetPlayerId: target.id, rejectRepeatedTarget: true, rejectRepeatedSelfSave: actionType === 'DOCTOR_SAVE' })
      : await this.createSingleUseAction(game, player, target.id, actionType);
    if (action.action === null) {
      throw new NightActionError(this.rejectionMessage(action.rejection, actionType));
    }
    if (actionType === 'COMMISSIONER_CHECK') {
      await this.sendInvestigationResult(input, renderCommissionerResult(target.displayName, isMafiaVisibleToSheriff(target.role as Role)));
    } else if (actionType === 'DON_CHECK') {
      await this.sendInvestigationResult(input, renderDonCheckResult(target.displayName, isSheriffVisibleToDon(target.role as Role)));
    } else {
      await this.sendText(input, renderNightChoiceAccepted());
    }
    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, acceptedActionCount: 1 }, '[NightActionService.submitActionTarget] Night action accepted');
  }

  private async createSingleUseAction(game: Game, player: Player, targetPlayerId: string, actionType: NightActionType): Promise<Readonly<{ action: Awaited<ReturnType<NightActionRepository['createSingleUseAction']>>; rejection: 'DUPLICATE' | null }>> {
    const action = await this.nightActionRepository.createSingleUseAction({ gameId: game.id, phaseVersion: game.stateVersion, actionType, actorPlayerId: player.id, targetPlayerId });
    return { action, rejection: action === null ? 'DUPLICATE' : null };
  }

  private rejectionMessage(rejection: 'DUPLICATE' | 'REPEATED_TARGET' | 'SELF_SAVE_USED' | null, actionType: NightActionType): string {
    if (rejection === 'REPEATED_TARGET') return 'Эту же цель нельзя выбирать две ночи подряд.';
    if (rejection === 'SELF_SAVE_USED') return 'Самолечение доступно только один раз за игру.';
    if (actionType === 'COMMISSIONER_CHECK') return 'Вы уже завершили проверку этой ночью.';
    if (actionType === 'DOCTOR_SAVE') return 'Вы уже выбрали, кого спасать этой ночью.';
    if (actionType === 'DON_CHECK') return 'Вы уже завершили проверку этой ночью.';
    return 'Вы уже завершили действие этой ночью.';
  }

  private async sendTargetPanel(input: NightPanelInput, game: Game, player: Player, actionType: NightActionType): Promise<void> {
    const [alivePlayers, latestTargetId, hasUsedSelfSave] = await Promise.all([
      this.playerRepository.listAlivePlayers(game.id),
      actionType === 'DOCTOR_SAVE' || actionType === 'PROSTITUTE_VISIT'
        ? this.nightActionRepository.getLatestTarget({ gameId: game.id, actorPlayerId: player.id, actionType })
        : Promise.resolve(null),
      actionType === 'DOCTOR_SAVE'
        ? this.nightActionRepository.hasDoctorUsedSelfSave(game.id, player.id)
        : Promise.resolve(false),
    ]);
    const candidates = alivePlayers.flatMap((candidate, targetIndex) => {
      const isDisallowedRepeat = latestTargetId === candidate.id;
      const isConsumedSelfSave = actionType === 'DOCTOR_SAVE' && hasUsedSelfSave && candidate.id === player.id;
      const isAllowed = candidate.role !== null
        && player.role !== null
        && !isDisallowedRepeat
        && !isConsumedSelfSave
        && canActionChooseTarget({ actorRole: player.role as Role, actionType, targetRole: candidate.role as Role, isSelfTarget: candidate.id === player.id });
      return isAllowed ? [{ id: candidate.id, displayName: candidate.displayName, targetIndex }] : [];
    });
    const panel = renderNightPanel({ gameId: game.id, phaseVersion: game.stateVersion, candidates, actionType });
    await this.sendText(input, panel.text, panel.replyMarkup);
    this.logger.debug({ gameId: game.id, phase: game.phase, phaseVersion: game.stateVersion, candidateCount: candidates.length }, '[NightActionService.sendTargetPanel] Target panel delivered');
  }

  private async sendDonCheckPanel(input: NightPanelInput, game: Game, player: Player): Promise<void> {
    const candidates = (await this.playerRepository.listAlivePlayers(game.id)).flatMap((candidate, targetIndex) =>
      candidate.role !== null && canActionChooseTarget({ actorRole: 'DON', actionType: 'DON_CHECK', targetRole: candidate.role as Role, isSelfTarget: candidate.id === player.id }) ? [{ displayName: candidate.displayName, targetIndex }] : [],
    );
    const panel = renderDonCheckPanel({ gameId: game.id, phaseVersion: game.stateVersion, candidates });
    await this.sendText(input, panel.text, panel.replyMarkup);
  }

  private async sendManiacPanel(input: NightPanelInput, game: Game, player: Player): Promise<void> {
    const candidates = (await this.playerRepository.listAlivePlayers(game.id)).flatMap((candidate, targetIndex) =>
      candidate.role !== null && canActionChooseTarget({ actorRole: 'MANIAC', actionType: 'MANIAC_KILL', targetRole: candidate.role as Role, isSelfTarget: candidate.id === player.id }) ? [{ displayName: candidate.displayName, targetIndex }] : [],
    );
    const panel = renderManiacPanel({ gameId: game.id, phaseVersion: game.stateVersion, candidates });
    await this.sendText(input, panel.text, panel.replyMarkup);
  }

  private async sendMafiaCouncilPanel(input: NightPanelInput, game: Game, player: Player): Promise<void> {
    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const candidates = alivePlayers.flatMap((candidate, targetIndex) => candidate.role !== null && canActionChooseTarget({ actorRole: 'MAFIA', actionType: 'MAFIA_KILL', targetRole: candidate.role as Role, isSelfTarget: candidate.id === player.id }) ? [{ displayName: candidate.displayName, targetIndex }] : []);
    const playersById = new Map(alivePlayers.map((alivePlayer) => [alivePlayer.id, alivePlayer]));
    const selections = (await this.nightActionRepository.listActions(game.id, game.stateVersion)).flatMap((action) => {
      if (action.actionType !== 'MAFIA_KILL' || action.targetPlayerId === null) return [];
      const actor = playersById.get(action.actorPlayerId);
      const target = playersById.get(action.targetPlayerId);
      if (actor === undefined || target === undefined || actor.role === null || !isMafiaFaction(actor.role as Role)) return [];
      return [{ actorPlayerId: actor.id, actorDisplayName: actor.displayName, targetDisplayName: target.displayName, confirmed: action.confirmedAt !== null }];
    });
    const ownSelection = selections.find((selection) => selection.actorPlayerId === player.id);
    const panel = renderMafiaCouncilPanel({ gameId: game.id, phaseVersion: game.stateVersion, candidates, selections, hasOwnDraft: ownSelection !== undefined, ownDraftConfirmed: ownSelection?.confirmed ?? false });
    if (input.ephemeralMessageId !== undefined) {
      await this.ephemeralAdapter.editText({ chatId: input.chatId, receiverUserId: input.userId, ephemeralMessageId: input.ephemeralMessageId, text: panel.text, replyMarkup: panel.replyMarkup });
      this.rememberMafiaCouncilPanel(game, player.userId, input.ephemeralMessageId);
    } else {
      const sentPanel = await this.ephemeralAdapter.sendText({ chatId: input.chatId, receiverUserId: input.userId, ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }), text: panel.text, replyMarkup: panel.replyMarkup });
      this.rememberMafiaCouncilPanel(game, player.userId, sentPanel.ephemeral_message_id);
    }
    this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, candidateCount: candidates.length, councilSelectionCount: selections.length, confirmedCouncilSelectionCount: selections.filter((selection) => selection.confirmed).length }, '[NightActionService.sendMafiaCouncilPanel] Council panel delivered');
  }

  private async areAllMafiaDraftsConfirmed(game: Game): Promise<boolean> {
    const [alivePlayers, actions] = await Promise.all([this.playerRepository.listAlivePlayers(game.id), this.nightActionRepository.listActions(game.id, game.stateVersion)]);
    const mafiaIds = alivePlayers.flatMap((player) => player.role !== null && isMafiaFaction(player.role as Role) ? [player.id] : []);
    const confirmedIds = new Set(actions.flatMap((action) => action.actionType === 'MAFIA_KILL' && action.confirmedAt !== null ? [action.actorPlayerId] : []));
    return mafiaIds.length > 0 && mafiaIds.every((playerId) => confirmedIds.has(playerId));
  }

  private async isPersonalActionBlocked(game: Game, player: Player): Promise<boolean> {
    if (game.phase !== 'NIGHT' || player.role === null || !['COMMISSIONER', 'DOCTOR', 'DON', 'MANIAC'].includes(player.role)) return false;
    const priorActions = await this.nightActionRepository.listActions(game.id, game.stateVersion - 1);
    return priorActions.some((action) => action.actionType === 'PROSTITUTE_VISIT' && action.targetPlayerId === player.id);
  }

  private getDefaultActionType(game: Game, player: Player): NightActionType {
    if (player.role === null || player.role === 'CIVILIAN') throw new NightActionError('У вашей роли нет ночного действия.');
    if (game.phase === 'NIGHT_PROSTITUTE') {
      if (player.role !== 'PROSTITUTE') throw new NightActionError('Сейчас действует только Шлюха.');
      return 'PROSTITUTE_VISIT';
    }
    if (player.role === 'MAFIA' || player.role === 'DON') return 'MAFIA_KILL';
    if (player.role === 'PROSTITUTE') throw new NightActionError('Действие Шлюхи уже завершено.');
    return roleToPersonalAction(player.role);
  }

  private async getRegularNightPlayer(input: NightPanelInput): Promise<Readonly<{ game: Game; player: Player }>> {
    const result = await this.getNightPlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    if (result.game.phase !== 'NIGHT') throw new NightActionError('Это действие доступно после завершения хода Шлюхи.');
    return result;
  }

  private async getNightPlayer(gameId: string, phaseVersion: number, chatId: string, userId: string): Promise<Readonly<{ game: Game; player: Player }>> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || (game.phase !== 'NIGHT' && game.phase !== 'NIGHT_PROSTITUTE') || game.stateVersion !== phaseVersion) throw new NightActionError('Ночная панель устарела. Откройте её снова из сообщения ведущего.');
    try {
      this.callbackGuard.assertGameChat(game, chatId);
    } catch (error) {
      throw new NightActionError(error instanceof Error ? error.message : 'Эта кнопка принадлежит другому игровому чату.');
    }
    const player = await this.playerRepository.findByGameAndUserId(game.id, userId);
    if (player === null || player.status !== 'ALIVE') throw new NightActionError('Вы не можете выполнить ночное действие.');
    return { game, player };
  }

  private async sendInvestigationResult(input: NightPanelInput, text: string): Promise<void> {
    if (input.ephemeralMessageId !== undefined) {
      await this.ephemeralAdapter.editText({ chatId: input.chatId, receiverUserId: input.userId, ephemeralMessageId: input.ephemeralMessageId, text, replyMarkup: { inline_keyboard: [] } });
      return;
    }
    await this.sendText(input, text);
  }

  private async sendText(input: NightPanelInput, text: string, replyMarkup?: Parameters<TelegramEphemeralAdapter['sendText']>[0]['replyMarkup']): Promise<void> {
    await this.ephemeralAdapter.sendText({ chatId: input.chatId, receiverUserId: input.userId, ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }), text, ...(replyMarkup === undefined ? {} : { replyMarkup }) });
  }

  private async deleteMafiaCouncilPanels(game: Game, input: NightPanelInput): Promise<Readonly<{ deletedPanelCount: number; failedPanelDeletionCount: number }>> {
    if (input.ephemeralMessageId !== undefined) this.rememberMafiaCouncilPanel(game, input.userId, input.ephemeralMessageId);
    const panelsByUser = this.mafiaCouncilPanels.get(this.getMafiaCouncilPanelKey(game));
    if (panelsByUser === undefined) return { deletedPanelCount: 0, failedPanelDeletionCount: 0 };
    const mafiaUsers = new Set((await this.playerRepository.listAlivePlayers(game.id)).flatMap((player) => player.role !== null && isMafiaFaction(player.role as Role) ? [player.userId] : []));
    const panelTargets = [...panelsByUser].flatMap(([receiverUserId, panelIds]) => mafiaUsers.has(receiverUserId) ? [...panelIds].map((ephemeralMessageId) => ({ receiverUserId, ephemeralMessageId })) : []);
    const results = await Promise.allSettled(panelTargets.map((panel) => this.ephemeralAdapter.deleteEphemeralMessage({ chatId: game.chatId, receiverUserId: panel.receiverUserId, ephemeralMessageId: panel.ephemeralMessageId })));
    this.mafiaCouncilPanels.delete(this.getMafiaCouncilPanelKey(game));
    const failedPanelDeletionCount = results.filter((result) => result.status === 'rejected').length;
    return { deletedPanelCount: results.length - failedPanelDeletionCount, failedPanelDeletionCount };
  }

  private rememberMafiaCouncilPanel(game: Game, receiverUserId: string, ephemeralMessageId: number): void {
    const key = this.getMafiaCouncilPanelKey(game);
    const users = this.mafiaCouncilPanels.get(key) ?? new Map<string, Set<number>>();
    const ids = users.get(receiverUserId) ?? new Set<number>();
    ids.add(ephemeralMessageId);
    users.set(receiverUserId, ids);
    this.mafiaCouncilPanels.set(key, users);
  }

  private getMafiaCouncilPanelKey(game: Game): string {
    return `${game.id}:${game.stateVersion}`;
  }
}

function roleToPersonalAction(role: Role): NightActionType {
  switch (role) {
    case 'COMMISSIONER': return 'COMMISSIONER_CHECK';
    case 'DOCTOR': return 'DOCTOR_SAVE';
    case 'MANIAC': return 'MANIAC_KILL';
    case 'MAFIA':
    case 'DON':
    case 'PROSTITUTE':
    case 'CIVILIAN':
      throw new NightActionError('У этой роли нет отдельного личного ночного действия.');
  }
}
