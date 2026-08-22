import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { registerLobbyHandlers } from '../../../src/bot/commands/lobbyCommands.js';
import { createLogger } from '../../../src/observability/logger.js';

type CommandHandler = (context: Context) => Promise<unknown>;

type HandlerSetup = Readonly<{
  getCommand: (name: string) => CommandHandler;
  getActiveGame: ReturnType<typeof vi.fn>;
  getActiveLobby: ReturnType<typeof vi.fn>;
  recordLobbyMessage: ReturnType<typeof vi.fn>;
  listUnconfirmedRolePlayers: ReturnType<typeof vi.fn>;
  restorePanel: ReturnType<typeof vi.fn>;
  restoreVotePanel: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  createTestGame: ReturnType<typeof vi.fn>;
  deliverRolePanels: ReturnType<typeof vi.fn>;
  deliverVotePanels: ReturnType<typeof vi.fn>;
  recordControlMessage: ReturnType<typeof vi.fn>;
}>;

function setupHandlers(game: Game | null, testGameEnabled: boolean = false): HandlerSetup {
  const handlers = new Map<string, CommandHandler>();
  const getActiveGame = vi.fn().mockResolvedValue(game);
  const getActiveLobby = vi.fn().mockResolvedValue(null);
  const recordLobbyMessage = vi.fn().mockResolvedValue(undefined);
  const listUnconfirmedRolePlayers = vi.fn().mockResolvedValue([{ userId: 'player-2', displayName: 'Игрок 2' }]);
  const restorePanel = vi.fn().mockResolvedValue(undefined);
  const restoreVotePanel = vi.fn().mockResolvedValue(undefined);
  const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 42 });
  const createTestGame = vi.fn().mockResolvedValue({
    id: 'test-game',
    chatId: '-1001',
    creatorId: '101',
    phase: 'ROLE_CONFIRMATION',
    stateVersion: 7,
  } as Game);
  const deliverRolePanels = vi.fn().mockResolvedValue({ nightStarted: false });
  const deliverVotePanels = vi.fn().mockResolvedValue(undefined);
  const recordControlMessage = vi.fn().mockResolvedValue(undefined);
  const bot = {
    command: vi.fn((name: string, handler: CommandHandler) => {
      handlers.set(name, handler);
    }),
    callbackQuery: vi.fn(),
  } as unknown as Bot<Context>;

  registerLobbyHandlers(bot, {
    lobbyService: { getActiveGame, getActiveLobby, listUnconfirmedRolePlayers, recordLobbyMessage },
    gameService: { recordControlMessage },
    phaseService: {},
    dayService: {},
    gameFinalizationService: {},
    ephemeralPanelService: { restorePanel, deliverRolePanels },
    votePanelService: { restorePanel: restoreVotePanel, deliverVotePanels },
    ephemeralAdapter: { sendText },
    testGameService: { createTestGame },
    config: { lobbyMaxPlayers: 15, testGameEnabled },
    logger: createLogger({ logLevel: 'silent' }),
  } as never);

  return {
    getCommand: (name) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        throw new Error(`Command handler was not registered: ${name}`);
      }
      return handler;
    },
    getActiveGame,
    getActiveLobby,
    recordLobbyMessage,
    listUnconfirmedRolePlayers,
    restorePanel,
    restoreVotePanel,
    sendText,
    createTestGame,
    deliverRolePanels,
    deliverVotePanels,
    recordControlMessage,
  };
}

function createGroupContext(userId: number, memberStatus: string = 'member'): Readonly<{
  context: Context;
  reply: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}> {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const editMessageText = vi.fn().mockResolvedValue(true);
  return {
    context: {
      chat: { id: -1001, type: 'supergroup' },
      from: { id: userId },
      reply,
      api: { getChatMember: vi.fn().mockResolvedValue({ status: memberStatus }), editMessageText },
    } as unknown as Context,
    reply,
    editMessageText,
  };
}

