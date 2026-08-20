import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/observability/logger.js';

describe('logger redaction', () => {
  it('does not emit game secrets or tokens', () => {
    const entries: string[] = [];
    const destination: DestinationStream = {
      write: (entry: string): boolean => {
        entries.push(entry);
        return true;
      },
    };
    const logger = createLogger({ logLevel: 'info' }, destination);
    logger.info({ botToken: 'telegram-token', role: 'MAFIA', actionType: 'MAFIA_KILL', targetId: 'player-secret', gameId: 'game-1', phase: 'NIGHT' }, 'Test event');

    const output = entries.join('');
    expect(output).toContain('game-1');
    expect(output).toContain('NIGHT');
    expect(output).not.toContain('telegram-token');
    expect(output).not.toContain('MAFIA');
    expect(output).not.toContain('player-secret');
  });
});
