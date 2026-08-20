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

  it('requires a completed action from every alive night role', async () => {
    const mafia = { id: 'mafia-1', role: 'MAFIA', status: 'ALIVE' } as Player;
    const doctor = { id: 'doctor-1', role: 'DOCTOR', status: 'ALIVE' } as Player;
    const commissioner = { id: 'commissioner-1', role: 'COMMISSIONER', status: 'ALIVE' } as Player;
    const civilian = { id: 'civilian-1', role: 'CIVILIAN', status: 'ALIVE' } as Player;
    const listActions = vi.fn()
      .mockResolvedValueOnce([
        { actionType: 'MAFIA_KILL', actorPlayerId: mafia.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
        { actionType: 'DOCTOR_SAVE', actorPlayerId: doctor.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
        { actionType: 'COMMISSIONER_CHECK', actorPlayerId: commissioner.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
      ])
      .mockResolvedValueOnce([
        { actionType: 'MAFIA_KILL', actorPlayerId: mafia.id, targetPlayerId: civilian.id, confirmedAt: new Date() } as NightAction,
        { actionType: 'DOCTOR_SAVE', actorPlayerId: doctor.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
        { actionType: 'COMMISSIONER_CHECK', actorPlayerId: commissioner.id, targetPlayerId: civilian.id, confirmedAt: null } as NightAction,
      ]);
    const service = new NightResolutionService(
      { listAlivePlayers: vi.fn().mockResolvedValue([mafia, doctor, commissioner, civilian]) } as unknown as PlayerRepository,
      { listActions } as unknown as NightActionRepository,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.getActionProgress('game-1', 7)).resolves.toEqual({
      actionPlayersTotal: 3,
      actionPlayersCompleted: 2,
      allActionsCompleted: false,
    });
    await expect(service.getActionProgress('game-1', 7)).resolves.toEqual({
      actionPlayersTotal: 3,
      actionPlayersCompleted: 3,
      allActionsCompleted: true,
    });
  });
});
