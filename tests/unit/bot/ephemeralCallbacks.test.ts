import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { registerEphemeralCallbacks } from '../../../src/bot/callbacks/ephemeralCallbacks.js';
import { encodeGameCallback } from '../../../src/bot/callbacks/callbackData.js';
import { createLogger } from '../../../src/observability/logger.js';

type CallbackHandler = (context: Context) => Promise<unknown>;

describe('ephemeral role-panel callbacks', () => {
  it('publishes the night control when opening the last role panel starts night', async () => {
    const handlers: CallbackHandler[] = [];
    const nightGame = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 8 } as Game;
    const openPanel = vi.fn().mockResolvedValue({ nightStarted: true, nightGame });
    const recordControlMessage = vi.fn().mockResolvedValue(undefined);
    const playVirtualNightActions = vi.fn().mockResolvedValue(null);
    const bot = {
      callbackQuery: vi.fn((_query: RegExp, handler: CallbackHandler) => handlers.push(handler)),
    } as unknown as Bot<Context>;
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });

    registerEphemeralCallbacks(
      bot,
      { openPanel, recordControlMessage } as never,
      {} as never,
      {} as never,
      { playVirtualNightActions } as never,
      createLogger({ logLevel: 'silent' }),
    );

    const handler = handlers[0];
    if (handler === undefined) {
      throw new Error('Game callback handler was not registered');
    }
    const context = {
      callbackQuery: { data: encodeGameCallback(nightGame.id, 7, 'panel'), id: 'query-1' },
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 101 },
      answerCallbackQuery,
      reply,
    } as unknown as Context;

    await handler(context);

    expect(openPanel).toHaveBeenCalledWith({
      gameId: nightGame.id,
      phaseVersion: 7,
      chatId: nightGame.chatId,
      userId: '101',
      callbackQueryId: 'query-1',
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith();
    expect(playVirtualNightActions).toHaveBeenCalledWith(nightGame);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Ночь наступила'),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
    expect(recordControlMessage).toHaveBeenCalledWith(nightGame.id, 42);
  });
});
