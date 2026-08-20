import type { Role, RoleDistribution } from './types.js';
import { GameRuleError } from './types.js';

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 20;

const EMPTY_DISTRIBUTION: RoleDistribution = {
  MAFIA: 0,
  COMMISSIONER: 0,
  DOCTOR: 0,
  CIVILIAN: 0,
};

export function validateLobbySize(playerCount: number): void {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new GameRuleError(`A game needs from ${MIN_PLAYERS} to ${MAX_PLAYERS} players; received ${playerCount}`);
  }
}

export function calculateRoleDistribution(playerCount: number): RoleDistribution {
  validateLobbySize(playerCount);

  const mafiaCount = Math.max(1, Math.floor(playerCount / 3));
  const commissionerCount = playerCount >= 5 ? 1 : 0;
  const doctorCount = playerCount >= 7 ? 1 : 0;
  const civilianCount = playerCount - mafiaCount - commissionerCount - doctorCount;

  if (civilianCount < 1) {
    throw new GameRuleError('Role distribution must include at least one civilian');
  }

  return {
    ...EMPTY_DISTRIBUTION,
    MAFIA: mafiaCount,
    COMMISSIONER: commissionerCount,
    DOCTOR: doctorCount,
    CIVILIAN: civilianCount,
  };
}

export function canRoleChooseTarget(role: Role, targetRole: Role, isSelfTarget: boolean): boolean {
  if (role === 'CIVILIAN') {
    return false;
  }

  if (role === 'MAFIA') {
    return targetRole !== 'MAFIA';
  }

  if (role === 'DOCTOR') {
    return true;
  }

  return !isSelfTarget;
}
