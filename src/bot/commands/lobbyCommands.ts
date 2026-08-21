import type { Bot, Context } from 'grammy';

import { GameStartError, type GameService } from '../../application/GameService.js';
import { EphemeralPanelError, type EphemeralPanelService, type RoleConfirmationResult } from '../../application/EphemeralPanelService.js';
import type { GameFinalizationService } from '../../application/GameFinalizationService.js';
import type { PhaseService } from '../../application/PhaseService.js';
import type { DayService } from '../../application/DayService.js';
import { LobbyError, type LobbyService, type LobbySnapshot } from '../../application/LobbyService.js';
import { NightActionError, type NightActionService } from '../../application/NightActionService.js';
import type { TestGameService } from '../../application/TestGameService.js';
import type { AppConfig } from '../../config/env.js';
import type { AppLogger } from '../../observability/logger.js';
import { canManageGame, isGameGroup } from '../authorization/chatPermissions.js';
import { parseLobbyCallback } from '../callbacks/callbackData.js';
import { publishNightCompletion } from '../callbacks/ephemeralCallbacks.js';
import type { TelegramEphemeralAdapter } from '../telegram/ephemeral.js';
import { renderLobby } from '../views/lobbyView.js';
import { renderNightControl, renderRoleControl } from '../views/phaseView.js';

