import type { Bot, Context } from 'grammy';

import type { DayService } from '../../application/DayService.js';
import type { NightActionService } from '../../application/NightActionService.js';
import type { VotePanelService } from '../../application/VotePanelService.js';
import { VotingError, type AppliedVoteResolution, type ResolvedVoteRound, type VotingService } from '../../application/VotingService.js';
import type { CityVoteClosure, PhaseService } from '../../application/PhaseService.js';
import type { TestGameService } from '../../application/TestGameService.js';
import { DEFAULT_ROLE_DISPLAY_NAMES, type RoleDisplayNames } from '../../domain/game/types.js';
import type { AppLogger } from '../../observability/logger.js';
import { isGameGroup } from '../authorization/chatPermissions.js';
import { parseVoteCallback } from './callbackData.js';
import { renderFinalView } from '../views/finalView.js';
import { renderNightControl, renderProstituteNightControl } from '../views/phaseView.js';
import { renderClosedVoteView } from '../views/voteView.js';
import { publishNightCompletion } from './ephemeralCallbacks.js';

export function registerVoteCallbacks(
  bot: Bot<Context>,
  votingService: VotingService,
  dayService: DayService,
  phaseService: PhaseService,
  votePanelService: VotePanelService,
  nightActionService: NightActionService,
  testGameService: TestGameService,
  logger: AppLogger,
  roleDisplayNames: RoleDisplayNames = DEFAULT_ROLE_DISPLAY_NAMES,
): void {
  bot.callbackQuery(/^v:/, async (context) => {
    const callback = parseVoteCallback(context.callbackQuery.data);
    if (callback === null || !isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.answerCallbackQuery({ text: '⚠️ Голосование устарело.' });
      return;
    }

    const input = {
      gameId: callback.gameId,
      phaseVersion: callback.phaseVersion,
      chatId: String(context.chat.id),
      userId: String(context.from.id),
      callbackQueryId: context.callbackQuery.id,
    };
    const voteInput = {
      gameId: input.gameId,
      phaseVersion: input.phaseVersion,
      chatId: input.chatId,
      userId: input.userId,
    };
    const ephemeralMessageId = context.callbackQuery.message?.ephemeral_message_id;

    try {
      if (callback.action === 'panel') {
        await votePanelService.openPanel(input);
        await context.answerCallbackQuery();
        return;
      }

      if (callback.action !== 'confirm') {
        await votingService.castVote({
          ...voteInput,
          targetIndex: callback.targetIndex ?? null,
          action: callback.action,
        });
        await refreshOrOpenVotePanel(votePanelService, input, ephemeralMessageId);
        await context.answerCallbackQuery({ text: '📝 Выбор сохранён. Подтвердите его отдельной кнопкой.' });
        return;
      }

      const progress = await votingService.confirmVote(voteInput);
      await refreshOrOpenVotePanel(votePanelService, input, ephemeralMessageId);
      if (!progress.allVoted) {
        await refreshPublicVoteControl(context, progress.game.id, dayService, phaseService, logger);
        await context.answerCallbackQuery({ text: '✅ Выбор подтверждён.' });
        return;
      }

      const closure = await phaseService.closeDayVote(progress.game);
      if (closure === null) {
        await context.answerCallbackQuery({ text: '✅ Выбор подтверждён.' });
        return;
      }
      await publishVoteClosure(context, closure, dayService, phaseService, votePanelService, nightActionService, testGameService, roleDisplayNames);
      await context.answerCallbackQuery({ text: '✅ Выбор подтверждён.' });
    } catch (error) {
      logger.warn({ gameId: callback.gameId, userId: String(context.from.id), error }, '[registerVoteCallbacks] Rejected vote callback');
      const text = error instanceof VotingError ? error.message : 'Не удалось принять голос. Попробуйте ещё раз.';
      await context.answerCallbackQuery({ text: `⚠️ ${text}`, show_alert: true });
    }
  });
}

export async function publishVoteClosure(
  context: Context,
  closure: CityVoteClosure,
  dayService: DayService,
  phaseService: Pick<PhaseService, 'recordControlMessage' | 'getCurrentGame'>,
  votePanelService: Pick<VotePanelService, 'deliverVotePanels'>,
  nightActionService: Pick<NightActionService, 'deliverNightPanels'>,
  testGameService: TestGameService,
  roleDisplayNames: RoleDisplayNames = DEFAULT_ROLE_DISPLAY_NAMES,
): Promise<void> {
  if (closure.kind === 'GAME_FINISHED') {
    await closeVoteMessage(context, closure.game, closure.voteResolution);
    await context.reply(renderFinalView({ ...closure.finalization, roleDisplayNames }));
    return;
  }
  if (closure.kind === 'DAY_VOTE_STARTED') {
    await replaceVoteMessage(context, closure.game, '📣 Номинации завершены. Начинается основное голосование.');
    await testGameService.castVirtualVotes(closure.game);
    await publishCurrentRound(context, closure.game, dayService, phaseService);
    await votePanelService.deliverVotePanels(closure.game);
    return;
  }
  if (closure.kind === 'DAY_TIE_DISCUSSION_STARTED') {
    await closeUnresolvedRoundMessage(context, closure.game, closure.resolution);
    await context.reply('🤝 Первый тур завершился ничьей. У города есть 30 секунд на обсуждение перед повторным голосованием.');
    await phaseService.recordControlMessage(closure.game.id, (await context.reply('⌛ Идёт обсуждение ничьей.')).message_id);
    return;
  }
  if (closure.kind === 'DAY_FINAL_DECISION_STARTED') {
    await closeUnresolvedRoundMessage(context, closure.game, closure.resolution);
    await context.reply('⚖️ Повторное голосование снова завершилось ничьей. Город примет финальное решение.');
    await testGameService.castVirtualVotes(closure.game);
    await publishCurrentRound(context, closure.game, dayService, phaseService);
    await votePanelService.deliverVotePanels(closure.game);
    return;
  }

  await closeVoteMessage(context, closure.game, closure.resolution);
  await publishCityNightStart(context, closure.game, phaseService, nightActionService, testGameService, roleDisplayNames);
}

