import type { Bot, Context } from 'grammy';

import type { DayService } from '../../application/DayService.js';
import type { NightActionService } from '../../application/NightActionService.js';
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

    try {
      const progress = await votingService.castVote({
        gameId: callback.gameId,
        phaseVersion: callback.phaseVersion,
        chatId: String(context.chat.id),
        userId: String(context.from.id),
        targetIndex: callback.targetIndex ?? null,
        action: callback.action,
      });
      const view = await dayService.renderVote(progress.game);
      const closesOnEveryVote = progress.game.phase !== 'DAY_NOMINATION';
      if (!progress.allVoted || !closesOnEveryVote) {
        await context.editMessageText(view.text, { reply_markup: view.replyMarkup });
        await context.answerCallbackQuery({ text: '✅ Голос принят.' });
        return;
      }

      const closure = await phaseService.closeDayVote(progress.game);
      if (closure === null) {
        await context.editMessageText(view.text, { reply_markup: view.replyMarkup });
        await context.answerCallbackQuery({ text: '✅ Голос принят.' });
        return;
      }
      await publishVoteClosure(context, closure, dayService, phaseService, nightActionService, testGameService, roleDisplayNames);
      await context.answerCallbackQuery({ text: '✅ Голос принят.' });
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
  nightActionService: Pick<NightActionService, 'deliverNightPanels'>,
  testGameService: TestGameService,
  roleDisplayNames: RoleDisplayNames = DEFAULT_ROLE_DISPLAY_NAMES,
): Promise<void> {
  if (closure.kind === 'GAME_FINISHED') {
    await closeVoteMessage(context, closure.voteResolution);
    await context.reply(renderFinalView({ ...closure.finalization, roleDisplayNames }));
    return;
  }
  if (closure.kind === 'DAY_VOTE_STARTED') {
    await context.editMessageText('📣 Номинации завершены. Начинается основное голосование.', { reply_markup: { inline_keyboard: [] } });
    await publishCurrentRound(context, closure.game, dayService, phaseService);
    return;
  }
  if (closure.kind === 'DAY_TIE_DISCUSSION_STARTED') {
    await closeUnresolvedRoundMessage(context, closure.resolution);
    await context.reply('🤝 Первый тур завершился ничьей. У города есть 30 секунд на обсуждение перед повторным голосованием.');
    await phaseService.recordControlMessage(closure.game.id, (await context.reply('⌛ Идёт обсуждение ничьей.')).message_id);
    return;
  }
  if (closure.kind === 'DAY_FINAL_DECISION_STARTED') {
    await closeUnresolvedRoundMessage(context, closure.resolution);
    await context.reply('⚖️ Повторное голосование снова завершилось ничьей. Город примет финальное решение.');
    await publishCurrentRound(context, closure.game, dayService, phaseService);
    return;
  }

  await closeVoteMessage(context, closure.resolution);
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

async function closeVoteMessage(context: Context, resolution: AppliedVoteResolution): Promise<void> {
  await context.editMessageText(renderClosedVoteView({
    outcome: resolution.resolution.outcome,
    ...(resolution.roundKind === undefined ? {} : { kind: resolution.roundKind }),
    eliminatedDisplayNames: resolution.eliminatedPlayers.map((player) => player.displayName),
    alibiedDisplayNames: resolution.alibiedPlayers.map((player) => player.displayName),
    voteDetails: resolution.voteDetails,
  }), { reply_markup: { inline_keyboard: [] } });
}

async function closeUnresolvedRoundMessage(context: Context, resolution: ResolvedVoteRound): Promise<void> {
  await context.editMessageText(renderClosedVoteView({
    outcome: resolution.resolution.outcome,
    voteDetails: resolution.voteDetails,
  }), { reply_markup: { inline_keyboard: [] } });
}
