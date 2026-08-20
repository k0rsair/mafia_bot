import type { Game } from '@prisma/client';

import type { AppLogger } from '../observability/logger.js';
import type { GameRepository } from '../infrastructure/repositories/GameRepository.js';

export class RecoveryService {
  public constructor(
    private readonly gameRepository: GameRepository,
    private readonly logger: AppLogger,
  ) {}

  public async recoverActiveGames(): Promise<Game[]> {
    const games = await this.gameRepository.listRecoverableGames();
    this.logger.info({ gameCount: games.length }, '[RecoveryService.recoverActiveGames] Loaded active games after restart');
    return games;
  }
}
