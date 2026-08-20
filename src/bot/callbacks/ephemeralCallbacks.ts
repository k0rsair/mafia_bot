import type { Bot, Context } from 'grammy';

import { EphemeralPanelError, type EphemeralPanelService } from '../../application/EphemeralPanelService.js';
import { NightActionError, type NightActionService } from '../../application/NightActionService.js';
import type { AppLogger } from '../../observability/logger.js';
import { isGameGroup } from '../authorization/chatPermissions.js';
import { parseGameCallback } from './callbackData.js';
import { renderNightControl } from '../views/phaseView.js';

export function registerEphemeralCallbacks(
  bot: Bot<Context>,
  panelService: EphemeralPanelService,
  nightActionService: NightActionService,
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
        await context.answerCallbackQuery({ text: '✅ Выбор принят.' });
        return;
      }

      const result = await panelService.confirmRole(input);
      await context.answerCallbackQuery({ text: '✅ Роль подтверждена.' });
      if (result.nightStarted && result.nightGame !== undefined) {
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
