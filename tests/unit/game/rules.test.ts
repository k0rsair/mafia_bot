import { describe, expect, it } from 'vitest';

import { assignRoles } from '../../../src/domain/game/roleAssignment.js';
import { calculateRoleDistribution, canActionChooseTarget, isMafiaFaction, isMafiaVisibleToSheriff, isSheriffVisibleToDon, validateLobbySize } from '../../../src/domain/game/rules.js';
import { getRoleLabel, GameRuleError } from '../../../src/domain/game/types.js';

describe('city Mafia role rules', () => {
  it.each([
    [6, { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 0, MANIAC: 0, CIVILIAN: 4 }],
    [7, { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 0, MANIAC: 1, CIVILIAN: 4 }],
    [8, { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 4 }],
    [9, { MAFIA: 1, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 4 }],
    [10, { MAFIA: 1, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 }],
    [11, { MAFIA: 2, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 }],
    [12, { MAFIA: 2, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 6 }],
    [13, { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 }],
    [14, { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 6 }],
    [15, { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 7 }],
  ])('calculates the confirmed distribution for %i players', (playerCount, expected) => {
    expect(calculateRoleDistribution(playerCount)).toEqual(expected);
  });

  it('rejects games outside the supported group size', () => {
    expect(() => validateLobbySize(5)).toThrow(GameRuleError);
    expect(() => validateLobbySize(16)).toThrow(GameRuleError);
    expect(() => validateLobbySize(6)).not.toThrow();
  });

  it('assigns a six-player game without unused city roles', () => {
    const playerIds = Array.from({ length: 6 }, (_, index) => `player-${index + 1}`);
    const assignments = assignRoles(playerIds);

    expect(assignments).toHaveLength(playerIds.length);
    expect(assignments.reduce<Record<string, number>>((counts, assignment) => {
      counts[assignment.role] = (counts[assignment.role] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ DON: 1, COMMISSIONER: 1, CIVILIAN: 4 });
  });

  it('assigns every distinct player exactly one role from the city distribution', () => {
    const playerIds = Array.from({ length: 9 }, (_, index) => `player-${index + 1}`);
    const assignments = assignRoles(playerIds);

    expect(assignments).toHaveLength(playerIds.length);
    expect(new Set(assignments.map((assignment) => assignment.playerId))).toEqual(new Set(playerIds));
    expect(assignments.reduce<Record<string, number>>((counts, assignment) => {
      counts[assignment.role] = (counts[assignment.role] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ MAFIA: 1, DON: 1, COMMISSIONER: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 4 });
  });

  it('uses faction-aware target and private-result predicates', () => {
    expect(isMafiaFaction('DON')).toBe(true);
    expect(canActionChooseTarget({ actorRole: 'MAFIA', actionType: 'MAFIA_KILL', targetRole: 'DON', isSelfTarget: false })).toBe(false);
    expect(canActionChooseTarget({ actorRole: 'PROSTITUTE', actionType: 'PROSTITUTE_VISIT', targetRole: 'CIVILIAN', isSelfTarget: true })).toBe(false);
    expect(canActionChooseTarget({ actorRole: 'DOCTOR', actionType: 'DOCTOR_SAVE', targetRole: 'DOCTOR', isSelfTarget: true })).toBe(true);
    expect(isMafiaVisibleToSheriff('DON')).toBe(true);
    expect(isMafiaVisibleToSheriff('MANIAC')).toBe(false);
    expect(isSheriffVisibleToDon('COMMISSIONER')).toBe(true);
    expect(getRoleLabel('COMMISSIONER')).toBe('Шериф');
  });
});
