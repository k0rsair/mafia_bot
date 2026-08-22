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
      eliminatedPlayers: [],
      savedPlayers: [],
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
      { finalizeIfWinner: vi.fn().mockResolvedValue(null) } as unknown as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.completeNightIfAllActionsCompleted(game.id, game.stateVersion)).resolves.toBeNull();

    expect(resolve).not.toHaveBeenCalled();
    expect(transitionPhase).not.toHaveBeenCalled();
  });

  it('finishes a terminal night before waiting for an action with no eligible target', async () => {
    const game = { id: 'game-1', phase: 'NIGHT', stateVersion: 7, status: 'RUNNING' } as Game;
    const finishedGame = { ...game, phase: 'FINISHED', status: 'FINISHED', stateVersion: 8 } as Game;
    const finalizeIfWinner = vi.fn().mockResolvedValue({ game: finishedGame, winningFaction: 'MANIAC', players: [] });
    const getActionProgress = vi.fn();
    const service = new PhaseService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      { getActionProgress } as unknown as NightResolutionService,
      {} as VotingService,
      { finalizeIfWinner } as unknown as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.completeNightIfAllActionsCompleted(game.id, game.stateVersion)).resolves.toMatchObject({
      kind: 'GAME_FINISHED',
      game: finishedGame,
    });

    expect(finalizeIfWinner).toHaveBeenCalledWith(game);
    expect(getActionProgress).not.toHaveBeenCalled();
  });
});

describe('PhaseService manual city nomination start', () => {
  const config = {
    roleConfirmationDurationSeconds: 300,
    nightDurationSeconds: 120,
    dayDurationSeconds: 180,
    voteDurationSeconds: 90,
  };

  it('transitions from discussion to nominations with a fresh vote deadline', async () => {
    const game = { id: 'game-1', phase: 'DAY_DISCUSSION', stateVersion: 7, status: 'RUNNING' } as Game;
    const voteGame = { ...game, phase: 'DAY_NOMINATION', stateVersion: 8 } as Game;
    const transitionPhase = vi.fn().mockResolvedValue(voteGame);
    const service = new PhaseService(
      { transitionPhase } as unknown as GameRepository,
      {} as NightResolutionService,
      {} as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.startDayVote(game)).resolves.toEqual(voteGame);

    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({
      gameId: game.id,
      currentPhase: 'DAY_DISCUSSION',
      currentVersion: game.stateVersion,
      nextPhase: 'DAY_NOMINATION',
      deadline: expect.any(Date),
    }));
  });

  it('does not start voting outside the discussion phase', async () => {
    const transitionPhase = vi.fn();
    const service = new PhaseService(
      { transitionPhase } as unknown as GameRepository,
      {} as NightResolutionService,
      {} as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.startDayVote({ phase: 'NIGHT' } as Game)).resolves.toBeNull();

    expect(transitionPhase).not.toHaveBeenCalled();
  });
});

