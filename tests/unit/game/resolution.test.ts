import { describe, expect, it } from 'vitest';

import { resolveNight } from '../../../src/domain/game/nightResolution.js';
import { resolveVote } from '../../../src/domain/game/voteResolution.js';
import { getWinningFaction } from '../../../src/domain/game/winConditions.js';

describe('night resolution', () => {
  it('eliminates the unique mafia target unless the doctor saves that player', () => {
    expect(resolveNight([
      { actionType: 'MAFIA_KILL', actorPlayerId: 'm1', targetPlayerId: 'p2' },
      { actionType: 'MAFIA_KILL', actorPlayerId: 'm2', targetPlayerId: 'p2' },
      { actionType: 'DOCTOR_SAVE', actorPlayerId: 'd1', targetPlayerId: 'p3' },
    ])).toEqual({ attackedPlayerId: 'p2', savedPlayerId: 'p3', eliminatedPlayerId: 'p2' });

    expect(resolveNight([
      { actionType: 'MAFIA_KILL', actorPlayerId: 'm1', targetPlayerId: 'p2' },
      { actionType: 'DOCTOR_SAVE', actorPlayerId: 'd1', targetPlayerId: 'p2' },
    ]).eliminatedPlayerId).toBeNull();
  });

  it('does not eliminate anyone when mafia choices are tied', () => {
    expect(resolveNight([
      { actionType: 'MAFIA_KILL', actorPlayerId: 'm1', targetPlayerId: 'p2' },
      { actionType: 'MAFIA_KILL', actorPlayerId: 'm2', targetPlayerId: 'p3' },
    ])).toEqual({ attackedPlayerId: null, savedPlayerId: null, eliminatedPlayerId: null });
  });
});

describe('vote resolution and victory', () => {
  it('handles elimination, skip, tie, and no votes', () => {
    expect(resolveVote([{ targetPlayerId: 'p2', isSkip: false }, { targetPlayerId: 'p2', isSkip: false }])).toEqual({ eliminatedPlayerId: 'p2', outcome: 'ELIMINATION' });
    expect(resolveVote([{ targetPlayerId: null, isSkip: true }])).toEqual({ eliminatedPlayerId: null, outcome: 'SKIP' });
    expect(resolveVote([{ targetPlayerId: 'p2', isSkip: false }, { targetPlayerId: 'p3', isSkip: false }])).toEqual({ eliminatedPlayerId: null, outcome: 'TIE' });
    expect(resolveVote([])).toEqual({ eliminatedPlayerId: null, outcome: 'NO_VOTES' });
  });

  it('recognises both winning factions', () => {
    expect(getWinningFaction([{ id: 'm1', role: 'MAFIA' }, { id: 'p1', role: 'CIVILIAN' }])).toBe('MAFIA');
    expect(getWinningFaction([{ id: 'p1', role: 'CIVILIAN' }, { id: 'p2', role: 'DOCTOR' }])).toBe('PEACEFUL');
    expect(getWinningFaction([{ id: 'm1', role: 'MAFIA' }, { id: 'p1', role: 'CIVILIAN' }, { id: 'p2', role: 'COMMISSIONER' }])).toBeNull();
  });
});
