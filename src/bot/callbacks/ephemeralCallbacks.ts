import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';

import { EphemeralPanelError, type EphemeralPanelService, type RoleConfirmationResult } from '../../application/EphemeralPanelService.js';
import { NightActionError, type NightActionService } from '../../application/NightActionService.js';
import type { PhaseDeadlineResult, PhaseService } from '../../application/PhaseService.js';
import type { TestGameService } from '../../application/TestGameService.js';
import type { AppLogger } from '../../observability/logger.js';
import { isGameGroup } from '../authorization/chatPermissions.js';
import { parseGameCallback } from './callbackData.js';
import { renderDayDiscussion } from '../views/dayView.js';
import { renderNightEvent } from '../views/nightEventView.js';
import { renderFinalView } from '../views/finalView.js';
import { renderNightControl, renderProstituteNightControl } from '../views/phaseView.js';

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
      ...(context.callbackQuery.message?.ephemeral_message_id === undefined
        ? {}
        : { ephemeralMessageId: context.callbackQuery.message.ephemeral_message_id }),
    };

    try {
      if (callback.action === 'panel') {
        const result = await panelService.openPanel(input);
        await context.answerCallbackQuery();
        await publishRoleConfirmationCompletion(context, result, panelService, nightActionService, testGameService);
        return;
      }

      if (callback.action === 'target') {
        if (callback.targetIndex === undefined) {
          throw new NightActionError('Не удалось определить цель.');
        }
        await nightActionService.submitTarget({ ...input, targetIndex: callback.targetIndex });
        const currentGame = await phaseService.getCurrentGame(callback.gameId);
        if (currentGame?.phase === 'NIGHT_PROSTITUTE' && currentGame.stateVersion === callback.phaseVersion) {
          const nightGame = await phaseService.completeProstituteNight(callback.gameId, callback.phaseVersion);
          await context.answerCallbackQuery({ text: '✅ Выбор принят.' });
          if (nightGame !== null) {
            await publishRegularNightStart(context, nightGame, panelService, nightActionService, testGameService);
          }
          return;
        }
        const completion = await phaseService.completeNightIfAllActionsCompleted(callback.gameId, callback.phaseVersion);
        await context.answerCallbackQuery({ text: '✅ Выбор принят.' });
        await publishNightCompletion(context, completion);
        return;
      }

      if (callback.action === 'don-check') {
        if (callback.targetIndex === undefined) {
          throw new NightActionError('Не удалось определить цель.');
        }
        await nightActionService.submitDonCheck({ ...input, targetIndex: callback.targetIndex });
        const completion = await phaseService.completeNightIfAllActionsCompleted(callback.gameId, callback.phaseVersion);
        await context.answerCallbackQuery({ text: '✅ Проверка завершена.' });
        await publishNightCompletion(context, completion);
        return;
      }

      if (callback.action === 'maniac-skip') {
        await nightActionService.skipManiacAction(input);
        const completion = await phaseService.completeNightIfAllActionsCompleted(callback.gameId, callback.phaseVersion);
        await context.answerCallbackQuery({ text: '✅ Ход пропущен.' });
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
      await publishRoleConfirmationCompletion(context, result, panelService, nightActionService, testGameService);
    } catch (error) {
      logger.warn({ gameId: callback.gameId, userId: input.userId, error }, '[registerEphemeralCallbacks] Rejected ephemeral callback');
      const text = error instanceof EphemeralPanelError || error instanceof NightActionError
        ? error.message
        : 'Не удалось открыть скрытую панель. Попробуйте ещё раз.';
      await context.answerCallbackQuery({ text: `⚠️ ${text}`, show_alert: true });
    }
  });
}

async function publishRoleConfirmationCompletion(
  context: Context,
  result: RoleConfirmationResult,
  panelService: EphemeralPanelService,
  nightActionService: Pick<NightActionService, 'deliverNightPanels'>,
  testGameService: TestGameService,
): Promise<void> {
  if (!result.nightStarted || result.nightGame === undefined) {
    return;
  }

  if (result.nightGame.phase === 'NIGHT_PROSTITUTE') {
    const view = renderProstituteNightControl();
    const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
    await panelService.recordControlMessage(result.nightGame.id, controlMessage.message_id);
    await nightActionService.deliverNightPanels(result.nightGame);
    return;
  }
  await publishRegularNightStart(context, result.nightGame, panelService, nightActionService, testGameService);
}

async function publishRegularNightStart(
  context: Context,
  game: Game,
  panelService: Pick<EphemeralPanelService, 'recordControlMessage'>,
  nightActionService: Pick<NightActionService, 'deliverNightPanels'>,
  testGameService: TestGameService,
): Promise<void> {
  if (game.phase !== 'NIGHT') {
    return;
  }
  const testCompletion = await testGameService.playVirtualNightActions(game);
  if (testCompletion !== null) {
    await publishNightCompletion(context, testCompletion);
    return;
  }
  const view = renderNightControl();
  const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
  await panelService.recordControlMessage(game.id, controlMessage.message_id);
  await nightActionService.deliverNightPanels(game);
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
  const dawnText = renderNightEvent({
    gameId: completion.game.id,
    phaseVersion: completion.game.stateVersion,
    eliminatedDisplayNames: resolution.eliminatedPlayers.map((player) => player.displayName),
    savedDisplayNames: resolution.savedPlayers.map((player) => player.displayName),
    eliminatedManiacDisplayName: resolution.eliminatedManiacPlayer?.displayName ?? null,
  });
  await context.reply(dawnText);
  if (completion.kind === 'GAME_FINISHED') {
    await context.reply(renderFinalView(completion.finalization));
    return;
  }

  await context.reply(renderDayDiscussion());
}
