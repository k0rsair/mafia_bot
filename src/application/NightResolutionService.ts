import type { Player } from '@prisma/client';

import { resolveNight, type NightResolution } from '../domain/game/nightResolution.js';
import type { AppLogger } from '../observability/logger.js';
import type { NightActionRepository } from '../infrastructure/repositories/NightActionRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';

export type AppliedNightResolution = Readonly<{
  resolution: NightResolution;
  eliminatedPlayer: Player | null;
}>;

export type NightActionProgress = Readonly<{
  actionPlayersTotal: number;
  actionPlayersCompleted: number;
  allActionsCompleted: boolean;
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
    const resolvedActions = actions.filter((action) => action.actionType !== 'MAFIA_KILL' || action.confirmedAt !== null);
    const resolution = resolveNight(resolvedActions);
    const eliminatedPlayer = resolution.eliminatedPlayerId === null
      ? null
      : (await this.playerRepository.listAlivePlayers(gameId)).find((player) => player.id === resolution.eliminatedPlayerId) ?? null;

    if (eliminatedPlayer !== null) {
      await this.playerRepository.eliminatePlayer(gameId, eliminatedPlayer.id);
    }

    this.logger.info(
      {
        gameId,
        phaseVersion,
        actionCount: actions.length,
        confirmedMafiaActionCount: resolvedActions.filter((action) => action.actionType === 'MAFIA_KILL').length,
        wasEliminationApplied: eliminatedPlayer !== null,
      },
      '[NightResolutionService.resolve] Night resolved',
    );
    return { resolution, eliminatedPlayer };
  }

  public async getActionProgress(gameId: string, phaseVersion: number): Promise<NightActionProgress> {
    const [alivePlayers, actions] = await Promise.all([
      this.playerRepository.listAlivePlayers(gameId),
      this.nightActionRepository.listActions(gameId, phaseVersion),
    ]);
    const alivePlayersById = new Map(alivePlayers.map((player) => [player.id, player]));
    const completedPlayerIds = new Set(actions.flatMap((action) => {
      const actor = alivePlayersById.get(action.actorPlayerId);
      return actor !== undefined && isCompletedActionForRole(actor, action) ? [actor.id] : [];
    }));
    const actionPlayers = alivePlayers.filter((player) => player.role !== null && player.role !== 'CIVILIAN');
    const progress = {
      actionPlayersTotal: actionPlayers.length,
      actionPlayersCompleted: actionPlayers.filter((player) => completedPlayerIds.has(player.id)).length,
      allActionsCompleted: actionPlayers.every((player) => completedPlayerIds.has(player.id)),
    };

    this.logger.info(
      { gameId, phaseVersion, ...progress },
      '[FIX:early-night-completion] Checked night action progress',
    );
    return progress;
  }
}

function isCompletedActionForRole(player: Player, action: Awaited<ReturnType<NightActionRepository['listActions']>>[number]): boolean {
  if (player.role === 'MAFIA') {
    return action.actionType === 'MAFIA_KILL' && action.confirmedAt !== null;
  }
  if (player.role === 'DOCTOR') {
    return action.actionType === 'DOCTOR_SAVE';
  }
  return player.role === 'COMMISSIONER' && action.actionType === 'COMMISSIONER_CHECK';
}