async function publishCurrentRound(
  context: Context,
  game: Readonly<{ id: string }>,
  dayService: DayService,
  phaseService: Pick<PhaseService, 'recordControlMessage' | 'getCurrentGame'>,
): Promise<void> {
  const currentGame = await phaseService.getCurrentGame(game.id);
  if (currentGame === null) {
    return;
  }
  const view = await dayService.renderVote(currentGame);
  const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
  await phaseService.recordControlMessage(currentGame.id, controlMessage.message_id);
}

async function publishCityNightStart(
  context: Context,
  game: Readonly<{ id: string; phase: string }>,
  phaseService: Pick<PhaseService, 'recordControlMessage' | 'getCurrentGame'>,
  nightActionService: Pick<NightActionService, 'deliverNightPanels'>,
  testGameService: TestGameService,
  roleDisplayNames: RoleDisplayNames,
): Promise<void> {
  const currentGame = await phaseService.getCurrentGame(game.id);
  if (currentGame === null || (currentGame.phase !== 'NIGHT_PROSTITUTE' && currentGame.phase !== 'NIGHT')) {
    return;
  }
  if (currentGame.phase === 'NIGHT_PROSTITUTE') {
    const view = renderProstituteNightControl(roleDisplayNames);
    const control = await context.reply(view.text, { reply_markup: view.replyMarkup });
    await phaseService.recordControlMessage(currentGame.id, control.message_id);
    await nightActionService.deliverNightPanels(currentGame);
    return;
  }
  const testCompletion = await testGameService.playVirtualNightActions(currentGame);
  if (testCompletion !== null) {
    await publishNightCompletion(context, testCompletion, roleDisplayNames);
    return;
  }
  const view = renderNightControl();
  const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
  await phaseService.recordControlMessage(currentGame.id, controlMessage.message_id);
  await nightActionService.deliverNightPanels(currentGame);
}

async function closeVoteMessage(context: Context, game: Readonly<{ chatId: string; controlMessageId: number | null }>, resolution: AppliedVoteResolution): Promise<void> {
  await replaceVoteMessage(context, game, renderClosedVoteView({
    outcome: resolution.resolution.outcome,
    ...(resolution.roundKind === undefined ? {} : { kind: resolution.roundKind }),
    eliminatedDisplayNames: resolution.eliminatedPlayers.map((player) => player.displayName),
    alibiedDisplayNames: resolution.alibiedPlayers.map((player) => player.displayName),
    voteDetails: resolution.voteDetails,
  }));
}

async function closeUnresolvedRoundMessage(context: Context, game: Readonly<{ chatId: string; controlMessageId: number | null }>, resolution: ResolvedVoteRound): Promise<void> {
  await replaceVoteMessage(context, game, renderClosedVoteView({
    outcome: resolution.resolution.outcome,
    voteDetails: resolution.voteDetails,
  }));
}

async function replaceVoteMessage(
  context: Context,
  game: Readonly<{ chatId: string; controlMessageId: number | null }>,
  text: string,
): Promise<void> {
  const replyMarkup = { inline_keyboard: [] };
  if (game.controlMessageId !== null) {
    try {
      await context.api.editMessageText(game.chatId, game.controlMessageId, text, { reply_markup: replyMarkup });
      return;
    } catch {
      // The phase has been committed already, so publish the replacement below.
    }
  }
  if (context.callbackQuery !== undefined) {
    await context.editMessageText(text, { reply_markup: replyMarkup });
    return;
  }
  await context.reply(text, { reply_markup: replyMarkup });
}

async function refreshOrOpenVotePanel(
  votePanelService: VotePanelService,
  input: Readonly<{ gameId: string; phaseVersion: number; chatId: string; userId: string; callbackQueryId: string }>,
  ephemeralMessageId: number | undefined,
): Promise<void> {
  if (ephemeralMessageId === undefined) {
    await votePanelService.openPanel(input);
    return;
  }
  await votePanelService.refreshPanel({ ...input, ephemeralMessageId });
}

async function refreshPublicVoteControl(
  context: Context,
  gameId: string,
  dayService: DayService,
  phaseService: Pick<PhaseService, 'getCurrentGame'>,
  logger: AppLogger,
): Promise<void> {
  const game = await phaseService.getCurrentGame(gameId);
  if (game === null || game.controlMessageId === null || !['DAY_NOMINATION', 'DAY_VOTE', 'DAY_REVOTE', 'DAY_FINAL_DECISION'].includes(game.phase)) {
    return;
  }
  const view = await dayService.renderVote(game);
  try {
    await context.api.editMessageText(game.chatId, game.controlMessageId, view.text, { reply_markup: view.replyMarkup });
  } catch (error) {
    logger.warn({ gameId: game.id, phase: game.phase, phaseVersion: game.stateVersion, error }, '[FIX:city-vote-panel] Could not refresh public city vote control');
  }
}
