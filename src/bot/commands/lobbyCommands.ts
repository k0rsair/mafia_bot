import type { Bot, Context } from 'grammy';

import { GameStartError, type GameService } from '../../application/GameService.js';
import type { GameFinalizationService } from '../../application/GameFinalizationService.js';
import type { PhaseService } from '../../application/PhaseService.js';
import type { DayService } from '../../application/DayService.js';
import { LobbyError, type LobbyService, type LobbySnapshot } from '../../application/LobbyService.js';
import type { AppConfig } from '../../config/env.js';
import type { AppLogger } from '../../observability/logger.js';
import { canManageGame, isGameGroup } from '../authorization/chatPermissions.js';
import { parseLobbyCallback } from '../callbacks/callbackData.js';
import { renderLobby } from '../views/lobbyView.js';
import { renderNightControl, renderRoleControl } from '../views/phaseView.js';

type LobbyHandlerDependencies = Readonly<{
  lobbyService: LobbyService;
  gameService: GameService;
  phaseService: PhaseService;
  dayService: DayService;
  gameFinalizationService: GameFinalizationService;
  config: Pick<AppConfig, 'lobbyMaxPlayers'>;
  logger: AppLogger;
}>;

export function registerLobbyHandlers(bot: Bot<Context>, dependencies: LobbyHandlerDependencies): void {
  bot.command('mafia', async (context) => {
    if (!isGameGroup(context)) {
      await context.reply('👥 Добавьте меня в группу или супергруппу, чтобы открыть лобби.');
      return;
    }

    const user = getLobbyUser(context);
    if (user === null || context.chat === undefined) {
      await context.reply('Не удалось определить игрока. Попробуйте ещё раз.');
      return;
    }

    const placeholder = await context.reply('🎭 Создаю лобби…');
    try {
      const snapshot = await dependencies.lobbyService.createLobby({
        ...user,
        chatId: String(context.chat.id),
        lobbyMessageId: placeholder.message_id,
        ...(context.chat.title === undefined ? {} : { chatTitle: context.chat.title }),
      });
      await editLobbyMessage(context, snapshot, dependencies.config.lobbyMaxPlayers, dependencies.logger);
    } catch (error) {
      dependencies.logger.error({ chatId: String(context.chat.id), error }, '[registerLobbyHandlers.mafia] Failed to create lobby');
      await context.api.editMessageText(context.chat.id, placeholder.message_id, `⚠️ ${toUserMessage(error)}`);
    }
  });

  bot.command('mafia_status', async (context) => {
    if (!isGameGroup(context) || context.chat === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }

    const lobby = await dependencies.lobbyService.getActiveLobby(String(context.chat.id));
    if (lobby === null) {
      const activeGame = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
      if (activeGame !== null) {
        await republishCurrentControl(context, activeGame, dependencies);
        return;
      }
      await context.reply('ℹ️ Открытого лобби сейчас нет. Используйте /mafia, чтобы создать его.');
      return;
    }

    await context.reply(renderLobby({ gameId: lobby.game.id, players: lobby.players, maxPlayers: dependencies.config.lobbyMaxPlayers }).text);
  });

  bot.command('startgame', async (context) => {
    await startGameFromContext(context, dependencies);
  });

  bot.command('startvote', async (context) => {
    if (!isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }

    const game = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
    if (game === null || game.phase !== 'DAY_DISCUSSION') {
      await context.reply('ℹ️ Запустить голосование можно только во время дневного обсуждения.');
      return;
    }
    if (!(await canManageGame(context, game.creatorId, dependencies.logger))) {
      await context.reply('🛡️ Запустить голосование может только автор лобби или администратор чата.');
      return;
    }

    const voteGame = await dependencies.phaseService.startDayVote(game);
    if (voteGame === null) {
      await context.reply('⚠️ Фаза уже изменилась. Проверьте /mafia_status.');
      return;
    }

    dependencies.logger.info({ gameId: voteGame.id, chatId: voteGame.chatId }, '[FIX:manual-vote-start] Organizer started day vote');
    const view = await dependencies.dayService.renderVote(voteGame);
    const controlMessage = await context.reply(`🗳️ Организатор завершил обсуждение. Голосование начинается!\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(voteGame.id, controlMessage.message_id);
  });

  bot.command('cancelgame', async (context) => {
    if (!isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }
    if (context.match.trim() !== 'confirm') {
      await context.reply('⚠️ Отмена остановит игру без раскрытия ролей. Для подтверждения используйте /cancelgame confirm.');
      return;
    }

    const game = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
    if (game === null) {
      await context.reply('ℹ️ Активной игры нет.');
      return;
    }
    if (!(await canManageGame(context, game.creatorId, dependencies.logger))) {
      await context.reply('🛡️ Отменить игру может только автор лобби или администратор чата.');
      return;
    }

    const cancelledGame = await dependencies.gameFinalizationService.cancelGame(game);
    await context.reply(cancelledGame === null ? '⚠️ Игра уже изменилась. Проверьте /mafia_status.' : '🛑 Игра отменена организатором. Роли не раскрываются.');
  });

  bot.command('extendroles', async (context) => {
    if (!isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }
    const game = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
    if (game === null || game.phase !== 'ROLE_CONFIRMATION') {
      await context.reply('ℹ️ Сейчас нет фазы подтверждения ролей.');
      return;
    }
    if (!(await canManageGame(context, game.creatorId, dependencies.logger))) {
      await context.reply('🛡️ Продлить подтверждение может только автор лобби или администратор чата.');
      return;
    }

    const extendedGame = await dependencies.phaseService.extendRoleConfirmation(game);
    if (extendedGame === null) {
      await context.reply('⚠️ Фаза уже изменилась. Проверьте /mafia_status.');
      return;
    }
    const view = renderRoleControl(extendedGame.id, extendedGame.stateVersion);
    const controlMessage = await context.reply(`⌛ Подтверждение ролей продлено.\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(extendedGame.id, controlMessage.message_id);
  });

  bot.callbackQuery(/^l:/, async (context) => {
    const callback = parseLobbyCallback(context.callbackQuery.data);
    if (callback === null) {
      await context.answerCallbackQuery({ text: '⚠️ Кнопка устарела. Откройте новое лобби.' });
      return;
    }

    const user = getLobbyUser(context);
    if (user === null || context.chat === undefined || !isGameGroup(context)) {
      await context.answerCallbackQuery({ text: '⚠️ Не удалось определить игрока.' });
      return;
    }

    const activeGame = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
    if (activeGame === null || activeGame.id !== callback.gameId) {
      await context.answerCallbackQuery({ text: '⚠️ Кнопка устарела. Откройте актуальное лобби.' });
      return;
    }

    try {
      if (callback.action === 'start') {
        await startGameFromContext(context, dependencies, callback.gameId);
        return;
      }

      const snapshot = callback.action === 'join'
        ? await dependencies.lobbyService.joinLobby(callback.gameId, user)
        : await dependencies.lobbyService.leaveLobby(callback.gameId, user.userId);
      await editLobbyMessage(context, snapshot, dependencies.config.lobbyMaxPlayers, dependencies.logger);
      await context.answerCallbackQuery({ text: callback.action === 'join' ? '✅ Вы в игре!' : '🚪 Вы вышли из лобби.' });
    } catch (error) {
      dependencies.logger.warn({ gameId: callback.gameId, userId: user.userId, error }, '[registerLobbyHandlers.callback] Rejected lobby callback');
      await context.answerCallbackQuery({ text: `⚠️ ${toUserMessage(error)}`, show_alert: true });
    }
  });
}

async function republishCurrentControl(
  context: Context,
  game: Readonly<{ id: string; phase: string; stateVersion: number }>,
  dependencies: Pick<LobbyHandlerDependencies, 'dayService' | 'phaseService'>,
): Promise<void> {
  if (game.phase === 'ROLE_CONFIRMATION') {
    const view = renderRoleControl(game.id, game.stateVersion);
    const controlMessage = await context.reply(`ℹ️ Фаза: подтверждение ролей.\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(game.id, controlMessage.message_id);
    return;
  }
  if (game.phase === 'NIGHT') {
    const view = renderNightControl(game.id, game.stateVersion);
    const controlMessage = await context.reply(`ℹ️ Фаза: ночь.\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(game.id, controlMessage.message_id);
    return;
  }
  if (game.phase === 'DAY_VOTE') {
    const gameForView = await dependencies.phaseService.getCurrentGame(game.id);
    if (gameForView !== null) {
      const view = await dependencies.dayService.renderVote(gameForView);
      const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
      await dependencies.phaseService.recordControlMessage(game.id, controlMessage.message_id);
      return;
    }
  }
  await context.reply(`ℹ️ Игра идёт. Текущая фаза: ${game.phase}.`);
}

async function startGameFromContext(context: Context, dependencies: LobbyHandlerDependencies, expectedGameId?: string): Promise<void> {
  if (!isGameGroup(context) || context.chat === undefined || context.from === undefined) {
    await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
    return;
  }

  const lobby = expectedGameId === undefined
    ? await dependencies.lobbyService.getActiveLobby(String(context.chat.id))
    : await dependencies.lobbyService.getLobby(expectedGameId);
  if (lobby === null) {
    await context.reply('ℹ️ Открытого лобби сейчас нет.');
    return;
  }
  if (lobby.game.chatId !== String(context.chat.id)) {
    await context.answerCallbackQuery({ text: '⚠️ Кнопка принадлежит другому чату.' });
    return;
  }

  if (!(await canManageGame(context, lobby.game.creatorId, dependencies.logger))) {
    await context.reply('🛡️ Начать игру может только автор лобби или администратор чата.');
    return;
  }

  try {
    const game = await dependencies.gameService.startGame(lobby.game.id);
    dependencies.logger.info({ gameId: game.id, chatId: game.chatId }, '[startGameFromContext] Game start accepted');
    const view = renderRoleControl(game.id, game.stateVersion);
    const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
    await dependencies.gameService.recordControlMessage(game.id, controlMessage.message_id);
    await context.answerCallbackQuery().catch(() => undefined);
  } catch (error) {
    dependencies.logger.warn({ gameId: lobby.game.id, error }, '[startGameFromContext] Game start rejected');
    const message = `⚠️ ${toUserMessage(error)}`;
    if (expectedGameId === undefined) {
      await context.reply(message);
    } else {
      await context.answerCallbackQuery({ text: message, show_alert: true });
    }
  }
}

async function editLobbyMessage(context: Context, snapshot: LobbySnapshot, maxPlayers: number, logger: AppLogger): Promise<void> {
  const view = renderLobby({ gameId: snapshot.game.id, players: snapshot.players, maxPlayers });
  try {
    await context.api.editMessageText(snapshot.game.chatId, snapshot.game.lobbyMessageId ?? 0, view.text, { reply_markup: view.replyMarkup });
  } catch (error) {
    logger.error({ gameId: snapshot.game.id, error }, '[editLobbyMessage] Failed to update lobby message');
    throw error;
  }
}

function getLobbyUser(context: Context): Readonly<{ userId: string; displayName: string; username?: string }> | null {
  if (context.from === undefined) {
    return null;
  }

  const displayName = [context.from.first_name, context.from.last_name].filter((part): part is string => Boolean(part)).join(' ').slice(0, 64);
  return {
    userId: String(context.from.id),
    displayName: displayName === '' ? 'Безымянный игрок' : displayName,
    ...(context.from.username === undefined ? {} : { username: context.from.username }),
  };
}

function toUserMessage(error: unknown): string {
  if (error instanceof LobbyError || error instanceof GameStartError) {
    return error.message;
  }

  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
