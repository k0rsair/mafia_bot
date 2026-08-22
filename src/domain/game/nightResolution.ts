import { isMafiaFaction } from './rules.js';
import type { NightActionType, PublicNightOutcome, Role } from './types.js';

export type RecordedNightAction = Readonly<{
  actionType: NightActionType;
  actorPlayerId: string;
  targetPlayerId: string | null;
}>;

export type NightResolutionPlayer = Readonly<{
  id: string;
  role: Role | null;
}>;

export type NightResolution = PublicNightOutcome & Readonly<{
  mafiaTargetId: string | null;
  maniacTargetId: string | null;
  attackedPlayerIds: readonly string[];
  attackedPlayerId: string | null;
  savedPlayerId: string | null;
  eliminatedPlayerId: string | null;
}>;

export function resolveNight(
  input: Readonly<{ actions: readonly RecordedNightAction[]; players: readonly NightResolutionPlayer[] }> | readonly RecordedNightAction[],
): NightResolution {
  const actions = 'actions' in input ? input.actions : input;
  const players: readonly NightResolutionPlayer[] = 'players' in input ? input.players : [];
  const playersById = new Map(players.map((player) => [player.id, player]));
  const prostituteVisit = actions.find((action) => action.actionType === 'PROSTITUTE_VISIT' && action.targetPlayerId !== null) ?? null;
  const prostituteClientId = prostituteVisit?.targetPlayerId ?? null;
  const visitedMafiaMember = prostituteClientId !== null
    && isMafiaFactionRole(playersById.get(prostituteClientId)?.role ?? null);
  const mafiaTargetId = visitedMafiaMember
    ? null
    : resolveMafiaTarget(actions.filter((action) => action.actionType === 'MAFIA_KILL'));
  const maniacTargetId = actions.find((action) => action.actionType === 'MANIAC_KILL')?.targetPlayerId ?? null;
  const doctorTargetId = actions.find((action) => action.actionType === 'DOCTOR_SAVE')?.targetPlayerId ?? null;
  const prostituteId = prostituteVisit?.actorPlayerId ?? null;

  const mafiaDeaths = new Set<string>();
  const maniacDeaths = new Set<string>();
  const saved = new Set<string>();

  if (mafiaTargetId !== null) {
    if (doctorTargetId === mafiaTargetId) {
      saved.add(mafiaTargetId);
      if (mafiaTargetId === prostituteId && prostituteClientId !== null) {
        saved.add(prostituteClientId);
      }
    } else {
      mafiaDeaths.add(mafiaTargetId);
      if (mafiaTargetId === prostituteId && prostituteClientId !== null && doctorTargetId !== prostituteClientId) {
        mafiaDeaths.add(prostituteClientId);
      }
    }
  }

  if (maniacTargetId !== null) {
    maniacDeaths.add(maniacTargetId);
    if (maniacTargetId === prostituteId && prostituteClientId !== null) {
      maniacDeaths.add(prostituteClientId);
    }
  }

  const eliminatedPlayerIds = uniqueIds([...mafiaDeaths, ...maniacDeaths]);
  const savedPlayerIds = [...saved].filter((playerId) => !eliminatedPlayerIds.includes(playerId));
  const attackedPlayerIds = uniqueIds([mafiaTargetId, maniacTargetId].flatMap((playerId) => playerId === null ? [] : [playerId]));

  return {
    eliminatedPlayerIds,
    savedPlayerIds,
    mafiaTargetId,
    maniacTargetId,
    attackedPlayerIds,
    attackedPlayerId: mafiaTargetId,
    savedPlayerId: savedPlayerIds[0] ?? null,
    eliminatedPlayerId: eliminatedPlayerIds[0] ?? null,
  };
}

function isMafiaFactionRole(role: Role | null): boolean {
  return role !== null && isMafiaFaction(role);
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function resolveMafiaTarget(actions: readonly RecordedNightAction[]): string | null {
  if (actions.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const action of actions) {
    if (action.targetPlayerId !== null) {
      counts.set(action.targetPlayerId, (counts.get(action.targetPlayerId) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return null;
  }

  const highestVoteCount = Math.max(...counts.values());
  const targets = [...counts.entries()].filter(([, count]) => count === highestVoteCount).map(([targetPlayerId]) => targetPlayerId);
  return targets.length === 1 ? (targets[0] ?? null) : null;
}
