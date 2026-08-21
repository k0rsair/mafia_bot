import { describe, expect, it } from 'vitest';

import { renderNightEvent } from '../../../src/bot/views/nightEventView.js';

describe('night event view', () => {
  it('keeps a night event message stable for repeated delivery', () => {
    const input = {
      gameId: 'game-1',
      phaseVersion: 7,
      eliminatedDisplayName: 'Алиса',
      savedDisplayName: null,
    };

    expect(renderNightEvent(input)).toBe(renderNightEvent(input));
    expect(renderNightEvent(input)).toContain('Алиса');
  });

  it('uses different narrative variants across nights', () => {
    const messages = new Set(Array.from({ length: 8 }, (_, index) => renderNightEvent({
      gameId: 'game-1',
      phaseVersion: index + 1,
      eliminatedDisplayName: 'Алиса',
      savedDisplayName: null,
    })));

    expect(messages.size).toBeGreaterThan(1);
  });

  it('describes a blocked mafia attack without revealing the doctor', () => {
    const message = renderNightEvent({
      gameId: 'game-1',
      phaseVersion: 7,
      eliminatedDisplayName: null,
      savedDisplayName: 'Борис',
    });

    expect(message).toContain('Борис');
    expect(message).not.toContain('доктор');
  });
});
