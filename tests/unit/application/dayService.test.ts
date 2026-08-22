import type { Game, Player } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DayService } from '../../../src/application/DayService.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../../../src/infrastructure/repositories/VoteRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('DayService', () => {
  it('renders every public voter choice from the persisted day vote', async () => {
    const game = { id: 'game-1', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
    const alice = { id: 'player-1', displayName: 'Алиса' } as Player;
    const boris = { id: 'player-2', displayName: 'Борис' } as Player;
    const vera = { id: 'player-3', displayName: 'Вера' } as Player;
    const service = new DayService(
      { listAlivePlayers: async () => [alice, boris, vera] } as unknown as PlayerRepository,
      {
        listVotes: async () => [
          { voterPlayerId: alice.id, targetPlayerId: boris.id, confirmedAt: new Date() },
          { voterPlayerId: vera.id, targetPlayerId: null, confirmedAt: new Date() },
        ],
      } as unknown as VoteRepository,
      createLogger({ logLevel: 'silent' }),
    );

    const view = await service.renderVote(game);

    expect(view.text).toContain('Подтверждено: 2/3');
    expect(view.text).toContain('Кто за кого:');
    expect(view.text).toContain('Алиса → Борис');
    expect(view.text).toContain('Вера → пропуск');
  });
});
