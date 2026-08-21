import type { Bot, Context } from 'grammy';

import { EphemeralPanelError, type EphemeralPanelService } from '../../application/EphemeralPanelService.js';
import { NightActionError, type NightActionService } from '../../application/NightActionService.js';
import type { PhaseDeadlineResult, PhaseService } from '../../application/PhaseService.js';
import type { TestGameService } from '../../application/TestGameService.js';
import type { AppLogger } from '../../observability/logger.js';
import { isGameGroup } from '../authorization/chatPermissions.js';
import { parseGameCallback } from './callbackData.js';
import { renderDayDiscussion } from '../views/dayView.js';
import { renderFinalView } from '../views/finalView.js';
import { renderNightControl } from '../views/phaseView.js';

export function registerEphemeralCallbacks(
  bot: Bot<Context>,
  panelService: EphemeralPanelService,
  nightActionService: NightActionService,
  phaseService: PhaseService,
  testGameService: TestGameService,
  logger: AppLogger,
): void {
  bot.callbackQuery(/^g:/, async (context) => {
    const callback = parseGameCallback(context.callbackQuery.data);
    if (callback === null || !isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.answerCallbackQuery({ text: '⚠️ Панель устарела. Откройте её из актуального сообщения игры.' });
      return;
    }

    const input = {
      gameId: callback.gameId,
      phaseVersion: callback.phaseVersion,
      chatId: String(context.chat.id),
      userId: String(context.from.id),
      callbackQueryId: context.callbackQuery.id,
    };

    try {
      if (callback.action === 'panel') {
        await panelService.openPanel(input);
        await context.answerCallbackQuery();
        return;
      }

      if (callback.action === 'target') {
        if (callback.targetIndex === undefined) {
          throw new NightActionError('Не удалось определить цель.');
        }
        await nightActionService.submitTarget({ ...input, targetIndex: callback.targetIndex });
        const completion = await phaseService.completeNightIfAllActionsCompleted(callback.gameId, callback.phaseVersion);
        await context.answerCallbackQuery({ text: '✅ Выбор принят.' });
        await publishNightCompletion(context, completion);
        return;
      }

      if (callback.action === 'mafia-confirm') {
        await nightActionService.confirmMafiaTarget(input);
        const completion = await phaseService.completeNightIfAllActionsCompleted(callback.gameId, callback.phaseVersion);
        await context.answerCallbackQuery({ text: '✅ Голос мафии подтверждён.' });
        await publishNightCompletion(context, completion);
        return;
      }

      const result = await panelService.confirmRole(input);
      await context.answerCallbackQuery({ text: '✅ Роль подтверждена.' });
      if (result.nightStarted && result.nightGame !== undefined) {
        const testCompletion = await testGameService.playVirtualNightActions(result.nightGame);
        if (testCompletion !== null) {
          await publishNightCompletion(context, testCompletion);
          return;
        }
        const view = renderNightControl(result.nightGame.id, result.nightGame.stateVersion);
        const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
        await panelService.recordControlMessage(result.nightGame.id, controlMessage.message_id);
      }
    } catch (error) {
      logger.warn({ gameId: callback.gameId, userId: input.userId, error }, '[registerEphemeralCallbacks] Rejected ephemeral callback');
      const text = error instanceof EphemeralPanelError || error instanceof NightActionError
        ? error.message
        : 'Не удалось открыть скрытую панель. Попробуйте ещё раз.';
      await context.answerCallbackQuery({ text: `⚠️ ${text}`, show_alert: true });
    }
  });
}

export async function publishNightCompletion(
  context: Context,
  completion: Extract<PhaseDeadlineResult, { kind: 'NIGHT_RESOLVED' | 'GAME_FINISHED' }> | null,
): Promise<void> {
  if (completion === null) {
    return;
  }

  const resolution = completion.kind === 'GAME_FINISHED' ? completion.nightResolution : completion.resolution;
  if (resolution === undefined) {
    return;
  }
  const dawnText = resolution.eliminatedPlayer === null
    ? '☀️ Рассвет. Этой ночью город никого не потерял.'
    : `☀️ Рассвет. Ночью выбыл игрок: ${resolution.eliminatedPlayer.displayName}.`;
  await context.reply(dawnText);
  if (completion.kind === 'GAME_FINISHED') {
    await context.reply(renderFinalView(completion.finalization));
    return;
  }

  await context.reply(renderDayDiscussion());
}