type LobbyHandlerDependencies = Readonly<{
  lobbyService: LobbyService;
  gameService: GameService;
  phaseService: PhaseService;
  dayService: DayService;
  gameFinalizationService: GameFinalizationService;
  ephemeralPanelService: EphemeralPanelService;
  nightActionService: NightActionService;
  ephemeralAdapter: TelegramEphemeralAdapter;
  testGameService: TestGameService;
  config: Pick<AppConfig, 'lobbyMaxPlayers' | 'testGameEnabled'>;
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

  bot.command('testgame', async (context) => {
    if (!dependencies.config.testGameEnabled) {
      await context.reply('ℹ️ Тестовый режим выключен. Установите TEST_GAME_ENABLED=true только в тестовой среде.');
      return;
    }
    if (!isGameGroup(context) || context.chat === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }

    const user = getLobbyUser(context);
    if (user === null) {
      await context.reply('Не удалось определить игрока. Попробуйте ещё раз.');
      return;
    }

    const placeholder = await context.reply('🧪 Создаю тестовую игру с четырьмя виртуальными игроками…');
    try {
      const game = await dependencies.testGameService.createTestGame({
        chatId: String(context.chat.id),
        creatorId: user.userId,
        creatorDisplayName: user.displayName,
        ...(user.username === undefined ? {} : { creatorUsername: user.username }),
        ...(context.chat.title === undefined ? {} : { chatTitle: context.chat.title }),
        lobbyMessageId: placeholder.message_id,
      });
      const view = renderRoleControl();
      await context.api.editMessageText(context.chat.id, placeholder.message_id, `🧪 Тестовая игра готова. Четыре виртуальных игрока уже подтвердили роли.\n\n${view.text}`, { reply_markup: view.replyMarkup });
      await dependencies.gameService.recordControlMessage(game.id, placeholder.message_id);
      const delivery = await dependencies.ephemeralPanelService.deliverRolePanels(game);
      await publishAutomaticRoleDeliveryCompletion(context, delivery, dependencies);
      dependencies.logger.info({ gameId: game.id, chatId: game.chatId, virtualPlayerCount: 4 }, '[registerLobbyHandlers.testgame] Test game started');
    } catch (error) {
      dependencies.logger.error({ chatId: String(context.chat.id), error }, '[registerLobbyHandlers.testgame] Failed to start test game');
      await context.api.editMessageText(context.chat.id, placeholder.message_id, `⚠️ ${toUserMessage(error)}`);
    }
  });

  bot.command('roles_pending', async (context) => {
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
      dependencies.logger.warn({ gameId: game.id, chatId: game.chatId }, '[registerLobbyHandlers.rolesPending] Rejected non-manager request');
      await context.reply('🛡️ Список ожидающих подтверждения доступен только автору лобби или администратору чата.');
      return;
    }

    try {
      const players = await dependencies.lobbyService.listUnconfirmedRolePlayers(game.id);
      const text = players.length === 0
        ? '✅ Все игроки подтвердили получение роли.'
        : ['⌛ Ещё не подтвердили получение роли:', ...players.map((player, index) => `${index + 1}. ${player.displayName}`)].join('\n');
      await dependencies.ephemeralAdapter.sendText({
        chatId: String(context.chat.id),
        receiverUserId: String(context.from.id),
        text,
      });
      dependencies.logger.info(
        { gameId: game.id, chatId: game.chatId, phase: game.phase, pendingCount: players.length },
        '[registerLobbyHandlers.rolesPending] Sent pending role confirmations',
      );
    } catch (error) {
      dependencies.logger.error({ gameId: game.id, chatId: game.chatId, error }, '[registerLobbyHandlers.rolesPending] Failed to send pending role confirmations');
      await context.reply(`⚠️ ${toUserMessage(error)}`);
    }
  });

  bot.command('restore_panel', async (context) => {
    if (!isGameGroup(context) || context.chat === undefined || context.from === undefined) {
      await context.reply('👥 Эта команда доступна только в игровом групповом чате.');
      return;
    }

    const game = await dependencies.lobbyService.getActiveGame(String(context.chat.id));
    if (game === null) {
      await context.reply('ℹ️ Активной игры нет.');
      return;
    }

    try {
      await dependencies.ephemeralPanelService.restorePanel({
        gameId: game.id,
        chatId: String(context.chat.id),
        userId: String(context.from.id),
      });
      dependencies.logger.info({ gameId: game.id, chatId: game.chatId, phase: game.phase }, '[registerLobbyHandlers.restorePanel] Restored personal panel');
    } catch (error) {
      dependencies.logger.warn({ gameId: game.id, chatId: game.chatId, phase: game.phase, error }, '[registerLobbyHandlers.restorePanel] Panel restoration rejected');
      await context.reply(`⚠️ ${toUserMessage(error)}`);
    }
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
    await dependencies.testGameService.castVirtualVotes(voteGame);
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
    const view = renderRoleControl();
    const controlMessage = await context.reply(`⌛ Подтверждение ролей продлено.\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(extendedGame.id, controlMessage.message_id);
    const delivery = await dependencies.ephemeralPanelService.deliverRolePanels(extendedGame);
    await publishAutomaticRoleDeliveryCompletion(context, delivery, dependencies);
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
    const view = renderRoleControl();
    const controlMessage = await context.reply(`ℹ️ Фаза: подтверждение ролей.\n\n${view.text}`, { reply_markup: view.replyMarkup });
    await dependencies.phaseService.recordControlMessage(game.id, controlMessage.message_id);
    return;
  }
  if (game.phase === 'NIGHT') {
    const view = renderNightControl();
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
    const view = renderRoleControl();
    const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
    await dependencies.gameService.recordControlMessage(game.id, controlMessage.message_id);
    const delivery = await dependencies.ephemeralPanelService.deliverRolePanels(game);
    await publishAutomaticRoleDeliveryCompletion(context, delivery, dependencies);
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

async function publishAutomaticRoleDeliveryCompletion(
  context: Context,
  result: RoleConfirmationResult,
  dependencies: LobbyHandlerDependencies,
): Promise<void> {
  if (!result.nightStarted || result.nightGame === undefined) {
    return;
  }

  const testCompletion = await dependencies.testGameService.playVirtualNightActions(result.nightGame);
  if (testCompletion !== null) {
    await publishNightCompletion(context, testCompletion);
    return;
  }

  const view = renderNightControl();
  const controlMessage = await context.reply(view.text, { reply_markup: view.replyMarkup });
  await dependencies.gameService.recordControlMessage(result.nightGame.id, controlMessage.message_id);
  await dependencies.nightActionService.deliverNightPanels(result.nightGame);
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
  if (error instanceof LobbyError || error instanceof GameStartError || error instanceof EphemeralPanelError || error instanceof NightActionError) {
    return error.message;
  }

  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
