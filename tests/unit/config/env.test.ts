import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../../src/config/env.js';
import { DEFAULT_ROLE_DISTRIBUTIONS } from '../../../src/domain/game/rules.js';
import type { RoleDistribution } from '../../../src/domain/game/types.js';

function defaultRow(size: number): RoleDistribution {
  const distribution = DEFAULT_ROLE_DISTRIBUTIONS[size];
  if (distribution === undefined) {
    throw new Error(`Missing compiled role row for ${size} players`);
  }
  return distribution;
}

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
      minPlayers: 6,
      maxPlayers: 15,
      roleDistributions: DEFAULT_ROLE_DISTRIBUTIONS,
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

  it('uses the compiled role table when ROLE_DISTRIBUTIONS is empty', () => {
    const config = loadConfig({ ...validEnvironment, ROLE_DISTRIBUTIONS: '' });

    expect(config.roleDistributions).toEqual(DEFAULT_ROLE_DISTRIBUTIONS);
    expect(config.minPlayers).toBe(6);
    expect(config.maxPlayers).toBe(15);
    expect(config.lobbyMaxPlayers).toBe(15);
  });

  it('derives bounds from a valid ROLE_DISTRIBUTIONS subset and rejects a lobby cap above max', () => {
    const compactTable = {
      6: defaultRow(6),
      7: defaultRow(7),
      8: defaultRow(8),
    };
    const config = loadConfig({ ...validEnvironment, ROLE_DISTRIBUTIONS: JSON.stringify(compactTable) });

    expect(config.minPlayers).toBe(6);
    expect(config.maxPlayers).toBe(8);
    expect(config.lobbyMaxPlayers).toBe(8);
    expect(config.roleDistributions).toEqual(compactTable);
    expect(() => loadConfig({
      ...validEnvironment,
      ROLE_DISTRIBUTIONS: JSON.stringify(compactTable),
      LOBBY_MAX_PLAYERS: '15',
    })).toThrow(ConfigurationError);
  });

  it('rejects malformed ROLE_DISTRIBUTIONS payloads', () => {
    const validRow = defaultRow(6);
    expect(() => loadConfig({ ...validEnvironment, ROLE_DISTRIBUTIONS: '{not-json' })).toThrow(ConfigurationError);
    expect(() => loadConfig({
      ...validEnvironment,
      ROLE_DISTRIBUTIONS: JSON.stringify({ 6: { ...validRow, CIVILIAN: 3 } }),
    })).toThrow(ConfigurationError);
    expect(() => loadConfig({
      ...validEnvironment,
      ROLE_DISTRIBUTIONS: JSON.stringify({
        6: validRow,
        8: defaultRow(8),
      }),
    })).toThrow(ConfigurationError);
  });
});
