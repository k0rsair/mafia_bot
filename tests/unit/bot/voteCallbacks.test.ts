import type { Game } from '@prisma/client';
import type { Bot, Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { publishVoteClosure, registerVoteCallbacks } from '../../../src/bot/callbacks/voteCallbacks.js';
import { encodeVoteCallback, encodeVoteConfirmationCallback } from '../../../src/bot/callbacks/callbackData.js';
import { createLogger } from '../../../src/observability/logger.js';

type CallbackHandler = (context: Context) => Promise<unknown>;

describe('day vote callbacks', () => {
  it('replaces a finished vote with its result and removes its keyboard', async () => {
    const handlers: CallbackHandler[] = [];
    const voteGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
    const nightGame = { ...voteGame, phase: 'NIGHT', stateVersion: 8 } as Game;
    const confirmVote = vi.fn().mockResolvedValue({ game: voteGame, votesCast: 3, votersTotal: 3, allVoted: true });
    const closeDayVote = vi.fn().mockResolvedValue({
      kind: 'DAY_VOTE_RESOLVED',
      game: nightGame,
      resolution: {
        resolution: { outcome: 'ELIMINATION', eliminatedPlayerIds: ['player-2'] },
        eliminatedPlayers: [{ id: 'player-2', displayName: 'Игрок 2' }],
        alibiedPlayers: [],
        voteDetails: [
          { voterDisplayName: 'Игрок 1', targetDisplayName: 'Игрок 2' },
          { voterDisplayName: 'Игрок 3', targetDisplayName: null },
        ],
      },
    });
    const recordControlMessage = vi.fn().mockResolvedValue(undefined);
    const deliverNightPanels = vi.fn().mockResolvedValue(undefined);
    const playVirtualNightActions = vi.fn().mockResolvedValue(null);
    const bot = {
      callbackQuery: vi.fn((_query: RegExp, handler: CallbackHandler) => handlers.push(handler)),
    } as unknown as Bot<Context>;
    const editMessageText = vi.fn().mockResolvedValue(true);
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });

    registerVoteCallbacks(
      bot,
      { confirmVote } as never,
      { renderVote: vi.fn().mockResolvedValue({ text: '🗳️ Дневное голосование', replyMarkup: { inline_keyboard: [[{ text: 'Игрок 2', callback_data: 'v:game-1:7:0' }]] } }) } as never,
      { closeDayVote, recordControlMessage, getCurrentGame: vi.fn().mockResolvedValue(nightGame) } as never,
      { refreshPanel: vi.fn().mockResolvedValue(undefined), openPanel: vi.fn().mockResolvedValue(undefined), deliverVotePanels: vi.fn() } as never,
      { deliverNightPanels } as never,
      { playVirtualNightActions } as never,
      createLogger({ logLevel: 'silent' }),
    );

    const handler = handlers[0];
    if (handler === undefined) {
      throw new Error('Vote callback handler was not registered');
    }
    const context = {
      callbackQuery: { data: encodeVoteConfirmationCallback(voteGame.id, voteGame.stateVersion), id: 'query-1' },
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
    expect(editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Игрок 3 → пропуск'),
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(confirmVote).toHaveBeenCalledWith({
      gameId: voteGame.id,
      phaseVersion: voteGame.stateVersion,
      chatId: voteGame.chatId,
      userId: '101',
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: '✅ Выбор подтверждён.' });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ночь наступила'), expect.any(Object));
    expect(recordControlMessage).toHaveBeenCalledWith(nightGame.id, 42);
    expect(deliverNightPanels).toHaveBeenCalledWith(nightGame);
  });

  it('saves a choice as a draft until the player presses confirmation', async () => {
    const handlers: CallbackHandler[] = [];
    const voteGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_NOMINATION', stateVersion: 7 } as Game;
    const castVote = vi.fn().mockResolvedValue({ game: voteGame, votesCast: 0, votersTotal: 3, allVoted: false });
    const refreshPanel = vi.fn().mockResolvedValue(undefined);
    const confirmVote = vi.fn();
    const renderVote = vi.fn().mockResolvedValue({ text: '📣 Номинации\nПодтверждено: 0/3', replyMarkup: { inline_keyboard: [] } });
    const bot = {
      callbackQuery: vi.fn((_query: RegExp, handler: CallbackHandler) => handlers.push(handler)),
    } as unknown as Bot<Context>;
    const editMessageText = vi.fn().mockResolvedValue(true);
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);

    registerVoteCallbacks(
      bot,
      { castVote, confirmVote } as never,
      { renderVote } as never,
      { getCurrentGame: vi.fn().mockResolvedValue(voteGame), closeDayVote: vi.fn() } as never,
      { refreshPanel } as never,
      {} as never,
      {} as never,
      createLogger({ logLevel: 'silent' }),
    );

    const handler = handlers[0];
    if (handler === undefined) throw new Error('Vote handler was not registered');
    await handler({
      callbackQuery: { data: encodeVoteCallback(voteGame.id, voteGame.stateVersion, 0), id: 'query-1', message: { ephemeral_message_id: 99 } },
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 101 },
      editMessageText,
      answerCallbackQuery,
    } as unknown as Context);

    expect(castVote).toHaveBeenCalledWith(expect.objectContaining({ action: 'candidate', targetIndex: 0 }));
    expect(confirmVote).not.toHaveBeenCalled();
    expect(refreshPanel).toHaveBeenCalledWith(expect.objectContaining({ ephemeralMessageId: 99 }));
    expect(editMessageText).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: '📝 Выбор сохранён. Подтвердите его отдельной кнопкой.' });
  });

  it('does not reopen a vote control when another final confirmation has already closed it', async () => {
    const handlers: CallbackHandler[] = [];
    const voteGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_FINAL_DECISION', stateVersion: 7 } as Game;
    const nextGame = { ...voteGame, phase: 'NIGHT', stateVersion: 8 } as Game;
    const bot = {
      callbackQuery: vi.fn((_query: RegExp, handler: CallbackHandler) => handlers.push(handler)),
    } as unknown as Bot<Context>;
    const editMessageText = vi.fn();
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);

    registerVoteCallbacks(
      bot,
      { confirmVote: vi.fn().mockResolvedValue({ game: voteGame, votesCast: 3, votersTotal: 3, allVoted: true }) } as never,
      { renderVote: vi.fn().mockResolvedValue({ text: '⚖️ Финальное решение', replyMarkup: { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: 'v:game-1:7:confirm' }]] } }) } as never,
      { closeDayVote: vi.fn().mockResolvedValue(null), getCurrentGame: vi.fn().mockResolvedValue(nextGame) } as never,
      { openPanel: vi.fn().mockResolvedValue(undefined), refreshPanel: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      createLogger({ logLevel: 'silent' }),
    );

    const handler = handlers[0];
    if (handler === undefined) throw new Error('Vote handler was not registered');
    await handler({
      callbackQuery: { data: encodeVoteConfirmationCallback(voteGame.id, voteGame.stateVersion), id: 'query-1' },
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 101 },
      editMessageText,
      answerCallbackQuery,
    } as unknown as Context);

    expect(editMessageText).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: '✅ Выбор подтверждён.' });
  });

  it('publishes the primary vote after a command closes nominations', async () => {
    const nominationGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_NOMINATION', stateVersion: 7, controlMessageId: 41 } as Game;
    const primaryGame = { ...nominationGame, phase: 'DAY_VOTE', stateVersion: 8 } as Game;
    const editMessageText = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });
    const recordControlMessage = vi.fn().mockResolvedValue(undefined);

    const deliverVotePanels = vi.fn().mockResolvedValue(undefined);
    const castVirtualVotes = vi.fn().mockResolvedValue(null);

    await publishVoteClosure(
      { api: { editMessageText }, reply } as unknown as Context,
      { kind: 'DAY_VOTE_STARTED', game: primaryGame },
      { renderVote: vi.fn().mockResolvedValue({ text: '🗳️ Основное голосование', replyMarkup: { inline_keyboard: [] } }) } as never,
      { getCurrentGame: vi.fn().mockResolvedValue(primaryGame), recordControlMessage } as never,
      { deliverVotePanels } as never,
      {} as never,
      { castVirtualVotes } as never,
    );

    expect(editMessageText).toHaveBeenCalledWith(
      nominationGame.chatId,
      nominationGame.controlMessageId,
      '📣 Номинации завершены. Начинается основное голосование.',
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(castVirtualVotes).toHaveBeenCalledWith(primaryGame);
    expect(deliverVotePanels).toHaveBeenCalledWith(primaryGame);
    expect(reply).toHaveBeenCalledWith('🗳️ Основное голосование', { reply_markup: { inline_keyboard: [] } });
    expect(recordControlMessage).toHaveBeenCalledWith(primaryGame.id, 42);
  });

  it('lets a virtual prostitute act before opening the regular night after a city vote', async () => {
    const voteGame = { id: 'game-1', chatId: '-1001', phase: 'DAY_VOTE', stateVersion: 7, controlMessageId: 41 } as Game;
    const prostituteNight = { ...voteGame, phase: 'NIGHT_PROSTITUTE', stateVersion: 8 } as Game;
    const regularNight = { ...voteGame, phase: 'NIGHT', stateVersion: 9 } as Game;
    const playVirtualProstituteAction = vi.fn().mockResolvedValue(regularNight);
    const playVirtualNightActions = vi.fn().mockResolvedValue(null);
    const deliverNightPanels = vi.fn().mockResolvedValue(undefined);
    const recordControlMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue({ message_id: 42 });

    await publishVoteClosure(
      { api: { editMessageText: vi.fn().mockResolvedValue(true) }, reply } as unknown as Context,
      {
        kind: 'DAY_VOTE_RESOLVED',
        game: prostituteNight,
        resolution: {
          resolution: { outcome: 'SKIP', eliminatedPlayerId: null, eliminatedPlayerIds: [], tiedPlayerIds: [] },
          eliminatedPlayers: [],
          eliminatedPlayer: null,
          alibiedPlayers: [],
          voteDetails: [],
        },
      },
      {} as never,
      {
        getCurrentGame: vi.fn()
          .mockResolvedValueOnce(prostituteNight)
          .mockResolvedValueOnce(regularNight),
        recordControlMessage,
      } as never,
      {} as never,
      { deliverNightPanels } as never,
      { playVirtualProstituteAction, playVirtualNightActions } as never,
    );

    expect(playVirtualProstituteAction).toHaveBeenCalledWith(prostituteNight);
    expect(playVirtualNightActions).toHaveBeenCalledWith(regularNight);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ночь наступила'), expect.any(Object));
    expect(deliverNightPanels).toHaveBeenCalledWith(regularNight);
  });
});
