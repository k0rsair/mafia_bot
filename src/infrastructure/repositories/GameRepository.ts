import { GamePhase as DbGamePhase, GameStatus as DbGameStatus, Prisma, Role as DbRole, type Game, type PrismaClient } from '@prisma/client';

import type { GamePhase, GameStatus, RoleAssignment } from '../../domain/game/types.js';
import type { AppLogger } from '../../observability/logger.js';

type CreateLobbyInput = Readonly<{
  chatId: string;
  chatTitle?: string;
  creatorId: string;
  lobbyMessageId: number;
}>;

type PhaseTransitionInput = Readonly<{
  gameId: string;
  currentPhase: GamePhase;
  currentVersion: number;
  nextPhase: GamePhase;
  nextStatus: GameStatus;
  deadline: Date | null;
}>;

type StartRoleConfirmationInput = Readonly<{
  gameId: string;
  currentVersion: number;
  assignments: readonly RoleAssignment[];
  deadline: Date;
}>;

export class GameRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async createLobby(input: CreateLobbyInput): Promise<Game> {
    this.logger.debug({ chatId: input.chatId, creatorId: input.creatorId }, '[GameRepository.createLobby] Creating lobby');

    const game = await this.prisma.game.create({
      data: {
        chat: {
          connectOrCreate: {
            where: { id: input.chatId },
            create: { id: input.chatId, title: input.chatTitle ?? null },
          },
        },
        creatorId: input.creatorId,
        lobbyMessageId: input.lobbyMessageId,
        activeKey: input.chatId,
      },
    });

