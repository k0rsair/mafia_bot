import { describe, expect, it } from 'vitest';

import { resolveNight } from '../../../src/domain/game/nightResolution.js';
import { resolveFinalDecision, resolveVote } from '../../../src/domain/game/voteResolution.js';
import { getWinningFaction } from '../../../src/domain/game/winConditions.js';

describe('city night resolution', () => {
  const players = [
    { id: 'mafia', role: 'MAFIA' },
    { id: 'don', role: 'DON' },
    { id: 'doctor', role: 'DOCTOR' },
    { id: 'prostitute', role: 'PROSTITUTE' },
    { id: 'client', role: 'CIVILIAN' },
    { id: 'maniac', role: 'MANIAC' },
    { id: 'resident', role: 'CIVILIAN' },
  ] as const;

  it('blocks the mafia shot when the prostitute visits a Mafia-faction member', () => {
    const resolution = resolveNight({
      players,
      actions: [
        { actionType: 'PROSTITUTE_VISIT', actorPlayerId: 'prostitute', targetPlayerId: 'don' },
        { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia', targetPlayerId: 'resident' },
      ],
    });

    expect(resolution.eliminatedPlayerIds).toEqual([]);
    expect(resolution.mafiaTargetId).toBeNull();
  });

  it('applies independent maniac damage and linked prostitute death without duplicate eliminations', () => {
    const resolution = resolveNight({
      players,
      actions: [
        { actionType: 'PROSTITUTE_VISIT', actorPlayerId: 'prostitute', targetPlayerId: 'client' },
        { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia', targetPlayerId: 'prostitute' },
        { actionType: 'MANIAC_KILL', actorPlayerId: 'maniac', targetPlayerId: 'client' },
      ],
    });

    expect(resolution.eliminatedPlayerIds).toEqual(['prostitute', 'client']);
  });

  it('handles the documented doctor and prostitute mafia cases', () => {
    const doctorSavesProstitute = resolveNight({
      players,
      actions: [
        { actionType: 'PROSTITUTE_VISIT', actorPlayerId: 'prostitute', targetPlayerId: 'client' },
        { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia', targetPlayerId: 'prostitute' },
        { actionType: 'DOCTOR_SAVE', actorPlayerId: 'doctor', targetPlayerId: 'prostitute' },
      ],
    });
    const doctorSavesClient = resolveNight({
      players,
      actions: [
        { actionType: 'PROSTITUTE_VISIT', actorPlayerId: 'prostitute', targetPlayerId: 'client' },
        { actionType: 'MAFIA_KILL', actorPlayerId: 'mafia', targetPlayerId: 'prostitute' },
        { actionType: 'DOCTOR_SAVE', actorPlayerId: 'doctor', targetPlayerId: 'client' },
      ],
    });

    expect(doctorSavesProstitute.eliminatedPlayerIds).toEqual([]);
    expect(doctorSavesProstitute.savedPlayerIds).toEqual(['prostitute', 'client']);
    expect(doctorSavesClient.eliminatedPlayerIds).toEqual(['prostitute']);
    expect(doctorSavesClient.savedPlayerIds).toEqual([]);
  });
});

describe('city vote resolution and victory', () => {
  it('returns persisted tied candidates and resolves the final binary decision', () => {
    expect(resolveVote([{ targetPlayerId: 'p2', isSkip: false }, { targetPlayerId: 'p3', isSkip: false }])).toMatchObject({ outcome: 'TIE', tiedPlayerIds: ['p2', 'p3'] });
    expect(resolveFinalDecision([
      { targetPlayerId: 'p2', isSkip: false },
      { targetPlayerId: 'p2', isSkip: false },
      { targetPlayerId: null, isSkip: true },
    ], ['p2', 'p3'])).toMatchObject({ outcome: 'ELIMINATION', eliminatedPlayerIds: ['p2', 'p3'] });
    expect(resolveFinalDecision([{ targetPlayerId: null, isSkip: true }], ['p2', 'p3']).eliminatedPlayerIds).toEqual([]);
  });

  it('recognises peaceful, Mafia, and final Maniac wins', () => {
    expect(getWinningFaction([{ id: 'm1', role: 'MAFIA' }, { id: 'p1', role: 'CIVILIAN' }])).toBe('MAFIA');
    expect(getWinningFaction([{ id: 'p1', role: 'CIVILIAN' }, { id: 'p2', role: 'DOCTOR' }])).toBe('PEACEFUL');
    expect(getWinningFaction([{ id: 'x', role: 'MANIAC' }, { id: 'p1', role: 'CIVILIAN' }])).toBe('MANIAC');
    expect(getWinningFaction([{ id: 'x', role: 'MANIAC' }, { id: 's', role: 'COMMISSIONER' }])).toBeNull();
  });
});
