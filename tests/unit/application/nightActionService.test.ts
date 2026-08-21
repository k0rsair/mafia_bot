import type { Game, NightAction, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { NightActionService, type NightActionError } from '../../../src/application/NightActionService.js';
import type { TelegramEphemeralAdapter } from '../../../src/bot/telegram/ephemeral.js';
import type { GameRepository } from '../../../src/infrastructure/repositories/GameRepository.js';
import type { NightActionRepository } from '../../../src/infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('NightActionService commissioner checks', () => {
  it('allows exactly one revealed commissioner check per night', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 7 } as Game;
    const commissioner = { id: 'commissioner-player', userId: 'user-1', role: 'COMMISSIONER', status: 'ALIVE' } as Player;
    const firstTarget = { id: 'player-2', userId: 'user-2', displayName: 'Игрок 2', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const secondTarget = { id: 'player-3', userId: 'user-3', displayName: 'Игрок 3', role: 'MAFIA', status: 'ALIVE' } as Player;
    const createSingleUseAction = vi.fn().mockResolvedValueOnce({ id: 'action-1' }).mockResolvedValueOnce(null);
    const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 1 });
    const service = new NightActionService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {
        findByGameAndUserId: vi.fn().mockResolvedValue(commissioner),
        listAlivePlayers: vi.fn().mockResolvedValue([commissioner, firstTarget, secondTarget]),
      } as unknown as PlayerRepository,
      {
        createSingleUseAction,
        upsertAction: vi.fn(),
      } as unknown as NightActionRepository,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );
    const input = { gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: commissioner.userId, callbackQueryId: 'query-1' };

    await service.submitTarget({ ...input, targetIndex: 1 });
    await expect(service.submitTarget({ ...input, targetIndex: 2 })).rejects.toEqual(expect.objectContaining<Partial<NightActionError>>({
      message: 'Вы уже завершили проверку этой ночью.',
    }));

    expect(createSingleUseAction).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Игрок 2') }));
  });

  it('allows the doctor to save exactly one player per night', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 7 } as Game;
    const doctor = { id: 'doctor-player', userId: 'user-1', role: 'DOCTOR', status: 'ALIVE' } as Player;
    const firstTarget = { id: 'player-2', userId: 'user-2', displayName: 'Игрок 2', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const secondTarget = { id: 'player-3', userId: 'user-3', displayName: 'Игрок 3', role: 'MAFIA', status: 'ALIVE' } as Player;
    const createSingleUseAction = vi.fn().mockResolvedValueOnce({ id: 'action-1' }).mockResolvedValueOnce(null);
    const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 1 });
    const service = new NightActionService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {
        findByGameAndUserId: vi.fn().mockResolvedValue(doctor),
        listAlivePlayers: vi.fn().mockResolvedValue([doctor, firstTarget, secondTarget]),
      } as unknown as PlayerRepository,
      { createSingleUseAction, upsertAction: vi.fn() } as unknown as NightActionRepository,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );
    const input = { gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: doctor.userId, callbackQueryId: 'query-1' };

    await service.submitTarget({ ...input, targetIndex: 1 });
    await expect(service.submitTarget({ ...input, targetIndex: 2 })).rejects.toEqual(expect.objectContaining<Partial<NightActionError>>({
      message: 'Вы уже выбрали, кого спасать этой ночью.',
    }));

    expect(createSingleUseAction).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});

describe('NightActionService panel restoration', () => {
  it('opens a current night panel without a callback query ID', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 7 } as Game;
    const civilian = { id: 'civilian-player', userId: 'user-1', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 1 });
    const service = new NightActionService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      { findByGameAndUserId: vi.fn().mockResolvedValue(civilian) } as unknown as PlayerRepository,
      {} as NightActionRepository,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await service.openNightPanel({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      chatId: game.chatId,
      userId: civilian.userId,
    });

    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: game.chatId,
      receiverUserId: civilian.userId,
    }));
    expect(sendText.mock.calls[0]?.[0]).not.toHaveProperty('callbackQueryId');
  });
});

