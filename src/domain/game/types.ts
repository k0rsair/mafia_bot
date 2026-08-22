export const GAME_PHASES = [
  'LOBBY',
  'ROLE_CONFIRMATION',
  'NIGHT_PROSTITUTE',
  'NIGHT',
  'DAY_DISCUSSION',
  'DAY_NOMINATION',
  'DAY_VOTE',
  'DAY_TIE_DISCUSSION',
  'DAY_REVOTE',
  'DAY_FINAL_DECISION',
  'FINISHED',
  'CANCELLED',
] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export const GAME_STATUSES = ['LOBBY', 'RUNNING', 'FINISHED', 'CANCELLED'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const ROLES = ['MAFIA', 'DON', 'COMMISSIONER', 'DOCTOR', 'PROSTITUTE', 'MANIAC', 'CIVILIAN'] as const;
export type Role = (typeof ROLES)[number];

export const NIGHT_ACTION_TYPES = [
  'MAFIA_KILL',
  'DOCTOR_SAVE',
  'COMMISSIONER_CHECK',
  'PROSTITUTE_VISIT',
  'DON_CHECK',
  'MANIAC_KILL',
  'MANIAC_SKIP',
] as const;
export type NightActionType = (typeof NIGHT_ACTION_TYPES)[number];

export const VOTE_ROUND_KINDS = ['NOMINATION', 'PRIMARY', 'REVOTE', 'FINAL_DECISION'] as const;
export type VoteRoundKind = (typeof VOTE_ROUND_KINDS)[number];

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  MAFIA: 'Мафия',
  DON: 'Дон',
  COMMISSIONER: 'Шериф',
  DOCTOR: 'Доктор',
  PROSTITUTE: 'Шлюха',
  MANIAC: 'Маньяк',
  CIVILIAN: 'Мирный житель',
};

export function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export type RoleDistribution = Readonly<Record<Role, number>>;

export type RoleAssignment = Readonly<{
  playerId: string;
  role: Role;
}>;

export type AlivePlayer = Readonly<{
  id: string;
  role: Role;
}>;

export type WinningFaction = 'MAFIA' | 'PEACEFUL' | 'MANIAC';

export type PublicNightOutcome = Readonly<{
  eliminatedPlayerIds: readonly string[];
  savedPlayerIds: readonly string[];
}>;

export type PublicVoteOutcome = Readonly<{
  eliminatedPlayerIds: readonly string[];
}>;

export class GameRuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GameRuleError';
  }
}
