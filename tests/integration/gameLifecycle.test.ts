import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assignRoles } from '../../src/domain/game/roleAssignment.js';
import { GameRepository } from '../../src/infrastructure/repositories/GameRepository.js';
import { PlayerRepository } from '../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../src/observability/logger.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(testDatabaseUrl === undefined)('PostgreSQL game lifecycle', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl ?? 'postgresql://invalid:invalid@localhost:1/invalid' } } });
  const logger = createLogger({ logLevel: 'silent' });
  const gameRepository = new GameRepository(prisma, logger);
  const playerRepository = new PlayerRepository(prisma, logger);
  const chatId = `test-chat-${randomUUID()}`;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.gameChat.deleteMany({ where: { id: chatId } });
    await prisma.$disconnect();
  });

  it('persists a single role-confirmation transition and durable deadline job', async () => {
    const game = await gameRepository.createLobby({ chatId, creatorId: 'creator-1', lobbyMessageId: 1 });
    const userIds = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    for (const userId of userIds) {
      await playerRepository.joinLobby({ gameId: game.id, userId, displayName: userId });
    }

    const players = await playerRepository.listLobbyPlayers(game.id);
    const started = await gameRepository.startRoleConfirmation({
      gameId: game.id,
      currentVersion: game.stateVersion,
      assignments: assignRoles(players.map((player) => player.id)),
      deadline: new Date(Date.now() + 60_000),
    });

    expect(started).toMatchObject({ phase: 'ROLE_CONFIRMATION', status: 'RUNNING', stateVersion: 2 });
    expect(await prisma.phaseJob.count({ where: { gameId: game.id, phaseVersion: 2 } })).toBe(1);
    expect(await gameRepository.startRoleConfirmation({
      gameId: game.id,
      currentVersion: game.stateVersion,
      assignments: assignRoles(players.map((player) => player.id)),
      deadline: new Date(Date.now() + 60_000),
    })).toBeNull();
  });
});
