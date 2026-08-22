import type { Player } from '@prisma/client';

import { resolveNight, type NightResolution } from '../domain/game/nightResolution.js';
import { isMafiaFaction } from '../domain/game/rules.js';
import type { Role } from '../domain/game/types.js';
import type { AppLogger } from '../observability/logger.js';
import type { NightActionRepository } from '../infrastructure/repositories/NightActionRepository.js';
import type { DayEffectRepository } from '../infrastructure/repositories/DayEffectRepository.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';

export type AppliedNightResolution = Readonly<{
  resolution: NightResolution;
  eliminatedPlayers: readonly Player[];
  savedPlayers: readonly Player[];
  eliminatedPlayer: Player | null;
  savedPlayer: Player | null;
  eliminatedManiacPlayer: Player | null;
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
    private readonly dayEffectRepository?: DayEffectRepository,
  ) {}

  public async resolve(gameId: string, phaseVersion: number): Promise<AppliedNightResolution> {
    this.logger.debug({ gameId, phaseVersion }, '[NightResolutionService.resolve] Resolving night');
    const [actions, prostituteActions, alivePlayers] = await Promise.all([
      this.nightActionRepository.listActions(gameId, phaseVersion),
      this.nightActionRepository.listActions(gameId, phaseVersion - 1),
      this.playerRepository.listAlivePlayers(gameId),
    ]);
    const resolvedActions = [
      ...prostituteActions.filter((action) => action.actionType === 'PROSTITUTE_VISIT'),
      ...actions.filter((action) => action.actionType !== 'MAFIA_KILL' || action.confirmedAt !== null),
    ];
    const resolution = resolveNight({
      actions: resolvedActions,
      players: alivePlayers.map((player) => ({ id: player.id, role: player.role as Role | null })),
    });
    const playersById = new Map(alivePlayers.map((player) => [player.id, player]));
    const eliminatedPlayers = resolution.eliminatedPlayerIds.flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player === undefined ? [] : [player];
    });
    const savedPlayers = resolution.savedPlayerIds.flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player === undefined ? [] : [player];
    });
    const eliminatedPlayerCount = await this.playerRepository.eliminatePlayers(gameId, eliminatedPlayers.map((player) => player.id));
    const eliminatedManiacPlayer = eliminatedPlayers.find((player) => player.role === 'MANIAC') ?? null;
    const visitedPlayerId = prostituteActions.find((action) => action.actionType === 'PROSTITUTE_VISIT')?.targetPlayerId ?? null;
    const alibiCreated = visitedPlayerId !== null
      && !resolution.eliminatedPlayerIds.includes(visitedPlayerId)
      && this.dayEffectRepository !== undefined
      ? await this.dayEffectRepository.createProstituteAlibi({ gameId, playerId: visitedPlayerId, phaseVersion })
      : false;

    this.logger.info(
      {
        gameId,
        phaseVersion,
        actionCount: resolvedActions.length,
        affectedPlayerCount: resolution.attackedPlayerIds.length,
        eliminatedPlayerCount,
        savedPlayerCount: savedPlayers.length,
        alibiCreatedCount: alibiCreated ? 1 : 0,
      },
      '[NightResolutionService.resolve] Night resolved',
    );
    return {
      resolution,
      eliminatedPlayers,
      savedPlayers,
      eliminatedPlayer: eliminatedPlayers[0] ?? null,
      savedPlayer: savedPlayers[0] ?? null,
      eliminatedManiacPlayer,
    };
  }

  public async getActionProgress(gameId: string, phaseVersion: number): Promise<NightActionProgress> {
    const [alivePlayers, actions, prostituteActions] = await Promise.all([
      this.playerRepository.listAlivePlayers(gameId),
      this.nightActionRepository.listActions(gameId, phaseVersion),
      this.nightActionRepository.listActions(gameId, phaseVersion - 1),
    ]);
    const blockedPlayerIds = new Set(prostituteActions.flatMap((action) => action.actionType === 'PROSTITUTE_VISIT' && action.targetPlayerId !== null ? [action.targetPlayerId] : []));
    const actionPlayers = alivePlayers.filter((player) => player.role !== null && player.role !== 'CIVILIAN' && player.role !== 'PROSTITUTE');
    const progress = {
      actionPlayersTotal: actionPlayers.length,
      actionPlayersCompleted: actionPlayers.filter((player) => isActionPlayerComplete(player, actions, blockedPlayerIds)).length,
      allActionsCompleted: actionPlayers.every((player) => isActionPlayerComplete(player, actions, blockedPlayerIds)),
    };

    this.logger.info(
      { gameId, phaseVersion, ...progress },
      '[FIX:early-night-completion] Checked night action progress',
    );
    return progress;
  }
}

function isActionPlayerComplete(
  player: Player,
  actions: Awaited<ReturnType<NightActionRepository['listActions']>>,
  blockedPlayerIds: ReadonlySet<string>,
): boolean {
  if (player.role === null) {
    return false;
  }
  const playerActions = actions.filter((action) => action.actorPlayerId === player.id);
  const hasAction = (actionType: 'COMMISSIONER_CHECK' | 'DOCTOR_SAVE' | 'DON_CHECK' | 'MANIAC_KILL' | 'MANIAC_SKIP'): boolean =>
    playerActions.some((action) => action.actionType === actionType);
  const hasConfirmedCouncilAction = playerActions.some((action) => action.actionType === 'MAFIA_KILL' && action.confirmedAt !== null);
  const isBlocked = blockedPlayerIds.has(player.id);

  if (isMafiaFaction(player.role as Role)) {
    return hasConfirmedCouncilAction && (player.role !== 'DON' || isBlocked || hasAction('DON_CHECK'));
  }
  if (player.role === 'COMMISSIONER') {
    return isBlocked || hasAction('COMMISSIONER_CHECK');
  }
  if (player.role === 'DOCTOR') {
    return isBlocked || hasAction('DOCTOR_SAVE');
  }
  if (player.role === 'MANIAC') {
    return isBlocked || hasAction('MANIAC_KILL') || hasAction('MANIAC_SKIP');
  }
  return false;
}
