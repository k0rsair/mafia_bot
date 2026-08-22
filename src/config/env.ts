import { z } from 'zod';
import { DEFAULT_ROLE_DISPLAY_NAMES, type RoleDisplayNames } from '../domain/game/types.js';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;

const positiveInteger = z.coerce.number().int().positive();
const booleanEnvironment = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN must be set'),
  BOT_USERNAME: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}bot$/, 'BOT_USERNAME must end with "bot"'),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid URL')
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), 'DATABASE_URL must use PostgreSQL'),
  LOG_LEVEL: z.enum(logLevels).default('debug'),
  LOBBY_MAX_PLAYERS: positiveInteger.max(15).default(15),
  ROLE_CONFIRMATION_DURATION_SECONDS: positiveInteger.default(300),
  DAY_DURATION_SECONDS: positiveInteger.default(180),
  VOTE_DURATION_SECONDS: positiveInteger.default(90),
  TIE_DISCUSSION_DURATION_SECONDS: z.coerce.number().int().min(30).default(30),
  NIGHT_DURATION_SECONDS: positiveInteger.default(120),
  PROSTITUTE_ROLE_NAME: z.string().trim().min(1).max(32).default(DEFAULT_ROLE_DISPLAY_NAMES.prostitute),
  TEST_GAME_ENABLED: booleanEnvironment,
});

export type AppConfig = Readonly<{
  botToken: string;
  botUsername: string;
  databaseUrl: string;
  logLevel: (typeof logLevels)[number];
  lobbyMaxPlayers: number;
  roleConfirmationDurationSeconds: number;
  dayDurationSeconds: number;
  voteDurationSeconds: number;
  tieDiscussionDurationSeconds: number;
  nightDurationSeconds: number;
  roleDisplayNames: RoleDisplayNames;
  testGameEnabled: boolean;
}>;

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigurationError(`Invalid application configuration: ${details}`);
  }

  const values = parsed.data;

  return {
    botToken: values.BOT_TOKEN,
    botUsername: values.BOT_USERNAME,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
    lobbyMaxPlayers: values.LOBBY_MAX_PLAYERS,
    roleConfirmationDurationSeconds: values.ROLE_CONFIRMATION_DURATION_SECONDS,
    dayDurationSeconds: values.DAY_DURATION_SECONDS,
    voteDurationSeconds: values.VOTE_DURATION_SECONDS,
    tieDiscussionDurationSeconds: values.TIE_DISCUSSION_DURATION_SECONDS,
    nightDurationSeconds: values.NIGHT_DURATION_SECONDS,
    roleDisplayNames: { prostitute: values.PROSTITUTE_ROLE_NAME },
    testGameEnabled: values.TEST_GAME_ENABLED,
  };
}
