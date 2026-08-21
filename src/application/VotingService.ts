import type { Game, Player } from '@prisma/client';

import { toPublicVoteDetails, type PublicVoteDetail } from '../domain/game/voteDetails.js';
import { resolveVote, type VoteResolution } from '../domain/game/voteResolution.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../infrastructure/repositories/VoteRepository.js';
import { CallbackGuardService } from './CallbackGuardService.js';

export class VotingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'VotingError';
  }
}

export type VoteProgress = Readonly<{
  game: Game;
  votesCast: number;
  votersTotal: number;
  allVoted: boolean;
}>;

export type AppliedVoteResolution = Readonly<{
  resolution: VoteResolution;
  eliminatedPlayer: Player | null;
  voteDetails: readonly PublicVoteDetail[];
}>;

export class VotingService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly voteRepository: VoteRepository,
    private readonly logger: AppLogger,
    private readonly callbackGuard: CallbackGuardService = new CallbackGuardService(),
  ) {}

  public async castVote(input: Readonly<{ gameId: string; phaseVersion: number; chatId: string; userId: string; targetIndex: number | null }>): Promise<VoteProgress> {
    const { game, voter } = await this.getVotePlayer(input.gameId, input.phaseVersion, input.chatId, input.userId);
    const target = input.targetIndex === null ? null : (await this.playerRepository.listAlivePlayers(game.id))[input.targetIndex];
    if (input.targetIndex !== null && target === undefined) {
      throw new VotingError('Этого игрока уже нельзя выбрать. Откройте актуальное голосование.');
    }

    await this.voteRepository.upsertVote({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      voterPlayerId: voter.id,
      targetPlayerId: target?.id ?? null,
    });
    const [votesCast, alivePlayers] = await Promise.all([
      this.voteRepository.countVotes(game.id, game.stateVersion),
      this.playerRepository.listAlivePlayers(game.id),
    ]);

    this.logger.info({ gameId: game.id, phaseVersion: game.stateVersion, votesCast, votersTotal: alivePlayers.length }, '[VotingService.castVote] Vote progress updated');
    return { game, votesCast, votersTotal: alivePlayers.length, allVoted: votesCast === alivePlayers.length };
  }

  public async resolveVote(gameId: string, phaseVersion: number): Promise<AppliedVoteResolution> {
    this.logger.debug({ gameId, phaseVersion }, '[VotingService.resolveVote] Resolving day vote');
    const [votes, alivePlayers] = await Promise.all([
      this.voteRepository.listVotes(gameId, phaseVersion),
      this.playerRepository.listAlivePlayers(gameId),
    ]);
    const resolution = resolveVote(votes);
    const eliminatedPlayer = resolution.eliminatedPlayerId === null
      ? null
      : alivePlayers.find((player) => player.id === resolution.eliminatedPlayerId) ?? null;

    if (eliminatedPlayer !== null) {
      await this.playerRepository.eliminatePlayer(gameId, eliminatedPlayer.id);
    }

    this.logger.info({ gameId, phaseVersion, voteCount: votes.length, outcome: resolution.outcome }, '[VotingService.resolveVote] Vote resolved');
    return { resolution, eliminatedPlayer, voteDetails: toPublicVoteDetails(votes, alivePlayers) };
  }

  private async getVotePlayer(gameId: string, phaseVersion: number, chatId: string, userId: string): Promise<Readonly<{ game: Game; voter: Player }>> {
    const game = await this.gameRepository.findById(gameId);
    if (game === null || game.phase !== 'DAY_VOTE' || game.stateVersion !== phaseVersion) {
      throw new VotingError('Голосование уже завершено или устарело.');
    }
    try {
      this.callbackGuard.assertGameChat(game, chatId);
    } catch (error) {
      throw new VotingError(error instanceof Error ? error.message : 'Эта кнопка принадлежит другому игровому чату.');
    }

    const voter = await this.playerRepository.findByGameAndUserId(game.id, userId);
    if (voter === null || voter.status !== 'ALIVE') {
      throw new VotingError('Голосовать могут только живые игроки.');
    }

    return { game, voter };
  }
}
