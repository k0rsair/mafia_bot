import { DEFAULT_ROLE_DISPLAY_NAMES, getRoleLabel, type Role, type RoleDisplayNames, type WinningFaction } from '../../domain/game/types.js';

export function renderFinalView(input: Readonly<{
  winningFaction: WinningFaction;
  players: readonly Readonly<{ displayName: string; role: Role | null }>[];
  roleDisplayNames?: RoleDisplayNames;
}>): string {
  const winner = winnerLabel(input.winningFaction);
  const roleDisplayNames = input.roleDisplayNames ?? DEFAULT_ROLE_DISPLAY_NAMES;
  const roles = input.players.map((player) => `• ${player.displayName} — ${roleLabel(player.role, roleDisplayNames)}`).join('\n');
  return ['🏁 Игра завершена', winner, '', '🎭 Роли игроков:', roles].join('\n');
}

function roleLabel(role: Role | null, roleDisplayNames: RoleDisplayNames): string {
  if (role === null) {
    return 'не назначена';
  }
  return getRoleLabel(role, roleDisplayNames);
}

function winnerLabel(winningFaction: WinningFaction): string {
  switch (winningFaction) {
    case 'MAFIA':
      return '🕶️ Победила мафия!';
    case 'PEACEFUL':
      return '🕊️ Победили мирные жители!';
    case 'MANIAC':
      return '🔪 Победил маньяк!';
  }
}
