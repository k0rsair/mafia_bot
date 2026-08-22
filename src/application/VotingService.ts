import type { Game, Player, VoteRound } from '@prisma/client';

import { toPublicVoteDetails, type PublicVoteDetail } from '../domain/game/voteDetails.js';
import { resolveFinalDecision, resolveVote, type VoteResolution } from '../domain/game/voteResolution.js';
import type { VoteRoundKind } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { DayEffectRepository } from '../infrastructure/repositories/DayEffectRepository.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../infrastructure/repositories/VoteRepository.js';
import type { VoteRoundRepository } from '../infrastructure/repositories/VoteRoundRepository.js';
import { CallbackGuardService } from './CallbackGuardService.js';

export class VotingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'VotingError';
  }
}

export type VoteProgress = Readonly<{
  game: Game;
  votesCast: number;
  votersTotal: number;
  allVoted: boolean;
  roundKind?: VoteRoundKind;
}>;

export type ResolvedVoteRound = Readonly<{
  round: VoteRound | null;
  resolution: VoteResolution;
  voteDetails: readonly PublicVoteDetail[];
}>;

export type VoteRoundOptions = Readonly<{
  kind: VoteRoundKind | null;
  candidatePlayerIds: readonly string[];
}>;

export type AppliedVoteResolution = Readonly<{
  resolution: VoteResolution;
  roundKind?: VoteRoundKind;
  eliminatedPlayers: readonly Player[];
  eliminatedPlayer: Player | null;
  alibiedPlayers: readonly Player[];
  voteDetails: readonly PublicVoteDetail[];
}>;

