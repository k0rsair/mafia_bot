import type { Game, Player } from '@prisma/client';

import { getWinningFaction } from '../domain/game/winConditions.js';
import type { WinningFaction } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';

export type FinalizedGame = Readonly<{
  game: Game;
  winningFaction: WinningFaction;
  players: Player[];
}>;

export class GameFinalizationService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly logger: AppLogger,
  ) {}

  public async finalizeIfWinner(game: Game): Promise<FinalizedGame | null> {
    const alivePlayers = await this.playerRepository.listAlivePlayers(game.id);
    const eligiblePlayers = alivePlayers.flatMap((player) => player.role === null ? [] : [{ id: player.id, role: player.role }]);
    if (eligiblePlayers.length !== alivePlayers.length) {
      this.logger.error({ gameId: game.id }, '[GameFinalizationService.finalizeIfWinner] Alive player has no role');
      return null;
    }

    const winningFaction = getWinningFaction(eligiblePlayers);
    if (winningFaction === null) {
      return null;
    }

    const closedGame = await this.gameRepository.closeGame(game.id, game.stateVersion, 'FINISHED');
    if (closedGame === null) {
      return null;
    }

    const players = await this.playerRepository.listPlayers(game.id);
    this.logger.info({ gameId: closedGame.id, winningFaction, playerCount: players.length }, '[GameFinalizationService.finalizeIfWinner] Game finished');
    return { game: closedGame, winningFaction, players };
  }

  public async cancelGame(game: Game): Promise<Game | null> {
    const cancelledGame = await this.gameRepository.closeGame(game.id, game.stateVersion, 'CANCELLED');
    if (cancelledGame !== null) {
      this.logger.info({ gameId: cancelledGame.id }, '[GameFinalizationService.cancelGame] Game cancelled');
    }
    return cancelledGame;
  }
}
