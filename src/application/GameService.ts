import type { Game } from '@prisma/client';

import type { AppConfig } from '../config/env.js';
import { assignRoles } from '../domain/game/roleAssignment.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { LobbyService } from './LobbyService.js';

export class GameStartError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GameStartError';
  }
}

export class GameService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly lobbyService: LobbyService,
    private readonly config: Pick<AppConfig, 'roleConfirmationDurationSeconds' | 'roleDistributions'>,
    private readonly logger: AppLogger,
  ) {}

  public async startGame(gameId: string): Promise<Game> {
    this.logger.debug({ gameId }, '[GameService.startGame] Starting game');
    const lobby = await this.lobbyService.validateStart(gameId);
    this.logger.debug({ gameId, playerCount: lobby.players.length }, '[GameService.startGame] Assigning roles');
    const assignments = assignRoles(lobby.players.map((player) => player.id), this.config.roleDistributions);
    const deadline = new Date(Date.now() + this.config.roleConfirmationDurationSeconds * 1000);
    const game = await this.gameRepository.startRoleConfirmation({
      gameId,
      currentVersion: lobby.game.stateVersion,
      assignments,
      deadline,
    });

    if (game === null) {
      throw new GameStartError('Лобби уже изменилось. Обновите статус и попробуйте снова.');
    }

    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    this.logger.info(
      { gameId: game.id, playerCount: alivePlayers.length, phase: game.phase, deadline },
      '[GameService.startGame] Game moved to role confirmation',
    );
    return game;
  }

  public async recordControlMessage(gameId: string, messageId: number): Promise<void> {
    await this.gameRepository.setControlMessageId(gameId, messageId);
    this.logger.debug({ gameId, messageId }, '[GameService.recordControlMessage] Stored game control message');
  }
}
