import type { NightActionType, PublicNightOutcome } from './types.js';

export type RecordedNightAction = Readonly<{
  actionType: NightActionType;
  actorPlayerId: string;
  targetPlayerId: string | null;
}>;

export type NightResolution = PublicNightOutcome & Readonly<{
  attackedPlayerId: string | null;
  savedPlayerId: string | null;
  eliminatedPlayerId: string | null;
}>;

export function resolveNight(actions: readonly RecordedNightAction[]): NightResolution {
  const attackedPlayerId = resolveMafiaTarget(actions.filter((action) => action.actionType === 'MAFIA_KILL'));
  const savedPlayerId = actions.find((action) => action.actionType === 'DOCTOR_SAVE')?.targetPlayerId ?? null;

  return {
    eliminatedPlayerIds: attackedPlayerId !== null && attackedPlayerId !== savedPlayerId ? [attackedPlayerId] : [],
    savedPlayerIds: attackedPlayerId !== null && attackedPlayerId === savedPlayerId ? [attackedPlayerId] : [],
    attackedPlayerId,
    savedPlayerId,
    eliminatedPlayerId: attackedPlayerId !== null && attackedPlayerId !== savedPlayerId ? attackedPlayerId : null,
  };
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
