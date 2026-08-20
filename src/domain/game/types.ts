export const GAME_PHASES = ['LOBBY', 'ROLE_CONFIRMATION', 'NIGHT', 'DAY_DISCUSSION', 'DAY_VOTE', 'FINISHED', 'CANCELLED'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export const GAME_STATUSES = ['LOBBY', 'RUNNING', 'FINISHED', 'CANCELLED'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const ROLES = ['MAFIA', 'COMMISSIONER', 'DOCTOR', 'CIVILIAN'] as const;
export type Role = (typeof ROLES)[number];

export const NIGHT_ACTION_TYPES = ['MAFIA_KILL', 'DOCTOR_SAVE', 'COMMISSIONER_CHECK'] as const;
export type NightActionType = (typeof NIGHT_ACTION_TYPES)[number];

export type RoleDistribution = Readonly<Record<Role, number>>;

export type RoleAssignment = Readonly<{
  playerId: string;
  role: Role;
}>;

export type AlivePlayer = Readonly<{
  id: string;
  role: Role;
}>;

export type WinningFaction = 'MAFIA' | 'PEACEFUL';

export class GameRuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GameRuleError';
  }
}
