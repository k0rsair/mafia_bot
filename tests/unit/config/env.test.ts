import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../../src/config/env.js';

const validEnvironment = {
  BOT_TOKEN: '1234567890:token-value',
  BOT_USERNAME: 'mafia_test_bot',
  DATABASE_URL: 'postgresql://mafia:mafia@localhost:5432/mafia_test',
};

describe('environment configuration', () => {
  it('uses safe development defaults for optional settings', () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      logLevel: 'debug',
      lobbyMaxPlayers: 20,
      roleConfirmationDurationSeconds: 300,
      dayDurationSeconds: 180,
      voteDurationSeconds: 90,
      nightDurationSeconds: 120,
    });
  });

  it('rejects malformed bot credentials and non-PostgreSQL URLs', () => {
    expect(() => loadConfig({ ...validEnvironment, BOT_USERNAME: 'not-a-bot' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: 'sqlite:///tmp/mafia.db' })).toThrow(ConfigurationError);
  });
});
