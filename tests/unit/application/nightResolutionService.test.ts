import type { NightAction, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { NightResolutionService } from '../../../src/application/NightResolutionService.js';
import type { NightActionRepository } from '../../../src/infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('NightResolutionService', () => {
  it('uses only confirmed mafia choices when resolving the night', async () => {
    const confirmedTarget = { id: 'confirmed-target', status: 'ALIVE' } as Player;
    const eliminatePlayer = vi.fn().mockResolvedValue(confirmedTarget);
    const service = new NightResolutionService(
      {
        listAlivePlayers: vi.fn().mockResolvedValue([confirmedTarget]),
        eliminatePlayer,
      } as unknown as PlayerRepository,
      {
        listActions: vi.fn().mockResolvedValue([
          { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia-1', targetPlayerId: 'draft-target', confirmedAt: null } as NightAction,
          { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia-2', targetPlayerId: confirmedTarget.id, confirmedAt: new Date() } as NightAction,
        ]),
      } as unknown as NightActionRepository,
      createLogger({ logLevel: 'silent' }),
    );

    const result = await service.resolve('game-1', 7);

    expect(result.resolution).toEqual({
      attackedPlayerId: confirmedTarget.id,
      savedPlayerId: null,
      eliminatedPlayerId: confirmedTarget.id,
    });
    expect(eliminatePlayer).toHaveBeenCalledWith('game-1', confirmedTarget.id);
  });
});