    this.logger.info({ gameId: game.id, chatId: game.chatId, phase: game.phase }, '[GameRepository.createLobby] Lobby created');
    return game;
  }

  public async findActiveByChatId(chatId: string): Promise<Game | null> {
    this.logger.debug({ chatId }, '[GameRepository.findActiveByChatId] Fetching active game');
    return this.prisma.game.findUnique({ where: { activeKey: chatId } });
  }

  public async findById(gameId: string): Promise<Game | null> {
    this.logger.debug({ gameId }, '[GameRepository.findById] Fetching game');
    return this.prisma.game.findUnique({ where: { id: gameId } });
  }

  public async transitionPhase(input: PhaseTransitionInput): Promise<Game | null> {
    this.logger.debug(
      { gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion, nextPhase: input.nextPhase },
      '[GameRepository.transitionPhase] Attempting optimistic phase transition',
    );

    return this.withSerializableTransaction(async (transaction) => {
      const update = await transaction.game.updateMany({
        where: {
          id: input.gameId,
          phase: toDbPhase(input.currentPhase),
          stateVersion: input.currentVersion,
        },
        data: {
          phase: toDbPhase(input.nextPhase),
          status: toDbStatus(input.nextStatus),
          phaseDeadline: input.deadline,
          stateVersion: { increment: 1 },
        },
      });

      if (update.count !== 1) {
        this.logger.warn(
          { gameId: input.gameId, phase: input.currentPhase, stateVersion: input.currentVersion },
          '[GameRepository.transitionPhase] Ignored stale transition',
        );
        return null;
      }

      if (input.deadline !== null) {
        await transaction.phaseJob.upsert({
          where: {
            gameId_phaseVersion_kind: {
              gameId: input.gameId,
              phaseVersion: input.currentVersion + 1,
              kind: 'PHASE_DEADLINE',
            },
          },
          update: { dueAt: input.deadline, processedAt: null },
          create: {
            gameId: input.gameId,
            phaseVersion: input.currentVersion + 1,
            kind: 'PHASE_DEADLINE',
            dueAt: input.deadline,
          },
        });
      }

      const game = await transaction.game.findUniqueOrThrow({ where: { id: input.gameId } });
      this.logger.info({ gameId: game.id, phase: game.phase, stateVersion: game.stateVersion }, '[GameRepository.transitionPhase] Phase transitioned');
      return game;
    });
  }

  public async setControlMessageId(gameId: string, controlMessageId: number): Promise<void> {
    this.logger.debug({ gameId, controlMessageId }, '[GameRepository.setControlMessageId] Saving control message reference');
    await this.prisma.game.update({ where: { id: gameId }, data: { controlMessageId } });
  }

  public async startRoleConfirmation(input: StartRoleConfirmationInput): Promise<Game | null> {
    this.logger.debug(
      { gameId: input.gameId, stateVersion: input.currentVersion, playerCount: input.assignments.length },
      '[GameRepository.startRoleConfirmation] Starting game with optimistic lock',
    );

    return this.withSerializableTransaction(async (transaction) => {
      const update = await transaction.game.updateMany({
        where: {
          id: input.gameId,
          phase: DbGamePhase.LOBBY,
          status: DbGameStatus.LOBBY,
          stateVersion: input.currentVersion,
        },
        data: {
          phase: DbGamePhase.ROLE_CONFIRMATION,
          status: DbGameStatus.RUNNING,
          phaseDeadline: input.deadline,
          stateVersion: { increment: 1 },
        },
      });

      if (update.count !== 1) {
        this.logger.warn({ gameId: input.gameId, stateVersion: input.currentVersion }, '[GameRepository.startRoleConfirmation] Ignored stale start request');
        return null;
      }

      await Promise.all(
        input.assignments.map((assignment) =>
          transaction.player.update({
            where: { id: assignment.playerId },
            data: { role: toDbRole(assignment.role), status: 'ALIVE', roleConfirmedAt: null },
          }),
        ),
      );

      await transaction.phaseJob.upsert({
        where: {
          gameId_phaseVersion_kind: {
            gameId: input.gameId,
            phaseVersion: input.currentVersion + 1,
            kind: 'PHASE_DEADLINE',
          },
        },
        update: { dueAt: input.deadline, processedAt: null },
        create: {
          gameId: input.gameId,
          phaseVersion: input.currentVersion + 1,
          kind: 'PHASE_DEADLINE',
          dueAt: input.deadline,
        },
      });

      const game = await transaction.game.findUniqueOrThrow({ where: { id: input.gameId } });
      this.logger.info(
        { gameId: game.id, phase: game.phase, stateVersion: game.stateVersion, playerCount: input.assignments.length },
        '[GameRepository.startRoleConfirmation] Game started',
      );
      return game;
    });
  }

  public async closeGame(gameId: string, expectedVersion: number, status: Extract<GameStatus, 'FINISHED' | 'CANCELLED'>): Promise<Game | null> {
    this.logger.debug({ gameId, expectedVersion, status }, '[GameRepository.closeGame] Closing active game');

    const update = await this.prisma.game.updateMany({
      where: { id: gameId, stateVersion: expectedVersion, activeKey: { not: null } },
      data: {
        activeKey: null,
        status: toDbStatus(status),
        phase: status === 'FINISHED' ? DbGamePhase.FINISHED : DbGamePhase.CANCELLED,
        phaseDeadline: null,
        finishedAt: new Date(),
        stateVersion: { increment: 1 },
      },
    });

    if (update.count !== 1) {
      this.logger.warn({ gameId, expectedVersion }, '[GameRepository.closeGame] Ignored stale close request');
      return null;
    }

    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    this.logger.info({ gameId, status }, '[GameRepository.closeGame] Game closed');
    return game;
  }

  public async listRecoverableGames(): Promise<Game[]> {
    this.logger.debug('[GameRepository.listRecoverableGames] Loading active games after startup');
    return this.prisma.game.findMany({ where: { activeKey: { not: null } }, orderBy: { updatedAt: 'asc' } });
  }

  public async withSerializableTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.logger.debug('[GameRepository.withSerializableTransaction] Opening serializable transaction');
    return this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function toDbPhase(phase: GamePhase): DbGamePhase {
  return DbGamePhase[phase];
}

function toDbStatus(status: GameStatus): DbGameStatus {
  return DbGameStatus[status];
}

function toDbRole(role: RoleAssignment['role']): DbRole {
  const databaseRole = DbRole[role as keyof typeof DbRole];
  if (databaseRole === undefined) {
    throw new Error(`Role ${role} is not available in the current database schema`);
  }
  return databaseRole;
}
