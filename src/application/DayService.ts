import type { Game } from '@prisma/client';

import { renderVoteView } from '../bot/views/voteView.js';
import { toPublicVoteDetails } from '../domain/game/voteDetails.js';
import type { AppLogger } from '../observability/logger.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { VoteRepository } from '../infrastructure/repositories/VoteRepository.js';

export class DayService {
  public constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly voteRepository: VoteRepository,
    private readonly logger: AppLogger,
  ) {}

  public async renderVote(game: Game): Promise<ReturnType<typeof renderVoteView>> {
    const [players, votes] = await Promise.all([
      this.playerRepository.listAlivePlayers(game.id),
      this.voteRepository.listVotes(game.id, game.stateVersion),
    ]);
    const votesCast = votes.length;
    const votersTotal = players.length;
    this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, votesCast, votersTotal }, '[DayService.renderVote] Rendering group vote');
    return renderVoteView({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      candidates: players.map((player) => ({ id: player.id, displayName: player.displayName })),
      votesCast,
      votersTotal,
      voteDetails: toPublicVoteDetails(votes, players),
    });
  }
}
