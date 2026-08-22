import type { NightAction, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { NightResolutionService } from '../../../src/application/NightResolutionService.js';
import type { NightActionRepository } from '../../../src/infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('NightResolutionService', () => {
  it('uses confirmed mafia choices, applies every resolved elimination, and creates an alibi for a surviving client', async () => {
    const target = { id: 'target', displayName: 'Житель', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const prostitute = { id: 'prostitute', displayName: 'Шлюха', role: 'PROSTITUTE', status: 'ALIVE' } as Player;
    const eliminatePlayers = vi.fn().mockResolvedValue(1);
    const createProstituteAlibi = vi.fn().mockResolvedValue(true);
    const listActions = vi.fn()
      .mockResolvedValueOnce([{ actionType: 'MAFIA_KILL', actorPlayerId: 'mafia', targetPlayerId: target.id, confirmedAt: new Date() } as NightAction])
      .mockResolvedValueOnce([{ actionType: 'PROSTITUTE_VISIT', actorPlayerId: prostitute.id, targetPlayerId: prostitute.id, confirmedAt: null } as NightAction]);
    const service = new NightResolutionService(
      { listAlivePlayers: vi.fn().mockResolvedValue([target, prostitute]), eliminatePlayers } as unknown as PlayerRepository,
      { listActions } as unknown as NightActionRepository,
      createLogger({ logLevel: 'silent' }),
      { createProstituteAlibi } as never,
    );

    const result = await service.resolve('game-1', 7);

    expect(result.eliminatedPlayers).toEqual([target]);
    expect(eliminatePlayers).toHaveBeenCalledWith('game-1', [target.id]);
    expect(createProstituteAlibi).toHaveBeenCalledWith({ gameId: 'game-1', playerId: prostitute.id, phaseVersion: 7 });
  });

  it('counts Don council/check and blocked personal actions as complete', async () => {
    const don = { id: 'don', role: 'DON', status: 'ALIVE' } as Player;
    const sheriff = { id: 'sheriff', role: 'COMMISSIONER', status: 'ALIVE' } as Player;
    const prostitute = { id: 'prostitute', role: 'PROSTITUTE', status: 'ALIVE' } as Player;
    const civilian = { id: 'civilian', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const service = new NightResolutionService(
      { listAlivePlayers: vi.fn().mockResolvedValue([don, sheriff, prostitute, civilian]) } as unknown as PlayerRepository,
      {
        listActions: vi.fn()
          .mockResolvedValueOnce([
            { actionType: 'MAFIA_KILL', actorPlayerId: don.id, targetPlayerId: civilian.id, confirmedAt: new Date() } as NightAction,
            { actionType: 'DON_CHECK', actorPlayerId: don.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
          ])
          .mockResolvedValueOnce([
            { actionType: 'PROSTITUTE_VISIT', actorPlayerId: prostitute.id, targetPlayerId: sheriff.id, confirmedAt: null } as NightAction,
          ]),
      } as unknown as NightActionRepository,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.getActionProgress('game-1', 7)).resolves.toEqual({
      actionPlayersTotal: 2,
      actionPlayersCompleted: 2,
      allActionsCompleted: true,
    });
  });
});
