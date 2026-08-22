export type RecordedVote = Readonly<{
  targetPlayerId: string | null;
  isSkip: boolean;
}>;

import type { PublicVoteOutcome } from './types.js';

export type VoteResolution = PublicVoteOutcome & Readonly<{
  eliminatedPlayerId: string | null;
  outcome: 'ELIMINATION' | 'SKIP' | 'TIE' | 'NO_VOTES';
}>;

export function resolveVote(votes: readonly RecordedVote[]): VoteResolution {
  if (votes.length === 0) {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, outcome: 'NO_VOTES' };
  }

  const counts = new Map<string, number>();
  for (const vote of votes) {
    const key = vote.isSkip ? 'skip' : vote.targetPlayerId;
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const topCount = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, count]) => count === topCount).map(([candidate]) => candidate);
  if (winners.length !== 1) {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, outcome: 'TIE' };
  }

  const winner = winners[0];
  if (winner === undefined || winner === 'skip') {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, outcome: 'SKIP' };
  }

  return { eliminatedPlayerIds: [winner], eliminatedPlayerId: winner, outcome: 'ELIMINATION' };
}
