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
      lobbyMaxPlayers: 15,
      roleConfirmationDurationSeconds: 300,
      dayDurationSeconds: 180,
      voteDurationSeconds: 90,
      nightDurationSeconds: 120,
      roleDisplayNames: { prostitute: 'Шлюха' },
      testGameEnabled: false,
    });
  });

  it('rejects malformed bot credentials and non-PostgreSQL URLs', () => {
    expect(() => loadConfig({ ...validEnvironment, BOT_USERNAME: 'not-a-bot' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: 'sqlite:///tmp/mafia.db' })).toThrow(ConfigurationError);
  });

  it('enables the test-game command only for an explicit true value', () => {
    expect(loadConfig({ ...validEnvironment, TEST_GAME_ENABLED: 'true' }).testGameEnabled).toBe(true);
    expect(loadConfig({ ...validEnvironment, TEST_GAME_ENABLED: 'false' }).testGameEnabled).toBe(false);
  });

  it('uses the configured player-facing name for the PROSTITUTE role', () => {
    expect(loadConfig({ ...validEnvironment, PROSTITUTE_ROLE_NAME: 'Путана' }).roleDisplayNames).toEqual({ prostitute: 'Путана' });
    expect(() => loadConfig({ ...validEnvironment, PROSTITUTE_ROLE_NAME: '   ' })).toThrow(ConfigurationError);
  });
});
