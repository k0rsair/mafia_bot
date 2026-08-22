import type { Game, PhaseJob } from '@prisma/client';

import type { AppConfig } from '../config/env.js';
import { resolveVote } from '../domain/game/voteResolution.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { AppliedNightResolution, NightResolutionService } from './NightResolutionService.js';
import type { AppliedVoteResolution, ResolvedVoteRound, VotingService } from './VotingService.js';
import type { FinalizedGame, GameFinalizationService } from './GameFinalizationService.js';
import type { DayService } from './DayService.js';

type PhaseDurations = Pick<AppConfig, 'roleConfirmationDurationSeconds' | 'nightDurationSeconds' | 'dayDurationSeconds' | 'voteDurationSeconds'>
  & Readonly<Partial<Pick<AppConfig, 'tieDiscussionDurationSeconds'>>>;

export type PhaseDeadlineResult = Readonly<{
  game: Game;
  kind: 'ROLE_CONFIRMATION_EXPIRED' | 'DAY_NOMINATION_EXPIRED' | 'DAY_REVOTE_EXPIRED' | 'DAY_FINAL_DECISION_EXPIRED' | 'UNHANDLED_PHASE';
}> | Readonly<{
  game: Game;
  kind: 'NIGHT_RESOLVED';
  resolution: AppliedNightResolution;
}> | Readonly<{
  game: Game;
  kind: 'NIGHT_STARTED' | 'DAY_NOMINATION_STARTED' | 'DAY_REVOTE_STARTED' | 'DAY_TIE_DISCUSSION_STARTED' | 'DAY_FINAL_DECISION_STARTED';
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

export type CityVoteClosure = Readonly<{
  game: Game;
  kind: 'DAY_VOTE_STARTED';
}> | Readonly<{
  game: Game;
  kind: 'DAY_TIE_DISCUSSION_STARTED';
  resolution: ResolvedVoteRound;
}> | Readonly<{
  game: Game;
  kind: 'DAY_FINAL_DECISION_STARTED';
  resolution: ResolvedVoteRound;
}> | Readonly<{
  game: Game;
  kind: 'DAY_VOTE_RESOLVED';
  resolution: AppliedVoteResolution;
}> | Readonly<{
  game: Game;
  kind: 'GAME_FINISHED';
  finalization: FinalizedGame;
  voteResolution: AppliedVoteResolution;
}>;

export class PhaseService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly nightResolutionService: NightResolutionService,
    private readonly votingService: VotingService,
    private readonly gameFinalizationService: GameFinalizationService,
    private readonly config: PhaseDurations,
    private readonly logger: AppLogger,
    private readonly playerRepository?: PlayerRepository,
    private readonly dayService?: DayService,
  ) {}

  public async startNight(game: Game): Promise<Game | null> {
    return this.startCityNight(game, 'ROLE_CONFIRMATION');
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

  public async startDayVote(game: Game): Promise<Game | null> {
    if (this.dayService !== undefined) {
      return this.dayService.startNominationRound(game, this.config.voteDurationSeconds);
    }
    return this.startDayNomination(game, 'manual');
  }

  public async startPrimaryVote(game: Game, candidatePlayerIds: readonly string[] = []): Promise<Game | null> {
    if (this.dayService !== undefined) {
      return this.dayService.startPrimaryVote(game, candidatePlayerIds, this.config.voteDurationSeconds);
    }
    return this.transitionDayPhase(game, 'DAY_NOMINATION', 'DAY_VOTE', this.config.voteDurationSeconds, 'primary vote');
  }

  public async startTieDiscussion(game: Game): Promise<Game | null> {
    return this.transitionDayPhase(game, 'DAY_VOTE', 'DAY_TIE_DISCUSSION', this.config.tieDiscussionDurationSeconds ?? 30, 'tie discussion');
  }

  public async startDayRevote(game: Game): Promise<Game | null> {
    if (this.dayService !== undefined) {
      const candidatePlayerIds = await this.votingService.getTiedCandidateIds(game.id, 'PRIMARY');
      return this.dayService.startRevote(game, candidatePlayerIds, this.config.voteDurationSeconds);
    }
    return this.transitionDayPhase(game, 'DAY_TIE_DISCUSSION', 'DAY_REVOTE', this.config.voteDurationSeconds, 'revote');
  }

  public async startFinalDecision(game: Game, candidatePlayerIds: readonly string[] = []): Promise<Game | null> {
    if (this.dayService !== undefined) {
      return this.dayService.startFinalDecision(game, candidatePlayerIds, this.config.voteDurationSeconds);
    }
    return this.transitionDayPhase(game, 'DAY_REVOTE', 'DAY_FINAL_DECISION', this.config.voteDurationSeconds, 'final decision');
  }

  public async completeProstituteNight(gameId: string, phaseVersion: number): Promise<Game | null> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'NIGHT_PROSTITUTE' || game.stateVersion !== phaseVersion) {
      this.logger.warn({ gameId, phaseVersion }, '[PhaseService.completeProstituteNight] Ignored stale prostitute-night completion');
      return null;
    }
    return this.startRegularNight(game);
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

    if (game.phase === 'NIGHT_PROSTITUTE') {
      const nextGame = await this.startRegularNight(game);
      return nextGame === null ? null : { game: nextGame, kind: 'NIGHT_STARTED' };
    }

    if (game.phase === 'NIGHT') {
      return this.resolveNightAndStartDay(game, 'deadline');
    }

    if (game.phase === 'DAY_DISCUSSION') {
      const nextGame = await this.startDayVote(game);
      return nextGame === null ? null : { game: nextGame, kind: 'DAY_NOMINATION_STARTED' };
    }

    if (game.phase === 'DAY_NOMINATION') {
      return this.closeDayVote(game);
    }

    if (game.phase === 'DAY_TIE_DISCUSSION') {
      const nextGame = await this.startDayRevote(game);
      return nextGame === null ? null : { game: nextGame, kind: 'DAY_REVOTE_STARTED' };
    }

    if (game.phase === 'DAY_VOTE') {
      return this.closeDayVote(game);
    }

    if (game.phase === 'DAY_REVOTE') {
      return this.closeDayVote(game);
    }

    if (game.phase === 'DAY_FINAL_DECISION') {
      return this.closeDayVote(game);
    }

    this.logger.warn({ gameId: game.id, phase: game.phase }, '[PhaseService.processExpiredJob] No deadline handler for phase yet');
    return { game, kind: 'UNHANDLED_PHASE' };
  }

  public async closeDayVote(game: Game): Promise<CityVoteClosure | null> {
    if (!['DAY_NOMINATION', 'DAY_VOTE', 'DAY_REVOTE', 'DAY_FINAL_DECISION'].includes(game.phase)) {
      return null;
    }

    if (game.phase === 'DAY_NOMINATION') {
      const activeRound = await this.dayService?.getActiveRound(game) ?? null;
      const nominatedCandidateIds = await this.votingService.getNominatedCandidateIds(game.id, game.stateVersion);
      await this.votingService.closeCurrentRound(game.id, game.stateVersion, activeRound?.round ?? null);
      if (nominatedCandidateIds.length >= 2) {
        const nextGame = await this.startPrimaryVote(game, nominatedCandidateIds);
        return nextGame === null ? null : { game: nextGame, kind: 'DAY_VOTE_STARTED' };
      }
      const resolution = await this.votingService.applyDayOutcome(game.id, {
        round: activeRound?.round ?? null,
        resolution: resolveVote([]),
        voteDetails: activeRound?.voteDetails ?? [],
      });
      return this.finishCityDay(game, resolution);
    }

    const resolution = await this.votingService.resolveVote(game.id, game.stateVersion);
    await this.votingService.closeCurrentRound(game.id, game.stateVersion, resolution.round);
    if (resolution.resolution.outcome === 'TIE' && resolution.resolution.tiedPlayerIds.length >= 2) {
      if (game.phase === 'DAY_VOTE') {
        const nextGame = await this.startTieDiscussion(game);
        return nextGame === null ? null : { game: nextGame, kind: 'DAY_TIE_DISCUSSION_STARTED', resolution };
      }
      if (game.phase === 'DAY_REVOTE') {
        const nextGame = await this.startFinalDecision(game, resolution.resolution.tiedPlayerIds);
        return nextGame === null ? null : { game: nextGame, kind: 'DAY_FINAL_DECISION_STARTED', resolution };
      }
    }

    return this.finishCityDay(game, await this.votingService.applyDayOutcome(game.id, resolution));
  }

  private async finishCityDay(
    game: Game,
    resolution: AppliedVoteResolution,
  ): Promise<Extract<CityVoteClosure, { kind: 'DAY_VOTE_RESOLVED' | 'GAME_FINISHED' }> | null> {
    const finalization = await this.gameFinalizationService.finalizeIfWinner(game);
    if (finalization !== null) {
      return { game: finalization.game, kind: 'GAME_FINISHED', finalization, voteResolution: resolution };
    }
    if (!isCityDayClosingPhase(game.phase)) {
      return null;
    }
    const nextGame = await this.startCityNight(game, game.phase);
    if (nextGame === null) {
      return null;
    }

    this.logger.info({ gameId: nextGame.id, outcome: resolution.resolution.outcome, eliminatedPlayerCount: resolution.eliminatedPlayers.length, alibiAppliedCount: resolution.alibiedPlayers.length }, '[PhaseService.closeDayVote] City day transitioned to night');
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
      { gameId: nextGame.id, phase: nextGame.phase, trigger, eliminatedPlayerCount: resolution.eliminatedPlayers.length, savedPlayerCount: resolution.savedPlayers.length },
      '[FIX:early-night-completion] Night transitioned to day discussion',
    );
    return { game: nextGame, kind: 'NIGHT_RESOLVED', resolution };
  }

  private async startDayNomination(game: Game, trigger: 'manual' | 'deadline'): Promise<Game | null> {
    if (game.phase !== 'DAY_DISCUSSION') {
      return null;
    }

    const nextGame = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'DAY_DISCUSSION',
      currentVersion: game.stateVersion,
      nextPhase: 'DAY_NOMINATION',
      nextStatus: 'RUNNING',
      deadline: new Date(Date.now() + this.config.voteDurationSeconds * 1000),
    });
    if (nextGame !== null) {
      this.logger.info(
        { gameId: nextGame.id, phase: nextGame.phase, trigger },
        '[PhaseService.startDayNomination] Day nomination started',
      );
    }
    return nextGame;
  }

  private async startCityNight(
    game: Game,
    currentPhase: 'ROLE_CONFIRMATION' | 'DAY_NOMINATION' | 'DAY_VOTE' | 'DAY_REVOTE' | 'DAY_FINAL_DECISION',
  ): Promise<Game | null> {
    const deadline = new Date(Date.now() + this.config.nightDurationSeconds * 1000);
    this.logger.debug({ gameId: game.id, phase: currentPhase, stateVersion: game.stateVersion, deadline }, '[PhaseService.startCityNight] Starting prostitute-first night');
    const prostituteNight = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase,
      currentVersion: game.stateVersion,
      nextPhase: 'NIGHT_PROSTITUTE',
      nextStatus: 'RUNNING',
      deadline,
    });
    if (prostituteNight === null) {
      return null;
    }

    const hasLivingProstitute = this.playerRepository === undefined
      ? false
      : (await this.playerRepository.listAlivePlayers(prostituteNight.id)).some((player) => player.role === 'PROSTITUTE');
    if (hasLivingProstitute) {
      this.logger.info({ gameId: prostituteNight.id, phase: prostituteNight.phase, stateVersion: prostituteNight.stateVersion }, '[PhaseService.startCityNight] Prostitute-night stage started');
      return prostituteNight;
    }
    return this.startRegularNight(prostituteNight);
  }

  private async startRegularNight(game: Game): Promise<Game | null> {
    if (game.phase !== 'NIGHT_PROSTITUTE') {
      return null;
    }
    const deadline = new Date(Date.now() + this.config.nightDurationSeconds * 1000);
    const nextGame = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase: 'NIGHT_PROSTITUTE',
      currentVersion: game.stateVersion,
      nextPhase: 'NIGHT',
      nextStatus: 'RUNNING',
      deadline,
    });
    if (nextGame !== null) {
      this.logger.info({ gameId: nextGame.id, phase: nextGame.phase, stateVersion: nextGame.stateVersion }, '[PhaseService.startRegularNight] Regular night started');
    }
    return nextGame;
  }

  private async transitionDayPhase(
    game: Game,
    currentPhase: 'DAY_NOMINATION' | 'DAY_VOTE' | 'DAY_TIE_DISCUSSION' | 'DAY_REVOTE',
    nextPhase: 'DAY_VOTE' | 'DAY_TIE_DISCUSSION' | 'DAY_REVOTE' | 'DAY_FINAL_DECISION',
    durationSeconds: number,
    transition: string,
  ): Promise<Game | null> {
    if (game.phase !== currentPhase) {
      return null;
    }
    const nextGame = await this.gameRepository.transitionPhase({
      gameId: game.id,
      currentPhase,
      currentVersion: game.stateVersion,
      nextPhase,
      nextStatus: 'RUNNING',
      deadline: new Date(Date.now() + durationSeconds * 1000),
    });
    if (nextGame !== null) {
      this.logger.info({ gameId: nextGame.id, phase: nextGame.phase, stateVersion: nextGame.stateVersion, transition }, '[PhaseService.transitionDayPhase] Day phase transitioned');
    }
    return nextGame;
  }
}

function isCityDayClosingPhase(phase: Game['phase']): phase is 'DAY_NOMINATION' | 'DAY_VOTE' | 'DAY_REVOTE' | 'DAY_FINAL_DECISION' {
  return phase === 'DAY_NOMINATION' || phase === 'DAY_VOTE' || phase === 'DAY_REVOTE' || phase === 'DAY_FINAL_DECISION';
}
