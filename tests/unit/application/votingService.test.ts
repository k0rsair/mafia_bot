import type { Game, Player, VoteRound } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { VotingError, VotingService } from '../../../src/application/VotingService.js';
import type { DayEffectRepository } from '../../../src/infrastructure/repositories/DayEffectRepository.js';
import type { GameRepository } from '../../../src/infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../../../src/infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../../../src/infrastructure/repositories/VoteRepository.js';
import type { VoteRoundRepository } from '../../../src/infrastructure/repositories/VoteRoundRepository.js';
import { createLogger } from '../../../src/observability/logger.js';

const game = { id: 'game-1', chatId: '-1001', phase: 'DAY_VOTE', stateVersion: 7 } as Game;
const alice = { id: 'alice', userId: '101', displayName: 'Алиса', status: 'ALIVE' } as Player;
const boris = { id: 'boris', userId: '102', displayName: 'Борис', status: 'ALIVE' } as Player;
const vera = { id: 'vera', userId: '103', displayName: 'Вера', status: 'ALIVE' } as Player;

function createService(input: Readonly<{
  currentGame?: Game;
  round?: VoteRound | null;
  players?: readonly Player[];
  effects?: DayEffectRepository;
}> = {}): Readonly<{ service: VotingService; upsertVote: ReturnType<typeof vi.fn>; eliminatePlayers: ReturnType<typeof vi.fn> }> {
  const players = input.players ?? [alice, boris, vera];
  const upsertVote = vi.fn().mockResolvedValue({});
  const eliminatePlayers = vi.fn().mockResolvedValue(0);
  const service = new VotingService(
    { findById: vi.fn().mockResolvedValue(input.currentGame ?? game) } as unknown as GameRepository,
    {
      findByGameAndUserId: vi.fn().mockImplementation(async (_gameId, userId) => players.find((player) => player.userId === userId) ?? null),
      listAlivePlayers: vi.fn().mockResolvedValue(players),
      eliminatePlayers,
    } as unknown as PlayerRepository,
    {
      upsertVote,
      countVotesForRound: vi.fn().mockResolvedValue(1),
      countVotes: vi.fn().mockResolvedValue(1),
      countConfirmedVotesForRound: vi.fn().mockResolvedValue(0),
      countConfirmedVotes: vi.fn().mockResolvedValue(0),
    } as unknown as VoteRepository,
    createLogger({ logLevel: 'silent' }),
    undefined,
    { findOpenRound: vi.fn().mockResolvedValue(input.round ?? null) } as unknown as VoteRoundRepository,
    input.effects,
  );
  return { service, upsertVote, eliminatePlayers };
}

