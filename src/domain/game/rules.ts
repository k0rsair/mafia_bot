import type { NightActionType, Role, RoleDistribution } from './types.js';
import { GameRuleError } from './types.js';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 15;

const ROLE_DISTRIBUTIONS: Readonly<Record<number, RoleDistribution>> = {
  6: { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 0, MANIAC: 0, CIVILIAN: 4 },
  7: { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 0, CIVILIAN: 4 },
  8: { MAFIA: 0, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 4 },
  9: { MAFIA: 1, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 4 },
  10: { MAFIA: 1, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 },
  11: { MAFIA: 2, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 },
  12: { MAFIA: 2, DON: 1, COMMISSIONER: 1, DOCTOR: 0, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 6 },
  13: { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 5 },
  14: { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 6 },
  15: { MAFIA: 3, DON: 1, COMMISSIONER: 1, DOCTOR: 1, PROSTITUTE: 1, MANIAC: 1, CIVILIAN: 7 },
};

export function validateLobbySize(playerCount: number): void {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new GameRuleError(`Чтобы начать игру, нужно от ${MIN_PLAYERS} до ${MAX_PLAYERS} игроков.`);
  }
}

export function calculateRoleDistribution(playerCount: number): RoleDistribution {
  validateLobbySize(playerCount);

  const distribution = ROLE_DISTRIBUTIONS[playerCount];
  if (distribution === undefined) {
    throw new GameRuleError(`No role distribution exists for ${playerCount} players`);
  }

  return distribution;
}

export function canRoleChooseTarget(role: Role, targetRole: Role, isSelfTarget: boolean): boolean {
  const actionType = getPrimaryNightAction(role);
  return actionType !== null && canActionChooseTarget({ actorRole: role, actionType, targetRole, isSelfTarget });
}

export function isMafiaFaction(role: Role): boolean {
  return role === 'MAFIA' || role === 'DON';
}

export function isNightActor(role: Role): boolean {
  return getNightActionTypes(role).length > 0;
}

export function getNightActionTypes(role: Role): readonly NightActionType[] {
  switch (role) {
    case 'MAFIA':
      return ['MAFIA_KILL'];
    case 'DON':
      return ['MAFIA_KILL', 'DON_CHECK'];
    case 'COMMISSIONER':
      return ['COMMISSIONER_CHECK'];
    case 'DOCTOR':
      return ['DOCTOR_SAVE'];
    case 'PROSTITUTE':
      return ['PROSTITUTE_VISIT'];
    case 'MANIAC':
      return ['MANIAC_KILL', 'MANIAC_SKIP'];
    case 'CIVILIAN':
      return [];
  }
}

export function canActionChooseTarget(input: Readonly<{
  actorRole: Role;
  actionType: NightActionType;
  targetRole: Role;
  isSelfTarget: boolean;
}>): boolean {
  if (!getNightActionTypes(input.actorRole).includes(input.actionType) || input.actionType === 'MANIAC_SKIP') {
    return false;
  }

  switch (input.actionType) {
    case 'MAFIA_KILL':
      return isMafiaFaction(input.actorRole) && !isMafiaFaction(input.targetRole);
    case 'DOCTOR_SAVE':
      return input.actorRole === 'DOCTOR';
    case 'COMMISSIONER_CHECK':
      return input.actorRole === 'COMMISSIONER' && !input.isSelfTarget;
    case 'PROSTITUTE_VISIT':
      return input.actorRole === 'PROSTITUTE' && !input.isSelfTarget;
    case 'DON_CHECK':
      return input.actorRole === 'DON' && !input.isSelfTarget;
    case 'MANIAC_KILL':
      return input.actorRole === 'MANIAC' && !input.isSelfTarget;
  }
}

export function isMafiaVisibleToSheriff(role: Role): boolean {
  return isMafiaFaction(role);
}

export function isSheriffVisibleToDon(role: Role): boolean {
  return role === 'COMMISSIONER';
}

function getPrimaryNightAction(role: Role): NightActionType | null {
  const [actionType] = getNightActionTypes(role);
  return actionType ?? null;
}
