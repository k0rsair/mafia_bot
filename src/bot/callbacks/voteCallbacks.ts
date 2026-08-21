import type { Bot, Context } from 'grammy';

import type { DayService } from '../../application/DayService.js';
import { VotingError, type VotingService } from '../../application/VotingService.js';
import type { PhaseDeadlineResult, PhaseService } from '../../application/PhaseService.js';
import type { TestGameService } from '../../application/TestGameService.js';
import type { AppLogger } from '../../observability/logger.js';
import { isGameGroup } from '../authorization/chatPermissions.js';
import { parseVoteCallback } from './callbackData.js';
import { renderNightControl } from '../views/phaseView.js';
import { renderVoteOutcome } from '../views/voteView.js';
import { renderFinalView } from '../views/finalView.js';
import { publishNightCompletion } from './ephemeralCallbacks.js';

export function registerVoteCallbacks(
  bot: Bot<Context>,
  votingService: VotingService,
  dayService: DayService,
  phaseService: PhaseService,
  testGameService: TestGameService,
  logger: AppLogger,
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
        targetIndex: callback.action === 'skip' ? null : callback.targetIndex ?? null,
      });
      const view = await dayService.renderVote(progress.game, progress);
      await context.editMessageText(view.text, { reply_markup: view.replyMarkup });
      await context.answerCallbackQuery({ text: '✅ Голос принят.' });

      if (!progress.allVoted) {
        return;
      }

      const closure = await phaseService.closeDayVote(progress.game);
      if (closure === null) {
        return;
      }
      if (closure.kind === 'GAME_FINISHED') {
        if (closure.voteResolution !== undefined) {
          await context.reply(renderVoteOutcome({
            outcome: closure.voteResolution.resolution.outcome,
            ...(closure.voteResolution.eliminatedPlayer === null ? {} : { eliminatedDisplayName: closure.voteResolution.eliminatedPlayer.displayName }),
          }));
        }
        await context.reply(renderFinalView(closure.finalization));
        return;
      }
      await publishVoteClosure(context, closure, phaseService, testGameService);
    } catch (error) {
      logger.warn({ gameId: callback.gameId, userId: String(context.from.id), error }, '[registerVoteCallbacks] Rejected vote callback');
      const text = error instanceof VotingError ? error.message : 'Не удалось принять голос. Попробуйте ещё раз.';
      await context.answerCallbackQuery({ text: `⚠️ ${text}`, show_alert: true });
    }
  });
}

export async function publishVoteClosure(
  context: Context,
  closure: Extract<PhaseDeadlineResult, { kind: 'DAY_VOTE_RESOLVED' }>,
  phaseService: Pick<PhaseService, 'recordControlMessage'>,
  testGameService: TestGameService,
): Promise<void> {
  await context.reply(renderVoteOutcome({
    outcome: closure.resolution.resolution.outcome,
    ...(closure.resolution.eliminatedPlayer === null ? {} : { eliminatedDisplayName: closure.resolution.eliminatedPlayer.displayName }),
  }));
  const testCompletion = await testGameService.playVirtualNightActions(closure.game);
  if (testCompletion !== null) {
    await publishNightCompletion(context, testCompletion);
    return;
  }
  const nightView = renderNightControl(closure.game.id, closure.game.stateVersion);
  const controlMessage = await context.reply(nightView.text, { reply_markup: nightView.replyMarkup });
  await phaseService.recordControlMessage(closure.game.id, controlMessage.message_id);
}
