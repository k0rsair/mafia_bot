import type { Player } from '@prisma/client';

import { resolveNight, type NightResolution } from '../domain/game/nightResolution.js';
import type { AppLogger } from '../observability/logger.js';
import type { NightActionRepository } from '../infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';

export type AppliedNightResolution = Readonly<{
  resolution: NightResolution;
  eliminatedPlayer: Player | null;
}>;

export class NightResolutionService {
  public constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly nightActionRepository: NightActionRepository,
    private readonly logger: AppLogger,
  ) {}

  public async resolve(gameId: string, phaseVersion: number): Promise<AppliedNightResolution> {
    this.logger.debug({ gameId, phaseVersion }, '[NightResolutionService.resolve] Resolving night');
    const actions = await this.nightActionRepository.listActions(gameId, phaseVersion);
    const resolution = resolveNight(actions);
    const eliminatedPlayer = resolution.eliminatedPlayerId === null
      ? null
      : (await this.playerRepository.listAlivePlayers(gameId)).find((player) => player.id === resolution.eliminatedPlayerId) ?? null;

    if (eliminatedPlayer !== null) {
      await this.playerRepository.eliminatePlayer(gameId, eliminatedPlayer.id);
    }

    this.logger.info(
      { gameId, phaseVersion, actionCount: actions.length, wasEliminationApplied: eliminatedPlayer !== null },
      '[NightResolutionService.resolve] Night resolved',
    );
    return { resolution, eliminatedPlayer };
  }
}
