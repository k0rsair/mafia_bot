import { randomInt } from 'node:crypto';

import { calculateRoleDistribution } from './rules.js';
import type { Role, RoleAssignment } from './types.js';
import { GameRuleError } from './types.js';

export function assignRoles(playerIds: readonly string[]): RoleAssignment[] {
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length !== playerIds.length) {
    throw new GameRuleError('Cannot assign roles to duplicate players');
  }

  const distribution = calculateRoleDistribution(uniquePlayerIds.length);
  const rolePool = buildRolePool(distribution);
  const shuffledPlayerIds = shuffle([...uniquePlayerIds]);
  const shuffledRoles = shuffle(rolePool);

  return shuffledPlayerIds.map((playerId, index) => {
    const role = shuffledRoles[index];
    if (role === undefined) {
      throw new GameRuleError('Role pool was shorter than player list');
    }

    return { playerId, role };
  });
}

function buildRolePool(distribution: Readonly<Record<Role, number>>): Role[] {
  return (Object.entries(distribution) as Array<[Role, number]>).flatMap(([role, count]) => Array.from({ length: count }, () => role));
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1);
    const current = items[index];
    items[index] = items[randomIndex] as T;
    items[randomIndex] = current as T;
  }

  return items;
}
