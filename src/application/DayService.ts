import type { Game } from '@prisma/client';

import { renderVoteView } from '../bot/views/voteView.js';
import type { AppLogger } from '../observability/logger.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import type { VoteProgress } from './VotingService.js';

export class DayService {
  public constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly logger: AppLogger,
  ) {}

  public async renderVote(game: Game, progress?: Pick<VoteProgress, 'votesCast' | 'votersTotal'>): Promise<ReturnType<typeof renderVoteView>> {
    const players = await this.playerRepository.listAlivePlayers(game.id);
    const votesCast = progress?.votesCast ?? 0;
    const votersTotal = progress?.votersTotal ?? players.length;
    this.logger.debug({ gameId: game.id, phaseVersion: game.stateVersion, votesCast, votersTotal }, '[DayService.renderVote] Rendering group vote');
    return renderVoteView({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      candidates: players.map((player) => ({ id: player.id, displayName: player.displayName })),
      votesCast,
      votersTotal,
    });
  }
}
