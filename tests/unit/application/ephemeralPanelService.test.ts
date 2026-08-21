import type { Game, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { EphemeralPanelError, EphemeralPanelService } from '../../../src/application/EphemeralPanelService.js';
import type { NightActionService } from '../../../src/application/NightActionService.js';
import type { PhaseService } from '../../../src/application/PhaseService.js';
import type { TelegramEphemeralAdapter } from '../../../src/bot/telegram/ephemeral.js';
import type { GameRepository } from '../../../src/infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('EphemeralPanelService panel restoration', () => {
  it('recreates the current role panel without a callback query ID', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'ROLE_CONFIRMATION', stateVersion: 7, phaseDeadline: new Date(Date.now() + 60_000) } as Game;
    const player = { id: 'player-1', userId: 'user-1', role: 'COMMISSIONER', status: 'ALIVE' } as Player;
    const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 42 });
    const service = new EphemeralPanelService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      { findByGameAndUserId: vi.fn().mockResolvedValue(player) } as unknown as PlayerRepository,
      {} as PhaseService,
      {} as NightActionService,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await service.restorePanel({ gameId: game.id, chatId: game.chatId, userId: player.userId });

    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: game.chatId,
      receiverUserId: player.userId,
      text: expect.stringContaining('КОМИССАР'),
      replyMarkup: expect.any(Object),
    }));
    expect(sendText.mock.calls[0]?.[0]).not.toHaveProperty('callbackQueryId');
  });

  it('delegates a night restoration with the current phase version and no callback query ID', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'NIGHT', stateVersion: 7 } as Game;
    const openNightPanel = vi.fn().mockResolvedValue(undefined);
    const service = new EphemeralPanelService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {} as PlayerRepository,
      {} as PhaseService,
      { openNightPanel } as unknown as NightActionService,
      {} as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await service.restorePanel({ gameId: game.id, chatId: game.chatId, userId: 'user-1' });

    expect(openNightPanel).toHaveBeenCalledWith({
      gameId: game.id,
      chatId: game.chatId,
      userId: 'user-1',
      phaseVersion: game.stateVersion,
    });
  });

  it('rejects restoration from another chat before sending a panel', async () => {
    const game = { id: 'game-1', chatId: '-1001', phase: 'ROLE_CONFIRMATION', stateVersion: 7, phaseDeadline: new Date(Date.now() + 60_000) } as Game;
    const sendText = vi.fn();
    const service = new EphemeralPanelService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {} as PlayerRepository,
      {} as PhaseService,
      {} as NightActionService,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.restorePanel({ gameId: game.id, chatId: '-1002', userId: 'user-1' })).rejects.toBeInstanceOf(EphemeralPanelError);

    expect(sendText).not.toHaveBeenCalled();
  });
});