export class VotingService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly voteRepository: VoteRepository,
    private readonly logger: AppLogger,
    private readonly callbackGuard: CallbackGuardService = new CallbackGuardService(),
    private readonly voteRoundRepository?: VoteRoundRepository,
    private readonly dayEffectRepository?: DayEffectRepository,
  ) {}

  public async castVote(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    chatId: string;
    userId: string;
    targetIndex: number | null;
    action?: 'candidate' | 'all-leave' | 'all-stay';
  }>): Promise<VoteProgress> {
    const { game, voter } = await this.getVotePlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    const activeRound = this.voteRoundRepository === undefined
      ? null
      : await this.voteRoundRepository.findOpenRound(game.id, game.stateVersion);
    const [targetPlayerId, isSkip] = await this.resolveVoteSelection(game, activeRound, input);
    await this.voteRepository.upsertVote({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      voterPlayerId: voter.id,
      targetPlayerId,
      ...(activeRound === null ? {} : { voteRoundId: activeRound.id }),
      isSkip,
    });
    const [votesCast, alivePlayers] = await Promise.all([
      activeRound === null
        ? this.voteRepository.countVotes(game.id, game.stateVersion)
        : this.voteRepository.countVotesForRound(game.id, activeRound.id),
      this.playerRepository.listAlivePlayers(game.id),
    ]);

    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, votesCast, votersTotal: alivePlayers.length, ...(activeRound === null ? {} : { roundKind: activeRound.kind }) }, '[VotingService.castVote] Vote progress updated');
    return { game, votesCast, votersTotal: alivePlayers.length, allVoted: votesCast === alivePlayers.length, ...(activeRound === null ? {} : { roundKind: activeRound.kind as VoteRoundKind }) };
  }

  public async resolveVote(gameId: string, phaseVersion: number): Promise<ResolvedVoteRound> {
    this.logger.debug({ gameId, phaseVersion }, '[VotingService.resolveVote] Resolving city vote round');
    const activeRound = this.voteRoundRepository === undefined
      ? null
      : await this.voteRoundRepository.findOpenRound(gameId, phaseVersion);
    const [votes, alivePlayers] = await Promise.all([
      activeRound === null
        ? this.voteRepository.listVotes(gameId, phaseVersion)
        : this.voteRepository.listVotesForRound(gameId, activeRound.id),
      this.playerRepository.listAlivePlayers(gameId),
    ]);
    if (activeRound?.kind === 'NOMINATION') {
      throw new VotingError('Номинации закрываются отдельным городским контролом.');
    }
    const resolution = activeRound?.kind === 'FINAL_DECISION'
      ? resolveFinalDecision(votes, activeRound.candidatePlayerIds)
      : resolveVote(votes);
    const orderedResolution = resolution.outcome === 'TIE' && activeRound !== null
      ? { ...resolution, tiedPlayerIds: activeRound.candidatePlayerIds.filter((playerId) => resolution.tiedPlayerIds.includes(playerId)) }
      : resolution;
    const voteDetails = activeRound?.kind === 'FINAL_DECISION'
      ? toFinalDecisionVoteDetails(votes, alivePlayers)
      : toPublicVoteDetails(votes, alivePlayers);
    this.logger.info({ gameId, phaseVersion, voteCount: votes.length, outcome: orderedResolution.outcome, tiedCandidateCount: orderedResolution.tiedPlayerIds.length }, '[VotingService.resolveVote] City vote round resolved');
    return { round: activeRound, resolution: orderedResolution, voteDetails };
  }

  public async getNominatedCandidateIds(gameId: string, phaseVersion: number): Promise<readonly string[]> {
    if (this.voteRoundRepository === undefined) {
      return [];
    }
    const round = await this.voteRoundRepository.findOpenRound(gameId, phaseVersion);
    if (round === null || round.kind !== 'NOMINATION') {
      throw new VotingError('Раунд номинаций уже закрыт или устарел.');
    }
    const votes = await this.voteRepository.listVotesForRound(gameId, round.id);
    const nominatedIds = new Set(votes.flatMap((vote) => vote.targetPlayerId === null ? [] : [vote.targetPlayerId]));
    const candidates = round.candidatePlayerIds.filter((playerId) => nominatedIds.has(playerId));
    this.logger.info({ gameId, phaseVersion, nominatedCandidateCount: candidates.length }, '[VotingService.getNominatedCandidateIds] Nominations summarized');
    return candidates;
  }

  public async getVoteRoundOptions(gameId: string, phaseVersion: number): Promise<VoteRoundOptions> {
    if (this.voteRoundRepository === undefined) {
      return { kind: null, candidatePlayerIds: [] };
    }
    const round = await this.voteRoundRepository.findOpenRound(gameId, phaseVersion);
    return round === null
      ? { kind: null, candidatePlayerIds: [] }
      : { kind: round.kind as VoteRoundKind, candidatePlayerIds: round.candidatePlayerIds };
  }

  public async getTiedCandidateIds(gameId: string, kind: Extract<VoteRoundKind, 'PRIMARY' | 'REVOTE'>): Promise<readonly string[]> {
    if (this.voteRoundRepository === undefined) {
      return [];
    }
    const round = await this.voteRoundRepository.findLatestRound(gameId, kind);
    if (round === null) {
      return [];
    }
    const votes = await this.voteRepository.listVotesForRound(gameId, round.id);
    const resolution = resolveVote(votes);
    return round.candidatePlayerIds.filter((playerId) => resolution.tiedPlayerIds.includes(playerId));
  }

  public async applyDayOutcome(gameId: string, resolved: ResolvedVoteRound): Promise<AppliedVoteResolution> {
    const alivePlayers = await this.playerRepository.listAlivePlayers(gameId);
    const playersById = new Map(alivePlayers.map((player) => [player.id, player]));
    const requestedPlayers = resolved.resolution.eliminatedPlayerIds.flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player === undefined ? [] : [player];
    });
    const alibiedPlayerIds = this.dayEffectRepository === undefined
      ? new Set<string>()
      : new Set(await this.dayEffectRepository.listActiveProstituteAlibiPlayerIds(gameId));
    const alibiedPlayers = requestedPlayers.filter((player) => alibiedPlayerIds.has(player.id));
    const eliminatedPlayers = requestedPlayers.filter((player) => !alibiedPlayerIds.has(player.id));
    for (const player of alibiedPlayers) {
      await this.dayEffectRepository?.consumeProstituteAlibi(gameId, player.id);
    }
    await this.playerRepository.eliminatePlayers(gameId, eliminatedPlayers.map((player) => player.id));
    const clearedEffectCount = this.dayEffectRepository === undefined
      ? 0
      : await this.dayEffectRepository.clearUnconsumedProstituteAlibis(gameId);
    this.logger.info({ gameId, eliminatedPlayerCount: eliminatedPlayers.length, alibiAppliedCount: alibiedPlayers.length, clearedEffectCount }, '[VotingService.applyDayOutcome] City day outcome applied');
    return {
      resolution: { ...resolved.resolution, eliminatedPlayerIds: eliminatedPlayers.map((player) => player.id), eliminatedPlayerId: eliminatedPlayers[0]?.id ?? null },
      ...(resolved.round === null ? {} : { roundKind: resolved.round.kind as VoteRoundKind }),
      eliminatedPlayers,
      eliminatedPlayer: eliminatedPlayers[0] ?? null,
      alibiedPlayers,
      voteDetails: resolved.voteDetails,
    };
  }

  public async closeCurrentRound(gameId: string, phaseVersion: number, round: VoteRound | null): Promise<void> {
    if (round === null || this.voteRoundRepository === undefined) {
      return;
    }
    await this.voteRoundRepository.closeRound({ gameId, phaseVersion, sequence: round.sequence });
  }

  public async expireDayEffects(gameId: string): Promise<void> {
    if (this.dayEffectRepository === undefined) {
      return;
    }
    const clearedEffectCount = await this.dayEffectRepository.clearUnconsumedProstituteAlibis(gameId);
    this.logger.info({ gameId, clearedEffectCount }, '[VotingService.expireDayEffects] Day effects expired without execution');
  }

  private async resolveVoteSelection(game: Game, activeRound: VoteRound | null, input: Readonly<{ targetIndex: number | null; action?: 'candidate' | 'all-leave' | 'all-stay' }>): Promise<readonly [string | null, boolean]> {
    if (activeRound === null) {
      const target = input.targetIndex === null ? null : (await this.playerRepository.listAlivePlayers(game.id))[input.targetIndex];
      if (input.targetIndex !== null && target === undefined) {
        throw new VotingError('Этого игрока уже нельзя выбрать. Откройте актуальное голосование.');
      }
      return [target?.id ?? null, input.targetIndex === null];
    }
    if (activeRound.kind === 'FINAL_DECISION') {
      if (input.action === 'all-stay') {
        return [null, true];
      }
      if (input.action === 'all-leave') {
        const representativePlayerId = activeRound.candidatePlayerIds[0];
        if (representativePlayerId === undefined) {
          throw new VotingError('В финальном решении не осталось кандидатов.');
        }
        return [representativePlayerId, false];
      }
      throw new VotingError('Выберите, оставить всех или казнить всех кандидатов.');
    }
    if (input.action !== undefined && input.action !== 'candidate') {
      throw new VotingError('Эта кнопка не подходит для текущего городского раунда.');
    }
    if (input.targetIndex === null) {
      throw new VotingError('В этом городском раунде пропускать голос нельзя.');
    }
    const targetPlayerId = activeRound.candidatePlayerIds[input.targetIndex];
    if (targetPlayerId === undefined) {
      throw new VotingError('Этого игрока уже нельзя выбрать. Откройте актуальное голосование.');
    }
    const target = await this.playerRepository.listAlivePlayers(game.id).then((players) => players.find((player) => player.id === targetPlayerId));
    if (target === undefined) {
      throw new VotingError('Этот игрок уже выбыл. Откройте актуальное голосование.');
    }
    return [target.id, false];
  }

  private async getVotePlayer(gameId: string, phaseVersion: number, chatId: string, userId: string): Promise<Readonly<{ game: Game; voter: Player }>> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || !['DAY_NOMINATION', 'DAY_VOTE', 'DAY_REVOTE', 'DAY_FINAL_DECISION'].includes(game.phase) || game.stateVersion !== phaseVersion) {
      throw new VotingError('Голосование уже завершено или устарело.');
    }
    try {
      this.callbackGuard.assertGameChat(game, chatId);
    } catch (error) {
      throw new VotingError(error instanceof Error ? error.message : 'Эта кнопка принадлежит другому игровому чату.');
    }

    const voter = await this.playerRepository.findByGameAndUserId(game.id, userId);
    if (voter === null || voter.status !== 'ALIVE') {
      throw new VotingError('Голосовать могут только живые игроки.');
    }

    return { game, voter };
  }
}

function toFinalDecisionVoteDetails(
  votes: readonly Readonly<{ voterPlayerId: string; isSkip: boolean }>[],
  players: readonly Readonly<{ id: string; displayName: string }>[],
): readonly PublicVoteDetail[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return votes.flatMap((vote) => {
    const voter = playersById.get(vote.voterPlayerId);
    return voter === undefined ? [] : [{ voterDisplayName: voter.displayName, targetDisplayName: vote.isSkip ? 'Оставить всех' : 'Казнить всех' }];
  }).sort((left, right) => left.voterDisplayName.localeCompare(right.voterDisplayName, 'ru'));
}
