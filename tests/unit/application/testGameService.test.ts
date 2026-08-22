import type { Game, Player } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { TestGameService, isVirtualTestPlayer } from '../../../src/application/TestGameService.js';
import type { GameService } from '../../../src/application/GameService.js';
import type { LobbyService } from '../../../src/application/LobbyService.js';
import type { PhaseService } from '../../../src/application/PhaseService.js';
import type { VoteProgress, VotingService } from '../../../src/application/VotingService.js';
import type { NightActionRepository } from '../../../src/infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('TestGameService', () => {
  const game = { id: 'game-1', chatId: '-1001', phase: 'ROLE_CONFIRMATION', stateVersion: 7 } as Game;
  const humanPlayer = { id: 'human-1', userId: '101', displayName: 'Организатор', role: 'CIVILIAN', status: 'ALIVE' } as Player;
  const virtualPlayers = Array.from({ length: 8 }, (_, index) => index + 1).map((number) => ({
    id: `virtual-${number}`,
    userId: `test-player:${number}`,
    displayName: `🤖 Тестовый игрок ${number}`,
    role: number === 1 ? 'MAFIA' : number === 2 ? 'DON' : number === 3 ? 'COMMISSIONER' : number === 4 ? 'MANIAC' : 'CIVILIAN',
    status: 'ALIVE',
  } as Player));

  it('creates eight virtual players for a nine-player city game and confirms only their roles', async () => {
    const createLobby = vi.fn().mockResolvedValue({ game });
    const joinLobby = vi.fn().mockResolvedValue({ game });
    const startGame = vi.fn().mockResolvedValue(game);
    const confirmRole = vi.fn().mockResolvedValue(true);
    const service = new TestGameService(
      { createLobby, joinLobby } as unknown as LobbyService,
      { startGame } as unknown as GameService,
      { listAlivePlayers: vi.fn().mockResolvedValue([humanPlayer, ...virtualPlayers]), confirmRole } as unknown as PlayerRepository,
      {} as NightActionRepository,
      {} as VotingService,
      {} as PhaseService,
      createLogger({ logLevel: 'silent' }),
    );

    await expect(service.createTestGame({
      chatId: game.chatId,
      creatorId: humanPlayer.userId,
      creatorDisplayName: humanPlayer.displayName,
      lobbyMessageId: 42,
    })).resolves.toEqual(game);

    expect(joinLobby).toHaveBeenCalledTimes(8);
    expect(confirmRole).toHaveBeenCalledTimes(8);
    expect(confirmRole).not.toHaveBeenCalledWith(game.id, humanPlayer.userId);
  });

  it('submits virtual night actions through the same action repositories', async () => {
    const nightGame = { ...game, phase: 'NIGHT' } as Game;
    const upsertMafiaDraft = vi.fn().mockResolvedValue({});
    const confirmMafiaDraft = vi.fn().mockResolvedValue(true);
    const createSingleUseAction = vi.fn().mockResolvedValue({});
    const completeNightIfAllActionsCompleted = vi.fn().mockResolvedValue(null);
    const service = new TestGameService(
      {} as LobbyService,
      {} as GameService,
      { listAlivePlayers: vi.fn().mockResolvedValue([humanPlayer, ...virtualPlayers]) } as unknown as PlayerRepository,
      { upsertMafiaDraft, confirmMafiaDraft, createSingleUseAction, getLatestTarget: vi.fn().mockResolvedValue(null) } as unknown as NightActionRepository,
      {} as VotingService,
      { completeNightIfAllActionsCompleted } as unknown as PhaseService,
      createLogger({ logLevel: 'silent' }),
    );

    await service.playVirtualNightActions(nightGame);

    expect(upsertMafiaDraft).toHaveBeenCalledWith(expect.objectContaining({
      gameId: nightGame.id,
      phaseVersion: nightGame.stateVersion,
      actorPlayerId: 'virtual-1',
    }));
    expect(confirmMafiaDraft).toHaveBeenCalledWith(expect.objectContaining({ actorPlayerId: 'virtual-1' }));
    expect(createSingleUseAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'DON_CHECK',
      actorPlayerId: 'virtual-2',
    }));
    expect(createSingleUseAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'COMMISSIONER_CHECK',
      actorPlayerId: 'virtual-3',
    }));
    expect(completeNightIfAllActionsCompleted).toHaveBeenCalledWith(nightGame.id, nightGame.stateVersion);
  });

  it('casts a vote for every living virtual player while leaving the organiser manual', async () => {
    const voteGame = { ...game, phase: 'DAY_VOTE' } as Game;
    const castVote = vi.fn().mockResolvedValue({ game: voteGame, votesCast: 8, votersTotal: 9, allVoted: false } satisfies VoteProgress);
    const service = new TestGameService(
      {} as LobbyService,
      {} as GameService,
      { listAlivePlayers: vi.fn().mockResolvedValue([humanPlayer, ...virtualPlayers]) } as unknown as PlayerRepository,
      {} as NightActionRepository,
      { castVote, getVoteRoundOptions: vi.fn().mockResolvedValue({ kind: 'PRIMARY', candidatePlayerIds: [humanPlayer.id, ...virtualPlayers.map((player) => player.id)] }) } as unknown as VotingService,
      {} as PhaseService,
      createLogger({ logLevel: 'silent' }),
    );

    const progress = await service.castVirtualVotes(voteGame);

    expect(castVote).toHaveBeenCalledTimes(8);
    expect(castVote).not.toHaveBeenCalledWith(expect.objectContaining({ userId: humanPlayer.userId }));
    expect(progress).toMatchObject({ votesCast: 8, votersTotal: 9, allVoted: false });
  });

  it('recognises only its own virtual player IDs', () => {
    expect(isVirtualTestPlayer('test-player:1')).toBe(true);
    expect(isVirtualTestPlayer('101')).toBe(false);
  });
});
