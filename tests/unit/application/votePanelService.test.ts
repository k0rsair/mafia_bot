import type { Game, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { VotePanelService } from '../../../src/application/VotePanelService.js';
import type { VotingService } from '../../../src/application/VotingService.js';
import type { TelegramEphemeralAdapter } from '../../../src/bot/telegram/ephemeral.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('VotePanelService', () => {
  const game = { id: 'game-1', chatId: '-1001', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
  const alice = { id: 'alice', userId: '101', displayName: 'Алиса', status: 'ALIVE' } as Player;
  const virtualPlayer = { id: 'virtual', userId: 'test-player:1', displayName: '🤖 Игрок', status: 'ALIVE' } as Player;

  it('sends a personal panel with an empty initial choice', async () => {
    const sendText = vi.fn().mockResolvedValue({ ephemeral_message_id: 41 });
    const service = new VotePanelService(
      {
        getVotePanelState: vi.fn().mockResolvedValue({
          game,
          kind: 'PRIMARY',
          candidates: [{ displayName: 'Борис', targetIndex: 0 }],
          selectedChoice: null,
          confirmed: false,
        }),
      } as unknown as VotingService,
      {} as PlayerRepository,
      { sendText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await service.openPanel({ gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: alice.userId, callbackQueryId: 'query-1' });

    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: game.chatId,
      receiverUserId: alice.userId,
      callbackQueryId: 'query-1',
      text: expect.stringContaining('Ваш выбор: —'),
    }));
    expect(JSON.stringify(sendText.mock.calls[0]?.[0].replyMarkup)).not.toContain(':confirm');
  });

  it('edits the personal panel into a confirmed state without buttons', async () => {
    const editText = vi.fn().mockResolvedValue(undefined);
    const service = new VotePanelService(
      {
        getVotePanelState: vi.fn().mockResolvedValue({
          game,
          kind: 'PRIMARY',
          candidates: [{ displayName: 'Борис', targetIndex: 0 }],
          selectedChoice: 'Борис',
          confirmed: true,
        }),
      } as unknown as VotingService,
      {} as PlayerRepository,
      { editText } as unknown as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );

    await service.refreshPanel({ gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: alice.userId, ephemeralMessageId: 41 });

    expect(editText).toHaveBeenCalledWith(expect.objectContaining({
      ephemeralMessageId: 41,
      text: expect.stringContaining('Ваш выбор: Борис ✅'),
      replyMarkup: { inline_keyboard: [] },
    }));
  });

  it('automatically delivers panels only to real living players', async () => {
    const openPanel = vi.fn().mockResolvedValue(undefined);
    const service = new VotePanelService(
      {} as VotingService,
      { listAlivePlayers: vi.fn().mockResolvedValue([alice, virtualPlayer]) } as unknown as PlayerRepository,
      {} as TelegramEphemeralAdapter,
      createLogger({ logLevel: 'silent' }),
    );
    vi.spyOn(service, 'openPanel').mockImplementation(openPanel);

    await service.deliverVotePanels(game);

    expect(openPanel).toHaveBeenCalledTimes(1);
    expect(openPanel).toHaveBeenCalledWith({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      chatId: game.chatId,
      userId: alice.userId,
    });
  });
});