describe('role confirmation commands', () => {
  const roleConfirmationGame = {
    id: 'game-1',
    chatId: '-1001',
    creatorId: '101',
    phase: 'ROLE_CONFIRMATION',
    stateVersion: 7,
  } as Game;

  it('sends pending role confirmations only to the organiser personal panel', async () => {
    const handlers = setupHandlers(roleConfirmationGame);
    const { context, reply } = createGroupContext(101);

    await handlers.getCommand('roles_pending')(context);

    expect(handlers.listUnconfirmedRolePlayers).toHaveBeenCalledWith(roleConfirmationGame.id);
    expect(handlers.sendText).toHaveBeenCalledWith({
      chatId: roleConfirmationGame.chatId,
      receiverUserId: '101',
      text: '⌛ Ещё не подтвердили получение роли:\n1. Игрок 2',
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it('allows a chat administrator to request pending role confirmations', async () => {
    const handlers = setupHandlers(roleConfirmationGame);
    const { context, reply } = createGroupContext(202, 'administrator');

    await handlers.getCommand('roles_pending')(context);

    expect(handlers.sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: roleConfirmationGame.chatId,
      receiverUserId: '202',
    }));
    expect(reply).not.toHaveBeenCalled();
  });

  it('reports privately when every player has confirmed their role', async () => {
    const handlers = setupHandlers(roleConfirmationGame);
    handlers.listUnconfirmedRolePlayers.mockResolvedValue([]);
    const { context, reply } = createGroupContext(101);

    await handlers.getCommand('roles_pending')(context);

    expect(handlers.sendText).toHaveBeenCalledWith({
      chatId: roleConfirmationGame.chatId,
      receiverUserId: '101',
      text: '✅ Все игроки подтвердили получение роли.',
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it('rejects a pending-role request from a regular player', async () => {
    const handlers = setupHandlers(roleConfirmationGame);
    const { context, reply } = createGroupContext(202);

    await handlers.getCommand('roles_pending')(context);

    expect(handlers.listUnconfirmedRolePlayers).not.toHaveBeenCalled();
    expect(handlers.sendText).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('🛡️ Список ожидающих подтверждения доступен только автору лобби или администратору чата.');
  });

  it('rejects a pending-role request outside role confirmation', async () => {
    const handlers = setupHandlers({ ...roleConfirmationGame, phase: 'NIGHT' } as Game);
    const { context, reply } = createGroupContext(101);

    await handlers.getCommand('roles_pending')(context);

    expect(handlers.listUnconfirmedRolePlayers).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('ℹ️ Сейчас нет фазы подтверждения ролей.');
  });

  it('restores a participant personal panel without posting a group message', async () => {
    const handlers = setupHandlers(roleConfirmationGame);
    const { context, reply } = createGroupContext(202);

    await handlers.getCommand('restore_panel')(context);

    expect(handlers.restorePanel).toHaveBeenCalledWith({
      gameId: roleConfirmationGame.id,
      chatId: roleConfirmationGame.chatId,
      userId: '202',
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it('restores the personal city vote panel during a city round', async () => {
    const cityVoteGame = { ...roleConfirmationGame, phase: 'DAY_VOTE', stateVersion: 8 } as Game;
    const handlers = setupHandlers(cityVoteGame);
    const { context, reply } = createGroupContext(202);

    await handlers.getCommand('restore_panel')(context);

    expect(handlers.restoreVotePanel).toHaveBeenCalledWith({
      gameId: cityVoteGame.id,
      chatId: cityVoteGame.chatId,
      userId: '202',
      phaseVersion: cityVoteGame.stateVersion,
    });
    expect(handlers.restorePanel).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('reports when a personal panel cannot be restored without an active game', async () => {
    const handlers = setupHandlers(null);
    const { context, reply } = createGroupContext(202);

    await handlers.getCommand('restore_panel')(context);

    expect(handlers.restorePanel).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('ℹ️ Активной игры нет.');
  });

  it('keeps the test-game command disabled unless the environment enables it', async () => {
    const handlers = setupHandlers(null);
    const { context, reply } = createGroupContext(101);

    await handlers.getCommand('testgame')(context);

    expect(handlers.createTestGame).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('ℹ️ Тестовый режим выключен. Установите TEST_GAME_ENABLED=true только в тестовой среде.');
  });

  it('starts an enabled test game with a group control message', async () => {
    const handlers = setupHandlers(null, true);
    const { context, editMessageText } = createGroupContext(101);

    await handlers.getCommand('testgame')(context);

    expect(handlers.createTestGame).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      creatorId: '101',
      lobbyMessageId: 1,
    }));
    expect(handlers.recordControlMessage).toHaveBeenCalledWith('test-game', 1);
    expect(handlers.deliverRolePanels).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-game' }));
    expect(editMessageText).toHaveBeenCalledWith(-1001, 1, expect.stringContaining('Восемь виртуальных игроков уже подтвердили роли.'), expect.objectContaining({ reply_markup: expect.any(Object) }));
  });
});

describe('mafia_status lobby control', () => {
  it('republishes an open lobby with join, leave and start buttons', async () => {
    const lobbyGame = { id: 'game-1', chatId: '-1001', creatorId: '101', phase: 'LOBBY', stateVersion: 1 } as Game;
    const handlers = setupHandlers(null);
    handlers.getActiveLobby.mockResolvedValue({
      game: lobbyGame,
      players: [{ id: 'player-1', userId: '101', displayName: 'Организатор' }],
    });
    const { context, reply } = createGroupContext(101);

    await handlers.getCommand('mafia_status')(context);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Лобби «Мафии» открыто'),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Участвовать', callback_data: 'l:game-1:join' },
              { text: '🚪 Выйти', callback_data: 'l:game-1:leave' },
            ],
            [{ text: '▶️ Начать игру', callback_data: 'l:game-1:start' }],
          ],
        },
      }),
    );
    expect(handlers.recordLobbyMessage).toHaveBeenCalledWith(lobbyGame.id, 1);
    expect(handlers.getActiveGame).not.toHaveBeenCalled();
  });
});