describe('NightActionService mafia council', () => {
  it('shows mafia drafts in a private council and closes every mafia panel after confirmation', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 7 } as Game;
    const mafiaOne = { id: 'mafia-1', userId: 'user-1', displayName: 'Мафия 1', role: 'MAFIA', status: 'ALIVE' } as Player;
    const mafiaTwo = { id: 'mafia-2', userId: 'user-2', displayName: 'Мафия 2', role: 'MAFIA', status: 'ALIVE' } as Player;
    const civilian = { id: 'civilian-1', userId: 'user-3', displayName: 'Мирный', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const teammateDraft = {
      actionType: 'MAFIA_KILL', actorPlayerId: mafiaTwo.id, targetPlayerId: civilian.id, confirmedAt: null,
    } as NightAction;
    const ownDraft = {
      actionType: 'MAFIA_KILL', actorPlayerId: mafiaOne.id, targetPlayerId: civilian.id, confirmedAt: null,
    } as NightAction;
    const ownConfirmedDraft = {
      actionType: 'MAFIA_KILL', actorPlayerId: mafiaOne.id, targetPlayerId: civilian.id, confirmedAt: new Date(),
    } as NightAction;
    const teammateConfirmedDraft = {
      actionType: 'MAFIA_KILL', actorPlayerId: mafiaTwo.id, targetPlayerId: civilian.id, confirmedAt: new Date(),
    } as NightAction;
    const upsertMafiaDraft = vi.fn().mockResolvedValue({});
    const confirmMafiaDraft = vi.fn().mockResolvedValue(true);
    const sendText = vi.fn()
      .mockResolvedValueOnce({ ephemeral_message_id: 42 })
      .mockResolvedValueOnce({ ephemeral_message_id: 43 });
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteEphemeralMessage = vi.fn().mockResolvedValue(undefined);
    const service = new NightActionService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {
        findByGameAndUserId: vi.fn().mockImplementation(async (_gameId, userId) => (
          userId === mafiaTwo.userId ? mafiaTwo : mafiaOne
        )),
        listAlivePlayers: vi.fn().mockResolvedValue([mafiaOne, mafiaTwo, civilian]),
      } as unknown as PlayerRepository,
      {
        upsertMafiaDraft,
        confirmMafiaDraft,
        listActions: vi.fn()
          .mockResolvedValueOnce([teammateDraft, ownDraft])
          .mockResolvedValueOnce([teammateDraft, ownDraft])
          .mockResolvedValueOnce([teammateDraft, ownConfirmedDraft])
          .mockResolvedValueOnce([teammateConfirmedDraft, ownConfirmedDraft]),
      } as unknown as NightActionRepository,
      { sendText, editText, deleteEphemeralMessage } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );
    const input = { gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: mafiaOne.userId, callbackQueryId: 'query-1' };

    await service.submitTarget({ ...input, targetIndex: 2 });

    expect(upsertMafiaDraft).toHaveBeenCalledWith({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actorPlayerId: mafiaOne.id,
      targetPlayerId: civilian.id,
    });
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      receiverUserId: mafiaOne.userId,
      text: expect.stringContaining('Мафия 2 → Мирный ⏳'),
      replyMarkup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: expect.stringContaining(':mafia-confirm') })]),
        ]),
      }),
    }));

    await service.openNightPanel({
      ...input,
      userId: mafiaTwo.userId,
      callbackQueryId: 'query-2',
    });

    await service.submitTarget({ ...input, ephemeralMessageId: 42, targetIndex: 2 });

    expect(editText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: game.chatId,
      receiverUserId: mafiaOne.userId,
      ephemeralMessageId: 42,
      text: expect.stringContaining('Совет мафии'),
      replyMarkup: expect.any(Object),
    }));
    expect(sendText).toHaveBeenCalledTimes(2);

    await service.confirmMafiaTarget({ ...input, ephemeralMessageId: 42 });

    expect(confirmMafiaDraft).toHaveBeenCalledWith({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actorPlayerId: mafiaOne.id,
    });
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(deleteEphemeralMessage).toHaveBeenCalledTimes(2);
    expect(deleteEphemeralMessage).toHaveBeenCalledWith({
      chatId: game.chatId,
      receiverUserId: mafiaOne.userId,
      ephemeralMessageId: 42,
    });
    expect(deleteEphemeralMessage).toHaveBeenCalledWith({
      chatId: game.chatId,
      receiverUserId: mafiaTwo.userId,
      ephemeralMessageId: 43,
    });
  });
});
