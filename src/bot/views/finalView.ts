import type { Role } from '../../domain/game/types.js';

export function renderFinalView(input: Readonly<{
  winningFaction: 'MAFIA' | 'PEACEFUL';
  players: readonly Readonly<{ displayName: string; role: Role | null }>[];
}>): string {
  const winner = input.winningFaction === 'MAFIA' ? '🕶️ Победила мафия!' : '🕊️ Победили мирные жители!';
  const roles = input.players.map((player) => `• ${player.displayName} — ${roleLabel(player.role)}`).join('\n');
  return ['🏁 Игра завершена', winner, '', '🎭 Роли игроков:', roles].join('\n');
}

function roleLabel(role: Role | null): string {
  switch (role) {
    case 'MAFIA':
      return '🕶️ Мафия';
    case 'COMMISSIONER':
      return '🔍 Комиссар';
    case 'DOCTOR':
      return '💉 Доктор';
    case 'CIVILIAN':
      return '🕊️ Мирный житель';
    case null:
      return 'не назначена';
  }
}
