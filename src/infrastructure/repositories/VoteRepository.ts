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
      },
      update: {
        targetPlayerId: input.targetPlayerId,
        isSkip: input.isSkip ?? input.targetPlayerId === null,
        voteRoundId: input.voteRoundId ?? null,
      },
    });
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[VoteRepository.upsertVote] Vote accepted');
    return vote;
  }

  public async listVotes(gameId: string, phaseVersion: number): Promise<Vote[]> {
    this.logger.debug({ gameId, phaseVersion }, '[VoteRepository.listVotes] Loading votes');
    return this.prisma.vote.findMany({ where: { gameId, phaseVersion } });
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
}
