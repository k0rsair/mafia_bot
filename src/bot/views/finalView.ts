import { getRoleLabel, type Role, type WinningFaction } from '../../domain/game/types.js';

export function renderFinalView(input: Readonly<{
  winningFaction: WinningFaction;
  players: readonly Readonly<{ displayName: string; role: Role | null }>[];
}>): string {
  const winner = winnerLabel(input.winningFaction);
  const roles = input.players.map((player) => `• ${player.displayName} — ${roleLabel(player.role)}`).join('\n');
  return ['🏁 Игра завершена', winner, '', '🎭 Роли игроков:', roles].join('\n');
}

function roleLabel(role: Role | null): string {
  if (role === null) {
    return 'не назначена';
  }
  return getRoleLabel(role);
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
