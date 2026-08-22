export type RecordedVote = Readonly<{
  targetPlayerId: string | null;
  isSkip: boolean;
}>;

import type { PublicVoteOutcome } from './types.js';

export type VoteResolution = PublicVoteOutcome & Readonly<{
  eliminatedPlayerId: string | null;
  tiedPlayerIds: readonly string[];
  outcome: 'ELIMINATION' | 'SKIP' | 'TIE' | 'NO_VOTES';
}>;

export function resolveVote(votes: readonly RecordedVote[]): VoteResolution {
  if (votes.length === 0) {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, tiedPlayerIds: [], outcome: 'NO_VOTES' };
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
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, tiedPlayerIds: winners.filter((candidate) => candidate !== 'skip'), outcome: 'TIE' };
  }

  const winner = winners[0];
  if (winner === undefined || winner === 'skip') {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, tiedPlayerIds: [], outcome: 'SKIP' };
  }

  return { eliminatedPlayerIds: [winner], eliminatedPlayerId: winner, tiedPlayerIds: [], outcome: 'ELIMINATION' };
}

export function resolveFinalDecision(votes: readonly RecordedVote[], tiedPlayerIds: readonly string[]): VoteResolution {
  const leaveCount = votes.filter((vote) => !vote.isSkip).length;
  const stayCount = votes.length - leaveCount;
  if (leaveCount <= stayCount) {
    return { eliminatedPlayerIds: [], eliminatedPlayerId: null, tiedPlayerIds: [], outcome: 'SKIP' };
  }
  return {
    eliminatedPlayerIds: [...new Set(tiedPlayerIds)],
    eliminatedPlayerId: tiedPlayerIds[0] ?? null,
    tiedPlayerIds: [],
    outcome: 'ELIMINATION',
  };
}
