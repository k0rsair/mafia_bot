import { PlayerStatus as DbPlayerStatus, Role as DbRole, type Player, type PrismaClient } from '@prisma/client';

import type { Role, RoleAssignment } from '../../domain/game/types.js';
import type { AppLogger } from '../../observability/logger.js';

type LobbyPlayerInput = Readonly<{
  gameId: string;
  userId: string;
  displayName: string;
  username?: string;
}>;

export type UnconfirmedRolePlayer = Readonly<{
  userId: string;
  displayName: string;
}>;

export class PlayerRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async joinLobby(input: LobbyPlayerInput): Promise<Player> {
    this.logger.debug({ gameId: input.gameId, userId: input.userId }, '[PlayerRepository.joinLobby] Upserting lobby player');

    const player = await this.prisma.player.upsert({
      where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
      create: {
        gameId: input.gameId,
        userId: input.userId,
        displayName: input.displayName,
        username: input.username ?? null,
      },
      update: {
        displayName: input.displayName,
        username: input.username ?? null,
        status: DbPlayerStatus.LOBBY,
        leftAt: null,
      },
    });

    this.logger.info({ gameId: input.gameId, userId: input.userId }, '[PlayerRepository.joinLobby] Player joined lobby');
    return player;
  }

  public async leaveLobby(gameId: string, userId: string): Promise<boolean> {
    this.logger.debug({ gameId, userId }, '[PlayerRepository.leaveLobby] Removing player from lobby');
    const update = await this.prisma.player.updateMany({
      where: { gameId, userId, status: DbPlayerStatus.LOBBY },
      data: { status: DbPlayerStatus.LEFT, leftAt: new Date() },
    });

    if (update.count !== 1) {
      this.logger.warn({ gameId, userId }, '[PlayerRepository.leaveLobby] Player was not in active lobby');
      return false;
    }

    this.logger.info({ gameId, userId }, '[PlayerRepository.leaveLobby] Player left lobby');
    return true;
  }

  public async listLobbyPlayers(gameId: string): Promise<Player[]> {
    this.logger.debug({ gameId }, '[PlayerRepository.listLobbyPlayers] Fetching lobby players');
    return this.prisma.player.findMany({
      where: { gameId, status: DbPlayerStatus.LOBBY },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async listAlivePlayers(gameId: string): Promise<Player[]> {
    this.logger.debug({ gameId }, '[PlayerRepository.listAlivePlayers] Fetching alive players');
    return this.prisma.player.findMany({
      where: { gameId, status: DbPlayerStatus.ALIVE },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async listUnconfirmedRolePlayers(gameId: string): Promise<UnconfirmedRolePlayer[]> {
    this.logger.debug({ gameId }, '[PlayerRepository.listUnconfirmedRolePlayers] Fetching players without role confirmation');
    const players = await this.prisma.player.findMany({
      where: { gameId, status: DbPlayerStatus.ALIVE, roleConfirmedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, displayName: true },
    });

    this.logger.info({ gameId, pendingCount: players.length }, '[PlayerRepository.listUnconfirmedRolePlayers] Loaded pending role confirmations');
    return players;
  }

  public async listPlayers(gameId: string): Promise<Player[]> {
    this.logger.debug({ gameId }, '[PlayerRepository.listPlayers] Fetching all players');
    return this.prisma.player.findMany({ where: { gameId }, orderBy: { createdAt: 'asc' } });
  }

  public async findByGameAndUserId(gameId: string, userId: string): Promise<Player | null> {
    this.logger.debug({ gameId, userId }, '[PlayerRepository.findByGameAndUserId] Fetching player');
    return this.prisma.player.findUnique({ where: { gameId_userId: { gameId, userId } } });
  }

  public async assignRoles(gameId: string, assignments: readonly RoleAssignment[]): Promise<void> {
    this.logger.debug({ gameId, playerCount: assignments.length }, '[PlayerRepository.assignRoles] Saving role assignments');

    await this.prisma.$transaction(
      assignments.map((assignment) =>
        this.prisma.player.update({
          where: { id: assignment.playerId },
          data: {
            role: toDbRole(assignment.role),
            status: DbPlayerStatus.ALIVE,
            roleConfirmedAt: null,
          },
        }),
      ),
    );

    this.logger.info({ gameId, playerCount: assignments.length }, '[PlayerRepository.assignRoles] Roles assigned');
  }

  public async confirmRole(gameId: string, userId: string): Promise<boolean> {
    this.logger.debug({ gameId, userId }, '[PlayerRepository.confirmRole] Recording role confirmation');
    const update = await this.prisma.player.updateMany({
      where: { gameId, userId, status: DbPlayerStatus.ALIVE, roleConfirmedAt: null },
      data: { roleConfirmedAt: new Date() },
    });

    if (update.count !== 1) {
      this.logger.warn({ gameId, userId }, '[PlayerRepository.confirmRole] Ignored duplicate or invalid confirmation');
      return false;
    }

    this.logger.info({ gameId, userId }, '[PlayerRepository.confirmRole] Role confirmed');
    return true;
  }

  public async countRoleConfirmations(gameId: string): Promise<number> {
    return this.prisma.player.count({
      where: { gameId, status: DbPlayerStatus.ALIVE, roleConfirmedAt: { not: null } },
    });
  }

  public async eliminatePlayer(gameId: string, playerId: string): Promise<boolean> {
    this.logger.debug({ gameId, playerId }, '[PlayerRepository.eliminatePlayer] Eliminating player');
    const update = await this.prisma.player.updateMany({
      where: { id: playerId, gameId, status: DbPlayerStatus.ALIVE },
      data: { status: DbPlayerStatus.DEAD, eliminatedAt: new Date() },
    });

    if (update.count !== 1) {
      this.logger.warn({ gameId, playerId }, '[PlayerRepository.eliminatePlayer] Player was already eliminated or invalid');
      return false;
    }

    this.logger.info({ gameId, playerId }, '[PlayerRepository.eliminatePlayer] Player eliminated');
    return true;
  }
}

function toDbRole(role: Role): DbRole {
  const databaseRole = DbRole[role as keyof typeof DbRole];
  if (databaseRole === undefined) {
    throw new Error(`Role ${role} is not available in the current database schema`);
  }
  return databaseRole;
}
