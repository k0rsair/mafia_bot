import type { Game } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { LobbyError, LobbyService } from '../../../src/application/LobbyService.js';
import type { GameRepository } from '../../../src/infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('LobbyService role confirmation status', () => {
  it('returns only unconfirmed players during role confirmation', async () => {
    const players = [{ userId: 'player-1', displayName: 'Игрок 1' }];
    const listUnconfirmedRolePlayers = vi.fn().mockResolvedValue(players);
    const service = new LobbyService(
      { findById: vi.fn().mockResolvedValue({ id: 'game-1', phase: 'ROLE_CONFIRMATION' } as Game) } as unknown as GameRepository,
      { listUnconfirmedRolePlayers } as unknown as PlayerRepository,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.listUnconfirmedRolePlayers('game-1')).resolves.toEqual(players);

    expect(listUnconfirmedRolePlayers).toHaveBeenCalledWith('game-1');
  });

  it('rejects a pending-role request outside role confirmation', async () => {
    const listUnconfirmedRolePlayers = vi.fn();
    const service = new LobbyService(
      { findById: vi.fn().mockResolvedValue({ id: 'game-1', phase: 'NIGHT' } as Game) } as unknown as GameRepository,
      { listUnconfirmedRolePlayers } as unknown as PlayerRepository,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.listUnconfirmedRolePlayers('game-1')).rejects.toBeInstanceOf(LobbyError);

    expect(listUnconfirmedRolePlayers).not.toHaveBeenCalled();
  });
});
