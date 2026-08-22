import type { Game, VoteRound } from '@prisma/client';

import { renderVoteView } from '../bot/views/voteView.js';
import { toPublicVoteDetails, type PublicVoteDetail } from '../domain/game/voteDetails.js';
import type { VoteRoundKind } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../infrastructure/repositories/VoteRepository.js';
import type { VoteRoundRepository } from '../infrastructure/repositories/VoteRoundRepository.js';

export type ActiveCityRound = Readonly<{
  round: VoteRound;
  candidates: readonly Readonly<{ id: string; displayName: string }>[];
  votesCast: number;
  votersTotal: number;
  voteDetails: readonly PublicVoteDetail[];
}>;

export class DayService {
  public constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly voteRepository: VoteRepository,
    private readonly logger: AppLogger,
    private readonly voteRoundRepository?: VoteRoundRepository,
  ) {}

  public async startNominationRound(game: Game, durationSeconds: number): Promise<Game | null> {
    if (game.phase !== 'DAY_DISCUSSION' || this.voteRoundRepository === undefined) {
      return null;
    }
    const players = await this.playerRepository.listAlivePlayers(game.id);
    const started = await this.voteRoundRepository.transitionPhaseWithRound({
      gameId: game.id,
      currentPhase: game.phase,
      currentVersion: game.stateVersion,
      nextPhase: 'DAY_NOMINATION',
      deadline: new Date(Date.now() + durationSeconds * 1000),
      sequence: 1,
      kind: 'NOMINATION',
      candidatePlayerIds: players.map((player) => player.id),
    });
    return started?.game ?? null;
  }

  public async startPrimaryVote(game: Game, candidatePlayerIds: readonly string[], durationSeconds: number): Promise<Game | null> {
    return this.startRound(game, 'DAY_NOMINATION', 'DAY_VOTE', 'PRIMARY', 2, candidatePlayerIds, durationSeconds);
  }

  public async startRevote(game: Game, candidatePlayerIds: readonly string[], durationSeconds: number): Promise<Game | null> {
    return this.startRound(game, 'DAY_TIE_DISCUSSION', 'DAY_REVOTE', 'REVOTE', 3, candidatePlayerIds, durationSeconds);
  }

  public async startFinalDecision(game: Game, candidatePlayerIds: readonly string[], durationSeconds: number): Promise<Game | null> {
    return this.startRound(game, 'DAY_REVOTE', 'DAY_FINAL_DECISION', 'FINAL_DECISION', 4, candidatePlayerIds, durationSeconds);
  }

  public async getActiveRound(game: Game): Promise<ActiveCityRound | null> {
    if (this.voteRoundRepository === undefined) {
      return null;
    }
    const round = await this.voteRoundRepository.findOpenRound(game.id, game.stateVersion);
    if (round === null) {
      return null;
    }
    const [players, storedVotes] = await Promise.all([
      this.playerRepository.listAlivePlayers(game.id),
      this.voteRepository.listVotesForRound(game.id, round.id),
    ]);
    const votes = storedVotes.filter((vote) => vote.confirmedAt !== null);
    const playersById = new Map(players.map((player) => [player.id, player]));
    const candidates = round.candidatePlayerIds.flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player === undefined ? [] : [{ id: player.id, displayName: player.displayName }];
    });
    const voteDetails = round.kind === 'FINAL_DECISION'
      ? toFinalDecisionVoteDetails(votes, players)
      : toPublicVoteDetails(votes, players);
    return { round, candidates, votesCast: votes.length, votersTotal: players.length, voteDetails };
  }

  public async renderVote(game: Game): Promise<ReturnType<typeof renderVoteView>> {
    const activeRound = await this.getActiveRound(game);
    if (activeRound !== null) {
      this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, roundKind: activeRound.round.kind, candidateCount: activeRound.candidates.length, votesCast: activeRound.votesCast, votersTotal: activeRound.votersTotal }, '[DayService.renderVote] Rendering persisted city round');
      return renderVoteView({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        kind: activeRound.round.kind as VoteRoundKind,
        candidates: activeRound.candidates,
        votesCast: activeRound.votesCast,
        votersTotal: activeRound.votersTotal,
        voteDetails: activeRound.voteDetails,
      });
    }

    const [players, storedVotes] = await Promise.all([
      this.playerRepository.listAlivePlayers(game.id),
      this.voteRepository.listVotes(game.id, game.stateVersion),
    ]);
    const votes = storedVotes.filter((vote) => vote.confirmedAt !== null);
    this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, candidateCount: players.length, votesCast: votes.length, votersTotal: players.length }, '[DayService.renderVote] Rendering legacy vote');
    return renderVoteView({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      kind: 'PRIMARY',
      candidates: players.map((player) => ({ id: player.id, displayName: player.displayName })),
      votesCast: votes.length,
      votersTotal: players.length,
      voteDetails: toPublicVoteDetails(votes, players),
    });
  }

  private async startRound(
    game: Game,
    currentPhase: Extract<Game['phase'], 'DAY_NOMINATION' | 'DAY_TIE_DISCUSSION' | 'DAY_REVOTE'>,
    nextPhase: Extract<Game['phase'], 'DAY_VOTE' | 'DAY_REVOTE' | 'DAY_FINAL_DECISION'>,
    kind: VoteRoundKind,
    sequence: number,
    candidatePlayerIds: readonly string[],
    durationSeconds: number,
  ): Promise<Game | null> {
    if (game.phase !== currentPhase || this.voteRoundRepository === undefined || candidatePlayerIds.length < 2) {
      return null;
    }
    const started = await this.voteRoundRepository.transitionPhaseWithRound({
      gameId: game.id,
      currentPhase,
      currentVersion: game.stateVersion,
      nextPhase,
      deadline: new Date(Date.now() + durationSeconds * 1000),
      sequence,
      kind,
      candidatePlayerIds,
    });
    return started?.game ?? null;
  }
}

function toFinalDecisionVoteDetails(
  votes: readonly Readonly<{ voterPlayerId: string; isSkip: boolean }>[],
  players: readonly Readonly<{ id: string; displayName: string }>[],
): readonly PublicVoteDetail[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return votes.flatMap((vote) => {
    const voter = playersById.get(vote.voterPlayerId);
    return voter === undefined
      ? []
      : [{ voterDisplayName: voter.displayName, targetDisplayName: vote.isSkip ? 'Оставить всех' : 'Казнить всех' }];
  }).sort((left, right) => left.voterDisplayName.localeCompare(right.voterDisplayName, 'ru'));
}
