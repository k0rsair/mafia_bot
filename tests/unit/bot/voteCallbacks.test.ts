import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { registerVoteCallbacks } from '../../../src/bot/callbacks/voteCallbacks.js';
import { encodeVoteCallback } from '../../../src/bot/callbacks/callbackData.js';
import { createLogger } from '../../../src/observability/logger.js';

type CallbackHandler = (context: Context) => Promise<unknown>;

describe('day vote callbacks', () => {
  it('replaces a finished vote with its result and removes its keyboard', async () => {
    const handlers: CallbackHandler[] = [];
    const voteGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
    const nightGame = { ...voteGame, phase: 'NIGHT', stateVersion: 8 } as Game;
    const castVote = vi.fn().mockResolvedValue({ game: voteGame, votesCast: 3, votersTotal: 3, allVoted: true });
    const closeDayVote = vi.fn().mockResolvedValue({
      kind: 'DAY_VOTE_RESOLVED',
      game: nightGame,
      resolution: {
        resolution: { outcome: 'ELIMINATION', eliminatedPlayerId: 'player-2' },
        eliminatedPlayer: { id: 'player-2', displayName: 'Игрок 2' },
      },
    });
    const recordControlMessage = vi.fn().mockResolvedValue(undefined);
    const playVirtualNightActions = vi.fn().mockResolvedValue(null);
    const bot = {
      callbackQuery: vi.fn((_query: RegExp, handler: CallbackHandler) => handlers.push(handler)),
    } as unknown as Bot<Context>;
    const editMessageText = vi.fn().mockResolvedValue(true);
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });

    registerVoteCallbacks(
      bot,
      { castVote } as never,
      { renderVote: vi.fn().mockResolvedValue({ text: '🗳️ Дневное голосование', replyMarkup: { inline_keyboard: [[{ text: 'Игрок 2', callback_data: 'v:game-1:7:0' }]] } }) } as never,
      { closeDayVote, recordControlMessage } as never,
      { playVirtualNightActions } as never,
      createLogger({ logLevel: 'silent' }),
    );

    const handler = handlers[0];
    if (handler === undefined) {
      throw new Error('Vote callback handler was not registered');
    }
    const context = {
      callbackQuery: { data: encodeVoteCallback(voteGame.id, voteGame.stateVersion, 0), id: 'query-1' },
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 101 },
      editMessageText,
      answerCallbackQuery,
      reply,
    } as unknown as Context;

    await handler(context);

    expect(editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Дневное голосование завершено'),
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Игрок 2'),
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: '✅ Голос принят.' });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ночь наступила'), expect.any(Object));
    expect(recordControlMessage).toHaveBeenCalledWith(nightGame.id, 42);
  });
});
