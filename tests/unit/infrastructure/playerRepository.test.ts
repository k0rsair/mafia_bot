import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('PlayerRepository role confirmation queries', () => {
  it('selects only the public identity of alive players without a role confirmation', async () => {
    const findMany = vi.fn().mockResolvedValue([{ userId: 'player-1', displayName: 'Игрок 1' }]);
    const repository = new PlayerRepository(
      { player: { findMany } } as unknown as PrismaClient,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(repository.listUnconfirmedRolePlayers('game-1')).resolves.toEqual([{ userId: 'player-1', displayName: 'Игрок 1' }]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { gameId: 'game-1', status: 'ALIVE', roleConfirmedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, displayName: true },
    }));
  });

  it('returns an empty result when every alive player has confirmed', async () => {
    const repository = new PlayerRepository(
      { player: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(repository.listUnconfirmedRolePlayers('game-1')).resolves.toEqual([]);
  });
});
