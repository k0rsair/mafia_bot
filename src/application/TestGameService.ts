import type { Game, Player } from '@prisma/client';

import { canRoleChooseTarget } from '../domain/game/rules.js';
import type { NightActionType, Role } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { NightActionRepository } from '../infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { GameService } from './GameService.js';
import type { LobbyService } from './LobbyService.js';
import type { PhaseDeadlineResult, PhaseService } from './PhaseService.js';
import type { VoteProgress, VotingService } from './VotingService.js';

const TEST_PLAYER_PREFIX = 'test-player:';

const VIRTUAL_TEST_PLAYERS = [
  { userId: `${TEST_PLAYER_PREFIX}1`, displayName: '🤖 Тестовый игрок 1' },
  { userId: `${TEST_PLAYER_PREFIX}2`, displayName: '🤖 Тестовый игрок 2' },
  { userId: `${TEST_PLAYER_PREFIX}3`, displayName: '🤖 Тестовый игрок 3' },
  { userId: `${TEST_PLAYER_PREFIX}4`, displayName: '🤖 Тестовый игрок 4' },
] as const;

export function isVirtualTestPlayer(userId: string): boolean {
  return userId.startsWith(TEST_PLAYER_PREFIX);
}

export class TestGameService {
  public constructor(
    private readonly lobbyService: LobbyService,
    private readonly gameService: GameService,
    private readonly playerRepository: PlayerRepository,
    private readonly nightActionRepository: NightActionRepository,
    private readonly votingService: VotingService,
    private readonly phaseService: PhaseService,
    private readonly logger: AppLogger,
  ) {}

  public async createTestGame(input: Readonly<{
    chatId: string;
    creatorId: string;
    creatorDisplayName: string;
    creatorUsername?: string;
    chatTitle?: string;
    lobbyMessageId: number;
  }>): Promise<Game> {
    this.logger.debug({ chatId: input.chatId, creatorId: input.creatorId }, '[TestGameService.createTestGame] Creating test game');
    const lobby = await this.lobbyService.createLobby({
      chatId: input.chatId,
      userId: input.creatorId,
      displayName: input.creatorDisplayName,
      ...(input.creatorUsername === undefined ? {} : { username: input.creatorUsername }),
      ...(input.chatTitle === undefined ? {} : { chatTitle: input.chatTitle }),
      lobbyMessageId: input.lobbyMessageId,
    });

    for (const player of VIRTUAL_TEST_PLAYERS) {
      await this.lobbyService.joinLobby(lobby.game.id, player);
    }

    const game = await this.gameService.startGame(lobby.game.id);
    const players = await this.playerRepository.listAlivePlayers(game.id);
    const virtualPlayers = players.filter((player) => isVirtualTestPlayer(player.userId));
    let confirmedCount = 0;
    for (const player of virtualPlayers) {
      if (await this.playerRepository.confirmRole(game.id, player.userId)) {
        confirmedCount += 1;
      }
    }

    this.logger.info(
      { gameId: game.id, chatId: game.chatId, playerCount: players.length, virtualPlayerCount: virtualPlayers.length, confirmedCount },
      '[TestGameService.createTestGame] Test game created and virtual roles confirmed',
    );
    return game;
  }

  public async playVirtualNightActions(game: Game): Promise<Extract<PhaseDeadlineResult, { kind: 'NIGHT_RESOLVED' | 'GAME_FINISHED' }> | null> {
    if (game.phase !== 'NIGHT') {
      this.logger.debug({ gameId: game.id, phase: game.phase }, '[TestGameService.playVirtualNightActions] Skipped outside night');
      return null;
    }

    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const virtualPlayers = alivePlayers.filter((player) => isVirtualTestPlayer(player.userId));
    if (virtualPlayers.length === 0) {
      return null;
    }

    let actionCount = 0;
    for (const actor of virtualPlayers) {
      const actionType = toNightActionType(actor.role);
      if (actionType === null) {
        continue;
      }
      const target = selectNightTarget(actor, alivePlayers);
      if (target === undefined) {
        this.logger.warn({ gameId: game.id, phaseVersion: game.stateVersion }, '[TestGameService.playVirtualNightActions] No valid virtual night target');
        continue;
      }

      if (actionType === 'MAFIA_KILL') {
        await this.nightActionRepository.upsertMafiaDraft({
          gameId: game.id,
          phaseVersion: game.stateVersion,
          actorPlayerId: actor.id,
          targetPlayerId: target.id,
        });
        await this.nightActionRepository.confirmMafiaDraft({
          gameId: game.id,
          phaseVersion: game.stateVersion,
          actorPlayerId: actor.id,
        });
      } else {
        await this.nightActionRepository.createSingleUseAction({
          gameId: game.id,
          phaseVersion: game.stateVersion,
          actionType,
          actorPlayerId: actor.id,
          targetPlayerId: target.id,
        });
      }
      actionCount += 1;
    }

    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, virtualPlayerCount: virtualPlayers.length, actionCount },
      '[TestGameService.playVirtualNightActions] Submitted virtual night actions',
    );
    return this.phaseService.completeNightIfAllActionsCompleted(game.id, game.stateVersion);
  }

  public async castVirtualVotes(game: Game): Promise<VoteProgress | null> {
    if (game.phase !== 'DAY_VOTE') {
      this.logger.debug({ gameId: game.id, phase: game.phase }, '[TestGameService.castVirtualVotes] Skipped outside day vote');
      return null;
    }

    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const virtualPlayers = alivePlayers.filter((player) => isVirtualTestPlayer(player.userId));
    let progress: VoteProgress | null = null;
    for (const voter of virtualPlayers) {
      const target = selectVoteTarget(voter, alivePlayers);
      progress = await this.votingService.castVote({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        chatId: game.chatId,
        userId: voter.userId,
        targetIndex: target === undefined ? null : alivePlayers.indexOf(target),
      });
    }

    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, virtualPlayerCount: virtualPlayers.length, votesCast: progress?.votesCast ?? 0 },
      '[TestGameService.castVirtualVotes] Submitted virtual votes',
    );
    return progress;
  }
}

function toNightActionType(role: Role | null): NightActionType | null {
  if (role === 'MAFIA') {
    return 'MAFIA_KILL';
  }
  if (role === 'DOCTOR') {
    return 'DOCTOR_SAVE';
  }
  if (role === 'COMMISSIONER') {
    return 'COMMISSIONER_CHECK';
  }
  return null;
}

function selectNightTarget(actor: Player, alivePlayers: readonly Player[]): Player | undefined {
  const actorRole = actor.role;
  if (actorRole === null) {
    return undefined;
  }
  const candidates = alivePlayers.filter((candidate) =>
    candidate.role !== null && canRoleChooseTarget(actorRole, candidate.role, candidate.id === actor.id),
  );
  return candidates.find((candidate) => isVirtualTestPlayer(candidate.userId)) ?? candidates[0];
}

function selectVoteTarget(voter: Player, alivePlayers: readonly Player[]): Player | undefined {
  return alivePlayers.find((candidate) => candidate.id !== voter.id && isVirtualTestPlayer(candidate.userId))
    ?? alivePlayers.find((candidate) => candidate.id !== voter.id);
}
