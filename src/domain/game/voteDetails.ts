export type PublicVoteDetail = Readonly<{
  voterDisplayName: string;
  targetDisplayName: string | null;
}>;

export function toPublicVoteDetails(
  votes: readonly Readonly<{ voterPlayerId: string; targetPlayerId: string | null }>[],
  players: readonly Readonly<{ id: string; displayName: string }>[],
): readonly PublicVoteDetail[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return votes.flatMap((vote) => {
    const voter = playersById.get(vote.voterPlayerId);
    const target = vote.targetPlayerId === null ? null : playersById.get(vote.targetPlayerId);
    if (voter === undefined || (vote.targetPlayerId !== null && target === undefined)) {
      return [];
    }
    return [{ voterDisplayName: voter.displayName, targetDisplayName: target?.displayName ?? null }];
  }).sort((left, right) => left.voterDisplayName.localeCompare(right.voterDisplayName, 'ru'));
}
