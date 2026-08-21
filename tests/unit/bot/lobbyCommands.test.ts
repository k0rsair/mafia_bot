import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { registerLobbyHandlers } from '../../../src/bot/commands/lobbyCommands.js';
import { createLogger } from '../../../src/observability/logger.js';

type CommandHandler = (context: Context) => Promise<unknown>;

type HandlerSetup = Readonly<{
  getCommand: (name: string) => CommandHandler;
  getActiveGame: ReturnType<typeof vi.fn>;
  listUnconfirmedRolePlayers: ReturnType<typeof vi.fn>;
  restorePanel: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
}>;

function setupHandlers(game: Game | null): HandlerSetup {
  const handlers = new Map<string, CommandHandler>();
  const getActiveGame = vi.fn().mockResolvedValue(game);
  const listUnconfirmedRolePlayers = vi.fn().mockResolvedValue([{ userId: 'player-2', displayName: 'Игрок 2' }]);
  const restorePanel = vi.fn().mockResolvedValue(undefined);
  const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 42 });
  const bot = {
    command: vi.fn((name: string, handler: CommandHandler) => {
      handlers.set(name, handler);
    }),
    callbackQuery: vi.fn(),
  } as unknown as Bot<Context>;

  registerLobbyHandlers(bot, {
    lobbyService: { getActiveGame, listUnconfirmedRolePlayers },
    gameService: {},
    phaseService: {},
    dayService: {},
    gameFinalizationService: {},
    ephemeralPanelService: { restorePanel },
    ephemeralAdapter: { sendText },
    config: { lobbyMaxPlayers: 20 },
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
    listUnconfirmedRolePlayers,
    restorePanel,
    sendText,
  };
}

function createGroupContext(userId: number, memberStatus: string = 'member'): Readonly<{ context: Context; reply: ReturnType<typeof vi.fn> }> {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  return {
    context: {
      chat: { id: -1001, type: 'supergroup' },
      from: { id: userId },
      reply,
      api: { getChatMember: vi.fn().mockResolvedValue({ status: memberStatus }) },
    } as unknown as Context,
    reply,
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

  it('reports when a personal panel cannot be restored without an active game', async () => {
    const handlers = setupHandlers(null);
    const { context, reply } = createGroupContext(202);

    await handlers.getCommand('restore_panel')(context);

    expect(handlers.restorePanel).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('ℹ️ Активной игры нет.');
  });
});