describe('VotingService city rounds', () => {
  it('counts only confirmed city choices and requires a saved draft before confirmation', async () => {
    const round = { id: 'round-1', kind: 'NOMINATION', candidatePlayerIds: [alice.id, boris.id, vera.id] } as VoteRound;
    const confirmVote = vi.fn().mockResolvedValue(true);
    const countConfirmedVotesForRound = vi.fn().mockResolvedValue(3);
    const service = new VotingService(
      { findById: vi.fn().mockResolvedValue({ ...game, phase: 'DAY_NOMINATION' }) } as unknown as GameRepository,
      {
        findByGameAndUserId: vi.fn().mockResolvedValue(alice),
        listAlivePlayers: vi.fn().mockResolvedValue([alice, boris, vera]),
      } as unknown as PlayerRepository,
      { confirmVote, countConfirmedVotesForRound } as unknown as VoteRepository,
      createLogger({ logLevel: 'silent' }),
      undefined,
      { findOpenRound: vi.fn().mockResolvedValue(round) } as unknown as VoteRoundRepository,
    );

    await expect(service.confirmVote({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      chatId: game.chatId,
      userId: alice.userId,
    })).resolves.toMatchObject({ votesCast: 3, votersTotal: 3, allVoted: true, roundKind: 'NOMINATION' });

    expect(confirmVote).toHaveBeenCalledWith({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      voterPlayerId: alice.id,
      voteRoundId: round.id,
    });
  });

  it('rejects confirmation when the player has not saved a draft', async () => {
    const round = { id: 'round-1', kind: 'PRIMARY', candidatePlayerIds: [boris.id, vera.id] } as VoteRound;
    const service = new VotingService(
      { findById: vi.fn().mockResolvedValue(game) } as unknown as GameRepository,
      {
        findByGameAndUserId: vi.fn().mockResolvedValue(alice),
        listAlivePlayers: vi.fn().mockResolvedValue([alice, boris, vera]),
      } as unknown as PlayerRepository,
      { confirmVote: vi.fn().mockResolvedValue(false) } as unknown as VoteRepository,
      createLogger({ logLevel: 'silent' }),
      undefined,
      { findOpenRound: vi.fn().mockResolvedValue(round) } as unknown as VoteRoundRepository,
    );

    await expect(service.confirmVote({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      chatId: game.chatId,
      userId: alice.userId,
    })).rejects.toThrow('Сначала выберите вариант');
  });

  it('resolves a candidate button against the persisted round order rather than the live player order', async () => {
    const round = { id: 'round-1', kind: 'PRIMARY', candidatePlayerIds: [vera.id, boris.id] } as VoteRound;
    const { service, upsertVote } = createService({ round });

    await service.castVote({ gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: alice.userId, targetIndex: 0, action: 'candidate' });

    expect(upsertVote).toHaveBeenCalledWith(expect.objectContaining({
      voteRoundId: round.id,
      voterPlayerId: alice.id,
      targetPlayerId: vera.id,
      isSkip: false,
    }));
  });

  it('does not permit a skip in nomination, primary, or revote rounds', async () => {
    const round = { id: 'round-1', kind: 'PRIMARY', candidatePlayerIds: [boris.id, vera.id] } as VoteRound;
    const { service, upsertVote } = createService({ round });

    await expect(service.castVote({ gameId: game.id, phaseVersion: game.stateVersion, chatId: game.chatId, userId: alice.userId, targetIndex: null })).rejects.toThrow(VotingError);

    expect(upsertVote).not.toHaveBeenCalled();
  });

  it('records the final binary city choice without exposing an arbitrary target mapping', async () => {
    const finalGame = { ...game, phase: 'DAY_FINAL_DECISION' } as Game;
    const round = { id: 'round-1', kind: 'FINAL_DECISION', candidatePlayerIds: [boris.id, vera.id] } as VoteRound;
    const { service, upsertVote } = createService({ currentGame: finalGame, round });

    await service.castVote({ gameId: finalGame.id, phaseVersion: finalGame.stateVersion, chatId: finalGame.chatId, userId: alice.userId, targetIndex: null, action: 'all-leave' });
    await service.castVote({ gameId: finalGame.id, phaseVersion: finalGame.stateVersion, chatId: finalGame.chatId, userId: alice.userId, targetIndex: null, action: 'all-stay' });

    expect(upsertVote).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetPlayerId: boris.id, isSkip: false }));
    expect(upsertVote).toHaveBeenNthCalledWith(2, expect.objectContaining({ targetPlayerId: null, isSkip: true }));
  });

  it('preserves an alibied candidate while applying the rest of a multi-player final execution', async () => {
    const consumeProstituteAlibi = vi.fn().mockResolvedValue(true);
    const clearUnconsumedProstituteAlibis = vi.fn().mockResolvedValue(0);
    const { service, eliminatePlayers } = createService({
      effects: {
        listActiveProstituteAlibiPlayerIds: vi.fn().mockResolvedValue([boris.id]),
        consumeProstituteAlibi,
        clearUnconsumedProstituteAlibis,
      } as unknown as DayEffectRepository,
    });

    const outcome = await service.applyDayOutcome(game.id, {
      round: { id: 'round-1', kind: 'FINAL_DECISION' } as VoteRound,
      resolution: { outcome: 'ELIMINATION', eliminatedPlayerId: boris.id, eliminatedPlayerIds: [boris.id, vera.id], tiedPlayerIds: [] },
      voteDetails: [],
    });

    expect(eliminatePlayers).toHaveBeenCalledWith(game.id, [vera.id]);
    expect(consumeProstituteAlibi).toHaveBeenCalledWith(game.id, boris.id);
    expect(clearUnconsumedProstituteAlibis).toHaveBeenCalledWith(game.id);
    expect(outcome).toMatchObject({
      eliminatedPlayers: [vera],
      alibiedPlayers: [boris],
      resolution: { eliminatedPlayerIds: [vera.id] },
    });
  });
});
