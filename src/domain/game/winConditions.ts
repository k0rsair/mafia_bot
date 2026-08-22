import type { AlivePlayer, WinningFaction } from './types.js';
import { isMafiaFaction } from './rules.js';

export function getWinningFaction(players: readonly AlivePlayer[]): WinningFaction | null {
  const mafiaCount = players.filter((player) => isMafiaFaction(player.role)).length;
  const maniacCount = players.filter((player) => player.role === 'MANIAC').length;
  const civilianCount = players.filter((player) => player.role === 'CIVILIAN').length;
  const peacefulCount = players.length - mafiaCount - maniacCount;

  if (mafiaCount === 0 && maniacCount === 1 && civilianCount === 1 && players.length === 2) {
    return 'MANIAC';
  }

  if (mafiaCount === 0 && maniacCount === 0) {
    return 'PEACEFUL';
  }

  if (maniacCount === 0 && mafiaCount >= peacefulCount) {
    return 'MAFIA';
  }

  return null;
}
