import { describe, expect, it } from 'vitest';

import { assignRoles } from '../../../src/domain/game/roleAssignment.js';
import { calculateRoleDistribution, canRoleChooseTarget, validateLobbySize } from '../../../src/domain/game/rules.js';
import { GameRuleError } from '../../../src/domain/game/types.js';

describe('classic Mafia role rules', () => {
  it.each([
    [5, { MAFIA: 1, COMMISSIONER: 1, DOCTOR: 0, CIVILIAN: 3 }],
    [6, { MAFIA: 2, COMMISSIONER: 1, DOCTOR: 0, CIVILIAN: 3 }],
    [7, { MAFIA: 2, COMMISSIONER: 1, DOCTOR: 1, CIVILIAN: 3 }],
    [20, { MAFIA: 6, COMMISSIONER: 1, DOCTOR: 1, CIVILIAN: 12 }],
  ])('calculates the expected distribution for %i players', (playerCount, expected) => {
    expect(calculateRoleDistribution(playerCount)).toEqual(expected);
  });

  it('rejects games outside the supported group size', () => {
    expect(() => validateLobbySize(4)).toThrow(GameRuleError);
    expect(() => validateLobbySize(21)).toThrow(GameRuleError);
  });

  it('assigns every distinct player exactly one role from the calculated distribution', () => {
    const playerIds = Array.from({ length: 7 }, (_, index) => `player-${index + 1}`);
    const assignments = assignRoles(playerIds);

    expect(assignments).toHaveLength(playerIds.length);
    expect(new Set(assignments.map((assignment) => assignment.playerId))).toEqual(new Set(playerIds));
    expect(assignments.reduce<Record<string, number>>((counts, assignment) => {
      counts[assignment.role] = (counts[assignment.role] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ MAFIA: 2, COMMISSIONER: 1, DOCTOR: 1, CIVILIAN: 3 });
  });

  it('rejects duplicate players and applies classic target restrictions', () => {
    expect(() => assignRoles(['one', 'one', 'two', 'three', 'four'])).toThrow(GameRuleError);
    expect(canRoleChooseTarget('MAFIA', 'MAFIA', false)).toBe(false);
    expect(canRoleChooseTarget('COMMISSIONER', 'CIVILIAN', true)).toBe(false);
    expect(canRoleChooseTarget('DOCTOR', 'DOCTOR', true)).toBe(true);
  });
});
