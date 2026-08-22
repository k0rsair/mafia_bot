import type { Game, Player } from '@prisma/client';

import { DEFAULT_ROLE_DISTRIBUTIONS, getDistributionBounds, validateLobbySize } from '../domain/game/rules.js';
import { GameRuleError, type RoleDistributions } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository, UnconfirmedRolePlayer } from '../infrastructure/repositories/PlayerRepository.js';

type LobbyUser = Readonly<{
  userId: string;
  displayName: string;
  username?: string;
}>;

type CreateLobbyInput = LobbyUser & Readonly<{
  chatId: string;
  chatTitle?: string;
  lobbyMessageId: number;
}>;

export type LobbySnapshot = Readonly<{
  game: Game;
  players: Player[];
}>;

export class LobbyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LobbyError';
  }
}

type LobbyLimits = number | Readonly<{
  lobbyMaxPlayers?: number;
  minPlayers?: number;
  maxPlayers?: number;
  roleDistributions?: RoleDistributions;
}>;

export class LobbyService {
  private readonly maxPlayers: number;
  private readonly minPlayers: number;
  private readonly tableMaxPlayers: number;
  private readonly roleDistributions: RoleDistributions;

  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly logger: AppLogger,
    limits: LobbyLimits = {},
  ) {
    const resolved = typeof limits === 'number' ? { lobbyMaxPlayers: limits } : limits;
    this.roleDistributions = resolved.roleDistributions ?? DEFAULT_ROLE_DISTRIBUTIONS;
    const bounds = getDistributionBounds(this.roleDistributions);
    this.minPlayers = resolved.minPlayers ?? bounds.minPlayers;
    this.tableMaxPlayers = resolved.maxPlayers ?? bounds.maxPlayers;
    this.maxPlayers = resolved.lobbyMaxPlayers ?? this.tableMaxPlayers;
  }

  public async createLobby(input: CreateLobbyInput): Promise<LobbySnapshot> {
    this.logger.debug({ chatId: input.chatId, creatorId: input.userId }, '[LobbyService.createLobby] Creating lobby');
    const activeGame = await this.gameRepository.findActiveByChatId(input.chatId);
    if (activeGame !== null) {
      throw new LobbyError('В этом чате уже есть активная игра. Используйте /mafia_status.');
    }

    const game = await this.gameRepository.createLobby({
      chatId: input.chatId,
      creatorId: input.userId,
      lobbyMessageId: input.lobbyMessageId,
      ...(input.chatTitle === undefined ? {} : { chatTitle: input.chatTitle }),
    });
    const creator = await this.playerRepository.joinLobby({
      gameId: game.id,
      userId: input.userId,
      displayName: input.displayName,
      ...(input.username === undefined ? {} : { username: input.username }),
    });

    this.logger.info({ gameId: game.id, chatId: game.chatId }, '[LobbyService.createLobby] Lobby created with owner');
    return { game, players: [creator] };
  }

  public async joinLobby(gameId: string, user: LobbyUser): Promise<LobbySnapshot> {
    const snapshot = await this.getLobby(gameId);
    const alreadyJoined = snapshot.players.some((player) => player.userId === user.userId);

    if (!alreadyJoined && snapshot.players.length >= this.maxPlayers) {
      throw new LobbyError(`В лобби максимум ${this.maxPlayers} игроков.`);
    }

    await this.playerRepository.joinLobby({ gameId, ...user });
    const players = await this.playerRepository.listLobbyPlayers(gameId);

    this.logger.info({ gameId, playerCount: players.length }, '[LobbyService.joinLobby] Lobby membership updated');
    return { game: snapshot.game, players };
  }

  public async leaveLobby(gameId: string, userId: string): Promise<LobbySnapshot> {
    const snapshot = await this.getLobby(gameId);
    await this.playerRepository.leaveLobby(gameId, userId);
    const players = await this.playerRepository.listLobbyPlayers(gameId);

    this.logger.info({ gameId, playerCount: players.length }, '[LobbyService.leaveLobby] Lobby membership updated');
    return { game: snapshot.game, players };
  }

  public async getLobby(gameId: string): Promise<LobbySnapshot> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'LOBBY') {
      throw new LobbyError('Это лобби уже закрыто или устарело.');
    }

    const players = await this.playerRepository.listLobbyPlayers(gameId);
    return { game, players };
  }

  public async getActiveLobby(chatId: string): Promise<LobbySnapshot | null> {
    const game = await this.gameRepository.findActiveByChatId(chatId);
    if (game === null || game.phase !== 'LOBBY') {
      return null;
    }

    const players = await this.playerRepository.listLobbyPlayers(game.id);
    return { game, players };
  }

  public async getActiveGame(chatId: string): Promise<Game | null> {
    return this.gameRepository.findActiveByChatId(chatId);
  }

  public async recordLobbyMessage(gameId: string, messageId: number): Promise<void> {
    await this.gameRepository.setLobbyMessageId(gameId, messageId);
    this.logger.debug({ gameId, messageId }, '[LobbyService.recordLobbyMessage] Stored lobby control message');
  }

  public async listUnconfirmedRolePlayers(gameId: string): Promise<UnconfirmedRolePlayer[]> {
    this.logger.debug({ gameId }, '[LobbyService.listUnconfirmedRolePlayers] Checking role confirmation phase');
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'ROLE_CONFIRMATION') {
      this.logger.warn({ gameId, phase: game?.phase }, '[LobbyService.listUnconfirmedRolePlayers] Rejected request outside role confirmation');
      throw new LobbyError('Сейчас нет фазы подтверждения ролей.');
    }

    const players = await this.playerRepository.listUnconfirmedRolePlayers(gameId);
    this.logger.info({ gameId, pendingCount: players.length }, '[LobbyService.listUnconfirmedRolePlayers] Loaded pending role confirmations');
    return players;
  }

  public async validateStart(gameId: string): Promise<LobbySnapshot> {
    const snapshot = await this.getLobby(gameId);
    try {
      validateLobbySize(snapshot.players.length, this.roleDistributions);
    } catch (error) {
      this.logger.warn(
        { gameId, playerCount: snapshot.players.length, minPlayers: this.minPlayers, maxPlayers: this.tableMaxPlayers },
        '[LobbyService.validateStart] Rejected start outside supported lobby size',
      );
      const message = error instanceof GameRuleError ? error.message : 'Не удалось проверить состав лобби.';
      throw new LobbyError(message);
    }

    this.logger.info({ gameId, playerCount: snapshot.players.length }, '[FIX:lobby-min-players] Lobby is ready to start');
    return snapshot;
  }
}
