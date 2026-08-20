import type { Game, PhaseJob } from '@prisma/client';

import type { AppConfig } from '../config/env.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { AppliedNightResolution, NightResolutionService } from './NightResolutionService.js';
import type { AppliedVoteResolution, VotingService } from './VotingService.js';
import type { FinalizedGame, GameFinalizationService } from './GameFinalizationService.js';

export type PhaseDeadlineResult = Readonly<{
  game: Game;
  kind: 'ROLE_CONFIRMATION_EXPIRED' | 'UNHANDLED_PHASE';
}> | Readonly<{
  game: Game;
  kind: 'NIGHT_RESOLVED';
  resolution: AppliedNightResolution;
}> | Readonly<{
  game: Game;
  kind: 'DAY_VOTE_STARTED';
}> | Readonly<{
  game: Game;
  kind: 'DAY_VOTE_RESOLVED';
  resolution: AppliedVoteResolution;
}> | Readonly<{
  game: Game;
  kind: 'GAME_FINISHED';
  finalization: FinalizedGame;
  voteResolution?: AppliedVoteResolution;
  nightResolution?: AppliedNightResolution;
}>;

export class PhaseService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly nightResolutionService: NightResolutionService,
    private readonly votingService: VotingService,
    private readonly gameFinalizationService: GameFinalizationService,
    private readonly config: Pick<AppConfig, 'roleConfirmationDurationSeconds' | 'nightDurationSeconds' | 'dayDurationSeconds' | 'voteDurationSeconds'>,
    private readonly logger: AppLogger,
  ) {}

  public async startNight(game: Game): Promise<Game | null> {
    const deadline = new Date(Date.now() + this.config.nightDurationSeconds * 1000);
    this.logger.debug({ gameId: game.id, stateVersion: game.stateVersion, deadline }, '[PhaseService.startNight] Starting night after role confirmations');
    return this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'ROLE_CONFIRMATION',
      currentVersion: game.stateVersion,
      nextPhase: 'NIGHT',
      nextStatus: 'RUNNING',
      deadline,
    });
  }

  public async extendRoleConfirmation(game: Game): Promise<Game | null> {
    if (game.phase !== 'ROLE_CONFIRMATION') {
      return null;
    }

    const deadline = new Date(Date.now() + this.config.roleConfirmationDurationSeconds * 1000);
    return this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'ROLE_CONFIRMATION',
      currentVersion: game.stateVersion,
      nextPhase: 'ROLE_CONFIRMATION',
      nextStatus: 'RUNNING',
      deadline,
    });
  }

  public async recordControlMessage(gameId: string, messageId: number): Promise<void> {
    await this.gameRepository.setControlMessageId(gameId, messageId);
  }

  public async getCurrentGame(gameId: string): Promise<Game | null> {
    return this.gameRepository.findById(gameId);
  }

  public async completeNightIfAllActionsCompleted(gameId: string, phaseVersion: number): Promise<Extract<PhaseDeadlineResult, { kind: 'NIGHT_RESOLVED' | 'GAME_FINISHED' }> | null> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'NIGHT' || game.stateVersion !== phaseVersion) {
      this.logger.debug({ gameId, phaseVersion }, '[FIX:early-night-completion] Ignored stale night completion check');
      return null;
    }

    const progress = await this.nightResolutionService.getActionProgress(game.id, game.stateVersion);
    if (!progress.allActionsCompleted) {
      this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, ...progress }, '[FIX:early-night-completion] Waiting for remaining night actions');
      return null;
    }

    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, ...progress }, '[FIX:early-night-completion] All night actions completed');
    return this.resolveNightAndStartDay(game, 'all-actions-completed');
  }

  public async processExpiredJob(job: PhaseJob): Promise<PhaseDeadlineResult | null> {
    this.logger.debug({ jobId: job.id, gameId: job.gameId, phaseVersion: job.phaseVersion }, '[PhaseService.processExpiredJob] Processing due phase job');
    const game = await this.gameRepository.findById(job.gameId);
    if (game === null || game.stateVersion !== job.phaseVersion || game.phaseDeadline === null) {
      this.logger.warn({ jobId: job.id, gameId: job.gameId }, '[PhaseService.processExpiredJob] Ignored stale phase job');
      return null;
    }

    if (game.phase === 'ROLE_CONFIRMATION') {
      this.logger.warn({ gameId: game.id, phase: game.phase }, '[PhaseService.processExpiredJob] Role confirmation deadline elapsed');
      return { game, kind: 'ROLE_CONFIRMATION_EXPIRED' };
    }

    if (game.phase === 'NIGHT') {
      return this.resolveNightAndStartDay(game, 'deadline');
    }

    if (game.phase === 'DAY_DISCUSSION') {
      const nextGame = await this.gameRepository.transitionPhase({
        gameId: game.id,
        currentPhase: 'DAY_DISCUSSION',
        currentVersion: game.stateVersion,
        nextPhase: 'DAY_VOTE',
        nextStatus: 'RUNNING',
        deadline: new Date(Date.now() + this.config.voteDurationSeconds * 1000),
      });
      return nextGame === null ? null : { game: nextGame, kind: 'DAY_VOTE_STARTED' };
    }

    if (game.phase === 'DAY_VOTE') {
      return this.closeDayVote(game);
    }

    this.logger.warn({ gameId: game.id, phase: game.phase }, '[PhaseService.processExpiredJob] No deadline handler for phase yet');
    return { game, kind: 'UNHANDLED_PHASE' };
  }

  public async closeDayVote(game: Game): Promise<Extract<PhaseDeadlineResult, { kind: 'DAY_VOTE_RESOLVED' | 'GAME_FINISHED' }> | null> {
    if (game.phase !== 'DAY_VOTE') {
      return null;
    }

    const resolution = await this.votingService.resolveVote(game.id, game.stateVersion);
    const finalization = await this.gameFinalizationService.finalizeIfWinner(game);
    if (finalization !== null) {
      return { game: finalization.game, kind: 'GAME_FINISHED', finalization, voteResolution: resolution };
    }
    const nextGame = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'DAY_VOTE',
      currentVersion: game.stateVersion,
      nextPhase: 'NIGHT',
      nextStatus: 'RUNNING',
      deadline: new Date(Date.now() + this.config.nightDurationSeconds * 1000),
    });
    if (nextGame === null) {
      return null;
    }

    this.logger.info({ gameId: nextGame.id, outcome: resolution.resolution.outcome }, '[PhaseService.closeDayVote] Day vote transitioned to night');
    return { game: nextGame, kind: 'DAY_VOTE_RESOLVED', resolution };
  }

  private async resolveNightAndStartDay(game: Game, trigger: 'deadline' | 'all-actions-completed'): Promise<Extract<PhaseDeadlineResult, { kind: 'NIGHT_RESOLVED' | 'GAME_FINISHED' }> | null> {
    const resolution = await this.nightResolutionService.resolve(game.id, game.stateVersion);
    const finalization = await this.gameFinalizationService.finalizeIfWinner(game);
    if (finalization !== null) {
      return { game: finalization.game, kind: 'GAME_FINISHED', finalization, nightResolution: resolution };
    }
    const nextGame = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'NIGHT',
      currentVersion: game.stateVersion,
      nextPhase: 'DAY_DISCUSSION',
      nextStatus: 'RUNNING',
      deadline: new Date(Date.now() + this.config.dayDurationSeconds * 1000),
    });
    if (nextGame === null) {
      return null;
    }

    this.logger.info(
      { gameId: nextGame.id, phase: nextGame.phase, trigger, wasEliminationApplied: resolution.eliminatedPlayer !== null },
      '[FIX:early-night-completion] Night transitioned to day discussion',
    );
    return { game: nextGame, kind: 'NIGHT_RESOLVED', resolution };
  }
}
