import { z } from 'zod';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;

const positiveInteger = z.coerce.number().int().positive();

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN must be set'),
  BOT_USERNAME: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}bot$/, 'BOT_USERNAME must end with "bot"'),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid URL')
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), 'DATABASE_URL must use PostgreSQL'),
  LOG_LEVEL: z.enum(logLevels).default('debug'),
  LOBBY_MAX_PLAYERS: positiveInteger.max(20).default(20),
  ROLE_CONFIRMATION_DURATION_SECONDS: positiveInteger.default(300),
  DAY_DURATION_SECONDS: positiveInteger.default(180),
  VOTE_DURATION_SECONDS: positiveInteger.default(90),
  NIGHT_DURATION_SECONDS: positiveInteger.default(120),
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
  nightDurationSeconds: number;
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
    nightDurationSeconds: values.NIGHT_DURATION_SECONDS,
  };
}
