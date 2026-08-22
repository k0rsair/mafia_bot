import type { Game, Player } from '@prisma/client';

import { canActionChooseTarget } from '../domain/game/rules.js';
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
  { userId: `${TEST_PLAYER_PREFIX}5`, displayName: '🤖 Тестовый игрок 5' },
  { userId: `${TEST_PLAYER_PREFIX}6`, displayName: '🤖 Тестовый игрок 6' },
  { userId: `${TEST_PLAYER_PREFIX}7`, displayName: '🤖 Тестовый игрок 7' },
  { userId: `${TEST_PLAYER_PREFIX}8`, displayName: '🤖 Тестовый игрок 8' },
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
      const previousTargetId = actionType === 'DOCTOR_SAVE'
        ? await this.nightActionRepository.getLatestTarget({ gameId: game.id, actorPlayerId: actor.id, actionType })
        : null;
      const target = selectNightTarget(actor, alivePlayers, actionType, previousTargetId);
      if (target === undefined) {
        if (actionType === 'MANIAC_KILL') {
          await this.nightActionRepository.createSingleUseAction({
            gameId: game.id,
            phaseVersion: game.stateVersion,
            actionType: 'MANIAC_SKIP',
            actorPlayerId: actor.id,
            targetPlayerId: null,
          });
          actionCount += 1;
          this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, actionCount }, '[FIX:terminal-virtual-night] Virtual night action skipped without an eligible target');
          continue;
        }
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
        if (actor.role === 'DON') {
          const checkTarget = selectNightTarget(actor, alivePlayers, 'DON_CHECK');
          if (checkTarget !== undefined) {
            await this.nightActionRepository.createSingleUseAction({
              gameId: game.id,
              phaseVersion: game.stateVersion,
              actionType: 'DON_CHECK',
              actorPlayerId: actor.id,
              targetPlayerId: checkTarget.id,
            });
            actionCount += 1;
          }
        }
      } else if (actionType === 'DOCTOR_SAVE') {
        await this.nightActionRepository.createRestrictedSingleUseAction({
          gameId: game.id,
          phaseVersion: game.stateVersion,
          actionType,
          actorPlayerId: actor.id,
          targetPlayerId: target.id,
          rejectRepeatedTarget: true,
          rejectRepeatedSelfSave: true,
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

  public async playVirtualProstituteAction(game: Game): Promise<Game | null> {
    if (game.phase !== 'NIGHT_PROSTITUTE') {
      return null;
    }
    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const prostitute = alivePlayers.find((player) => player.role === 'PROSTITUTE' && isVirtualTestPlayer(player.userId));
    if (prostitute === undefined) {
      return null;
    }
    const previousTargetId = await this.nightActionRepository.getLatestTarget({ gameId: game.id, actorPlayerId: prostitute.id, actionType: 'PROSTITUTE_VISIT' });
    const target = selectNightTarget(prostitute, alivePlayers, 'PROSTITUTE_VISIT', previousTargetId);
    if (target === undefined) {
      this.logger.warn({ gameId: game.id, phaseVersion: game.stateVersion }, '[FIX:virtual-prostitute] No valid virtual prostitute target; completing the stage without a visit');
      return this.phaseService.completeProstituteNight(game.id, game.stateVersion);
    }
    const created = await this.nightActionRepository.createRestrictedSingleUseAction({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      actionType: 'PROSTITUTE_VISIT',
      actorPlayerId: prostitute.id,
      targetPlayerId: target.id,
      rejectRepeatedTarget: true,
      rejectRepeatedSelfSave: false,
    });
    if (created.action === null && created.rejection !== 'DUPLICATE') {
      this.logger.warn({ gameId: game.id, phaseVersion: game.stateVersion, rejection: created.rejection }, '[FIX:virtual-prostitute] Virtual prostitute action rejected; completing the stage without a new visit');
      return this.phaseService.completeProstituteNight(game.id, game.stateVersion);
    }
    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, actionCount: created.action === null ? 0 : 1, alreadyRecorded: created.rejection === 'DUPLICATE' },
      '[FIX:virtual-prostitute] Submitted virtual prostitute action',
    );
    return this.phaseService.completeProstituteNight(game.id, game.stateVersion);
  }

  public async castVirtualVotes(game: Game): Promise<VoteProgress | null> {
    if (!['DAY_NOMINATION', 'DAY_VOTE', 'DAY_REVOTE', 'DAY_FINAL_DECISION'].includes(game.phase)) {
      this.logger.debug({ gameId: game.id, phase: game.phase }, '[TestGameService.castVirtualVotes] Skipped outside city vote');
      return null;
    }

    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const virtualPlayers = alivePlayers.filter((player) => isVirtualTestPlayer(player.userId));
    const options = await this.votingService.getVoteRoundOptions(game.id, game.stateVersion);
    let progress: VoteProgress | null = null;
    for (const voter of virtualPlayers) {
      const target = selectVoteTarget(voter, alivePlayers, options.candidatePlayerIds);
      progress = await this.votingService.castVote({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        chatId: game.chatId,
        userId: voter.userId,
        targetIndex: target === undefined ? null : (options.kind === null ? alivePlayers.indexOf(target) : options.candidatePlayerIds.indexOf(target.id)),
        action: options.kind === 'FINAL_DECISION' ? 'all-stay' : 'candidate',
      });
      progress = await this.votingService.confirmVote({
        gameId: game.id,
        phaseVersion: game.stateVersion,
        chatId: game.chatId,
        userId: voter.userId,
      });
    }

    this.logger.info(
      { gameId: game.id, phaseVersion: game.stateVersion, virtualPlayerCount: virtualPlayers.length, votesCast: progress?.votesCast ?? 0 },
      '[TestGameService.castVirtualVotes] Submitted and confirmed virtual votes',
    );
    return progress;
  }
}

function toNightActionType(role: Role | null): NightActionType | null {
  if (role === 'MAFIA' || role === 'DON') {
    return 'MAFIA_KILL';
  }
  if (role === 'DOCTOR') {
    return 'DOCTOR_SAVE';
  }
  if (role === 'COMMISSIONER') {
    return 'COMMISSIONER_CHECK';
  }
  if (role === 'MANIAC') {
    return 'MANIAC_KILL';
  }
  return null;
}

function selectNightTarget(actor: Player, alivePlayers: readonly Player[], actionType: NightActionType, previousTargetId: string | null = null): Player | undefined {
  const actorRole = actor.role;
  if (actorRole === null) {
    return undefined;
  }
  const candidates = alivePlayers.filter((candidate) =>
    candidate.id !== previousTargetId && candidate.role !== null && canActionChooseTarget({ actorRole, actionType, targetRole: candidate.role, isSelfTarget: candidate.id === actor.id }),
  );
  return candidates.find((candidate) => isVirtualTestPlayer(candidate.userId)) ?? candidates[0];
}

function selectVoteTarget(voter: Player, alivePlayers: readonly Player[], candidatePlayerIds: readonly string[]): Player | undefined {
  const candidates = candidatePlayerIds.length === 0
    ? alivePlayers
    : candidatePlayerIds.flatMap((candidatePlayerId) => alivePlayers.filter((player) => player.id === candidatePlayerId));
  return candidates.find((candidate) => candidate.id !== voter.id && isVirtualTestPlayer(candidate.userId))
    ?? candidates.find((candidate) => candidate.id !== voter.id)
    ?? candidates[0];
}