describe('PhaseService city vote closure', () => {
  const config = {
    roleConfirmationDurationSeconds: 300,
    nightDurationSeconds: 120,
    dayDurationSeconds: 180,
    voteDurationSeconds: 90,
    tieDiscussionDurationSeconds: 30,
  };

  it('converts two or more persisted nominations into the primary city vote', async () => {
    const nominationGame = { id: 'game-1', phase: 'DAY_NOMINATION', stateVersion: 7 } as Game;
    const primaryGame = { ...nominationGame, phase: 'DAY_VOTE', stateVersion: 8 } as Game;
    const startPrimaryVote = vi.fn().mockResolvedValue(primaryGame);
    const round = { id: 'round-1', kind: 'NOMINATION', sequence: 1 } as never;
    const votingService = {
      getActiveVoteRound: vi.fn().mockResolvedValue(round),
      getNominatedCandidateIds: vi.fn().mockResolvedValue(['player-3', 'player-2']),
      closeCurrentRound: vi.fn().mockResolvedValue(true),
    } as unknown as VotingService;
    const service = new PhaseService(
      {} as GameRepository,
      {} as NightResolutionService,
      votingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
      undefined,
      { getActiveRound: vi.fn().mockResolvedValue({ round, voteDetails: [] }), startPrimaryVote } as never,
    );

    await expect(service.closeDayVote(nominationGame)).resolves.toEqual({ game: primaryGame, kind: 'DAY_VOTE_STARTED' });

    expect(startPrimaryVote).toHaveBeenCalledWith(nominationGame, ['player-3', 'player-2'], config.voteDurationSeconds);
  });

  it('starts a constrained tie discussion after a tied primary vote', async () => {
    const voteGame = { id: 'game-1', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
    const tieGame = { ...voteGame, phase: 'DAY_TIE_DISCUSSION', stateVersion: 8 } as Game;
    const resolution = {
      round: { id: 'round-1', kind: 'PRIMARY' },
      resolution: { outcome: 'TIE', eliminatedPlayerId: null, eliminatedPlayerIds: [], tiedPlayerIds: ['player-2', 'player-3'] },
      voteDetails: [],
    };
    const transitionPhase = vi.fn().mockResolvedValue(tieGame);
    const service = new PhaseService(
      { transitionPhase } as unknown as GameRepository,
      {} as NightResolutionService,
      { getActiveVoteRound: vi.fn().mockResolvedValue(resolution.round), resolveVote: vi.fn().mockResolvedValue(resolution), closeCurrentRound: vi.fn().mockResolvedValue(true) } as unknown as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.closeDayVote(voteGame)).resolves.toEqual({ game: tieGame, kind: 'DAY_TIE_DISCUSSION_STARTED', resolution });

    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({ nextPhase: 'DAY_TIE_DISCUSSION' }));
  });

  it('opens the final all-leave/all-stay decision after a tied revote', async () => {
    const revoteGame = { id: 'game-1', phase: 'DAY_REVOTE', stateVersion: 9 } as Game;
    const finalGame = { ...revoteGame, phase: 'DAY_FINAL_DECISION', stateVersion: 10 } as Game;
    const resolution = {
      round: { id: 'round-2', kind: 'REVOTE' },
      resolution: { outcome: 'TIE', eliminatedPlayerId: null, eliminatedPlayerIds: [], tiedPlayerIds: ['player-2', 'player-3'] },
      voteDetails: [],
    };
    const startFinalDecision = vi.fn().mockResolvedValue(finalGame);
    const service = new PhaseService(
      {} as GameRepository,
      {} as NightResolutionService,
      { getActiveVoteRound: vi.fn().mockResolvedValue(resolution.round), resolveVote: vi.fn().mockResolvedValue(resolution), closeCurrentRound: vi.fn().mockResolvedValue(true) } as unknown as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
      undefined,
      { startFinalDecision } as never,
    );

    await expect(service.closeDayVote(revoteGame)).resolves.toEqual({ game: finalGame, kind: 'DAY_FINAL_DECISION_STARTED', resolution });

    expect(startFinalDecision).toHaveBeenCalledWith(revoteGame, ['player-2', 'player-3'], config.voteDurationSeconds);
  });

  it('does not apply a vote outcome when another callback already claimed the round', async () => {
    const voteGame = { id: 'game-1', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
    const resolveVote = vi.fn();
    const service = new PhaseService(
      {} as GameRepository,
      {} as NightResolutionService,
      {
        getActiveVoteRound: vi.fn().mockResolvedValue({ id: 'round-1', kind: 'PRIMARY', sequence: 2 }),
        closeCurrentRound: vi.fn().mockResolvedValue(false),
        resolveVote,
      } as unknown as VotingService,
      {} as GameFinalizationService,
      config,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.closeDayVote(voteGame)).resolves.toBeNull();

    expect(resolveVote).not.toHaveBeenCalled();
  });
});
