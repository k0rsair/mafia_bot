import type { Game } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { PhaseService } from '../../../src/application/PhaseService.js';
import type { GameFinalizationService } from '../../../src/application/GameFinalizationService.js';
import type { NightResolutionService } from '../../../src/application/NightResolutionService.js';
import type { VotingService } from '../../../src/application/VotingService.js';
import type { GameRepository } from '../../../src/infrastructure/repositories/GameRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('PhaseService early night completion', () => {
  const config = {
    roleConfirmationDurationSeconds: 300,
    nightDurationSeconds: 120,
    dayDurationSeconds: 180,
    voteDurationSeconds: 90,
  };

  it('starts day immediately after every required night action is complete', async () => {
    const game = { id: 'game-1', phase: 'NIGHT', stateVersion: 7, status: 'RUNNING' } as Game;
    const dayGame = { ...game, phase: 'DAY_DISCUSSION', stateVersion: 8 } as Game;
    const transitionPhase = vi.fn().mockResolvedValue(dayGame);
    const resolve = vi.fn().mockResolvedValue({
      resolution: { attackedPlayerId: null, savedPlayerId: null, eliminatedPlayerId: null },
      eliminatedPlayer: null,
    });
    const service = new PhaseService(
      { findById: vi.fn().mockResolvedValue(game), transitionPhase } as unknown as GameRepository,
      {
        getActionProgress: vi.fn().mockResolvedValue({ actionPlayersTotal: 3, actionPlayersCompleted: 3, allActionsCompleted: true }),
        resolve,
      } as unknown as NightResolutionService,
      {} as VotingService,
      { finalizeIfWinner: vi.fn().mockResolvedValue(null) } as unknown as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    const result = await service.completeNightIfAllActionsCompleted(game.id, game.stateVersion);

    expect(result).toMatchObject({ kind: 'NIGHT_RESOLVED', game: dayGame });
    expect(resolve).toHaveBeenCalledWith(game.id, game.stateVersion);
    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({
      gameId: game.id,
      currentPhase: 'NIGHT',
      currentVersion: game.stateVersion,
      nextPhase: 'DAY_DISCUSSION',
      deadline: expect.any(Date),
    }));
  });

  it('keeps night open while at least one required action is missing', async () => {
    const game = { id: 'game-1', phase: 'NIGHT', stateVersion: 7 } as Game;
    const resolve = vi.fn();
    const transitionPhase = vi.fn();
    const service = new PhaseService(
      { findById: vi.fn().mockResolvedValue(game), transitionPhase } as unknown as GameRepository,
      {
        getActionProgress: vi.fn().mockResolvedValue({ actionPlayersTotal: 3, actionPlayersCompleted: 2, allActionsCompleted: false }),
        resolve,
      } as unknown as NightResolutionService,
      {} as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.completeNightIfAllActionsCompleted(game.id, game.stateVersion)).resolves.toBeNull();

    expect(resolve).not.toHaveBeenCalled();
    expect(transitionPhase).not.toHaveBeenCalled();
  });
});
