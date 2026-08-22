import type { PrismaClient, Vote } from '@prisma/client';

import type { AppLogger } from '../../observability/logger.js';

export class VoteRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async upsertVote(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    voterPlayerId: string;
    targetPlayerId: string | null;
    voteRoundId?: string;
    isSkip?: boolean;
  }>): Promise<Vote> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion, hasRound: input.voteRoundId !== undefined }, '[VoteRepository.upsertVote] Saving vote');
    const vote = await this.prisma.vote.upsert({
      where: {
        gameId_phaseVersion_voterPlayerId: {
          gameId: input.gameId,
          phaseVersion: input.phaseVersion,
          voterPlayerId: input.voterPlayerId,
        },
      },
      create: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        voterPlayerId: input.voterPlayerId,
        targetPlayerId: input.targetPlayerId,
        isSkip: input.isSkip ?? input.targetPlayerId === null,
        voteRoundId: input.voteRoundId ?? null,
        confirmedAt: null,
      },
      update: {
        targetPlayerId: input.targetPlayerId,
        isSkip: input.isSkip ?? input.targetPlayerId === null,
        voteRoundId: input.voteRoundId ?? null,
        confirmedAt: null,
      },
    });
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[VoteRepository.upsertVote] Vote accepted');
    return vote;
  }

  public async confirmVote(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    voterPlayerId: string;
    voteRoundId?: string;
  }>): Promise<boolean> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion, voterPlayerId: input.voterPlayerId, hasRound: input.voteRoundId !== undefined }, '[VoteRepository.confirmVote] Confirming city vote draft');
    const update = await this.prisma.vote.updateMany({
      where: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        voterPlayerId: input.voterPlayerId,
        voteRoundId: input.voteRoundId ?? null,
        confirmedAt: null,
        game: { is: { stateVersion: input.phaseVersion } },
        ...(input.voteRoundId === undefined ? {} : { voteRound: { is: { id: input.voteRoundId, closedAt: null } } }),
      },
      data: { confirmedAt: new Date() },
    });
    return update.count === 1;
  }

  public async listVotes(gameId: string, phaseVersion: number): Promise<Vote[]> {
    this.logger.debug({ gameId, phaseVersion }, '[VoteRepository.listVotes] Loading votes');
    return this.prisma.vote.findMany({ where: { gameId, phaseVersion } });
  }

  public async findVote(input: Readonly<{ gameId: string; phaseVersion: number; voterPlayerId: string }>): Promise<Vote | null> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[FIX:city-vote-panel] Loading personal city vote');
    return this.prisma.vote.findUnique({
      where: {
        gameId_phaseVersion_voterPlayerId: input,
      },
    });
  }

  public async countVotes(gameId: string, phaseVersion: number): Promise<number> {
    return this.prisma.vote.count({ where: { gameId, phaseVersion } });
  }

  public async listVotesForRound(gameId: string, voteRoundId: string): Promise<Vote[]> {
    this.logger.debug({ gameId }, '[VoteRepository.listVotesForRound] Loading round votes');
    return this.prisma.vote.findMany({ where: { gameId, voteRoundId } });
  }

  public async countVotesForRound(gameId: string, voteRoundId: string): Promise<number> {
    this.logger.debug({ gameId }, '[VoteRepository.countVotesForRound] Counting round votes');
    return this.prisma.vote.count({ where: { gameId, voteRoundId } });
  }

  public async countConfirmedVotes(gameId: string, phaseVersion: number): Promise<number> {
    return this.prisma.vote.count({ where: { gameId, phaseVersion, confirmedAt: { not: null } } });
  }

  public async countConfirmedVotesForRound(gameId: string, voteRoundId: string): Promise<number> {
    return this.prisma.vote.count({ where: { gameId, voteRoundId, confirmedAt: { not: null } } });
  }
}
