import { GamePhase as DbGamePhase, GameStatus as DbGameStatus, PhaseJobKind, Prisma, VoteRoundKind as DbVoteRoundKind, type Game, type PrismaClient, type VoteRound } from '@prisma/client';

import type { GamePhase, VoteRoundKind } from '../../domain/game/types.js';
import type { AppLogger } from '../../observability/logger.js';

export type OpenVoteRoundResult = Readonly<{
  game: Game;
  voteRound: VoteRound;
}>;

export class VoteRoundRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async transitionPhaseWithRound(input: Readonly<{
    gameId: string;
    currentPhase: GamePhase;
    currentVersion: number;
    nextPhase: GamePhase;
    deadline: Date;
    sequence: number;
    kind: VoteRoundKind;
    candidatePlayerIds: readonly string[];
  }>): Promise<OpenVoteRoundResult | null> {
    this.logger.debug(
      { gameId: input.gameId, phase: input.currentPhase, nextPhase: input.nextPhase, stateVersion: input.currentVersion, sequence: input.sequence, roundKind: input.kind, candidateCount: input.candidatePlayerIds.length },
      '[VoteRoundRepository.transitionPhaseWithRound] Starting phase and vote round atomically',
    );
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const update = await transaction.game.updateMany({
          where: { id: input.gameId, phase: toDbPhase(input.currentPhase), stateVersion: input.currentVersion },
          data: {
            phase: toDbPhase(input.nextPhase),
            status: DbGameStatus.RUNNING,
            phaseDeadline: input.deadline,
            stateVersion: { increment: 1 },
          },
        });
        if (update.count !== 1) {
          this.logger.warn({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion }, '[VoteRoundRepository.transitionPhaseWithRound] Stale phase transition ignored');
          return null;
        }
        const phaseVersion = input.currentVersion + 1;
        const voteRound = await transaction.voteRound.create({
          data: {
            gameId: input.gameId,
            phaseVersion,
            sequence: input.sequence,
            kind: toDbVoteRoundKind(input.kind),
            candidatePlayerIds: [...input.candidatePlayerIds],
          },
        });
        await transaction.phaseJob.upsert({
          where: { gameId_phaseVersion_kind: { gameId: input.gameId, phaseVersion, kind: PhaseJobKind.PHASE_DEADLINE } },
          update: { dueAt: input.deadline, processedAt: null },
          create: { gameId: input.gameId, phaseVersion, kind: PhaseJobKind.PHASE_DEADLINE, dueAt: input.deadline },
        });
        const game = await transaction.game.findUniqueOrThrow({ where: { id: input.gameId } });
        this.logger.info({ gameId: game.id, phase: game.phase, stateVersion: game.stateVersion, sequence: input.sequence, roundKind: input.kind, candidateCount: input.candidatePlayerIds.length }, '[VoteRoundRepository.transitionPhaseWithRound] Phase and vote round started');
        return { game, voteRound };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, sequence: input.sequence }, '[VoteRoundRepository.transitionPhaseWithRound] Duplicate phase round rejected');
        return null;
      }
      this.logger.error({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, error }, '[VoteRoundRepository.transitionPhaseWithRound] Failed to start phase round');
      throw error;
    }
  }

  public async openRound(input: Readonly<{
    gameId: string;
    currentPhase: GamePhase;
    currentVersion: number;
    sequence: number;
    kind: VoteRoundKind;
    candidatePlayerIds: readonly string[];
  }>): Promise<OpenVoteRoundResult | null> {
    this.logger.debug(
      { gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, sequence: input.sequence, roundKind: input.kind, candidateCount: input.candidatePlayerIds.length },
      '[VoteRoundRepository.openRound] Opening vote round with optimistic lock',
    );

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const update = await transaction.game.updateMany({
          where: {
            id: input.gameId,
            phase: toDbPhase(input.currentPhase),
            stateVersion: input.currentVersion,
          },
          data: { stateVersion: { increment: 1 } },
        });
        if (update.count !== 1) {
          this.logger.warn({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion }, '[VoteRoundRepository.openRound] Stale round start ignored');
          return null;
        }

        const phaseVersion = input.currentVersion + 1;
        const voteRound = await transaction.voteRound.create({
          data: {
            gameId: input.gameId,
            phaseVersion,
            sequence: input.sequence,
            kind: toDbVoteRoundKind(input.kind),
            candidatePlayerIds: [...input.candidatePlayerIds],
          },
        });
        const game = await transaction.game.findUniqueOrThrow({ where: { id: input.gameId } });
        this.logger.info({ gameId: game.id, phase: game.phase, stateVersion: game.stateVersion, sequence: input.sequence, roundKind: input.kind, candidateCount: input.candidatePlayerIds.length }, '[VoteRoundRepository.openRound] Vote round opened');
        return { game, voteRound };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, sequence: input.sequence }, '[VoteRoundRepository.openRound] Duplicate round rejected');
        return null;
      }
      this.logger.error({ gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, error }, '[VoteRoundRepository.openRound] Failed to open vote round');
      throw error;
    }
  }

  public async findOpenRound(gameId: string, phaseVersion: number): Promise<VoteRound | null> {
    this.logger.debug({ gameId, phaseVersion }, '[VoteRoundRepository.findOpenRound] Loading active vote round');
    return this.prisma.voteRound.findFirst({
      where: { gameId, phaseVersion, closedAt: null },
      orderBy: { sequence: 'desc' },
    });
  }

  public async findLatestRound(gameId: string, kind: VoteRoundKind): Promise<VoteRound | null> {
    this.logger.debug({ gameId, roundKind: kind }, '[VoteRoundRepository.findLatestRound] Loading latest round');
    return this.prisma.voteRound.findFirst({
      where: { gameId, kind: toDbVoteRoundKind(kind) },
      orderBy: [{ sequence: 'desc' }, { openedAt: 'desc' }],
    });
  }

  public async closeRound(input: Readonly<{ gameId: string; phaseVersion: number; sequence: number }>): Promise<boolean> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion, sequence: input.sequence }, '[VoteRoundRepository.closeRound] Closing vote round');
    const update = await this.prisma.voteRound.updateMany({
      where: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        sequence: input.sequence,
        closedAt: null,
      },
      data: { closedAt: new Date() },
    });
    const closed = update.count === 1;
    if (!closed) {
      this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion, sequence: input.sequence }, '[VoteRoundRepository.closeRound] Stale round close ignored');
      return false;
    }
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion, sequence: input.sequence }, '[VoteRoundRepository.closeRound] Vote round closed');
    return true;
  }
}

function toDbPhase(phase: GamePhase): DbGamePhase {
  return DbGamePhase[phase];
}

function toDbVoteRoundKind(kind: VoteRoundKind): DbVoteRoundKind {
  return DbVoteRoundKind[kind];
}
