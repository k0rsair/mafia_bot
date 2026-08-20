import type { AlivePlayer, WinningFaction } from './types.js';

export function getWinningFaction(players: readonly AlivePlayer[]): WinningFaction | null {
  const mafiaCount = players.filter((player) => player.role === 'MAFIA').length;
  const peacefulCount = players.length - mafiaCount;

  if (mafiaCount === 0) {
    return 'PEACEFUL';
  }

  if (mafiaCount >= peacefulCount) {
    return 'MAFIA';
  }

  return null;
}
