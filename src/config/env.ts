import { z } from 'zod';
import { DEFAULT_ROLE_DISTRIBUTIONS, getDistributionBounds, roleCountTotal } from '../domain/game/rules.js';
import { DEFAULT_ROLE_DISPLAY_NAMES, type RoleDisplayNames, type RoleDistribution, type RoleDistributions } from '../domain/game/types.js';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;

const positiveInteger = z.coerce.number().int().positive();
const booleanEnvironment = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const roleCount = z.number().int().min(0);
const roleDistributionSchema = z.object({
  MAFIA: roleCount,
  DON: roleCount,
  COMMISSIONER: roleCount,
  DOCTOR: roleCount,
  PROSTITUTE: roleCount,
  MANIAC: roleCount,
  CIVILIAN: roleCount,
}) satisfies z.ZodType<RoleDistribution>;

const parsedRoleTableSchema = z.record(z.string().regex(/^\d+$/), roleDistributionSchema).superRefine((table, context) => {
  const sizes = Object.keys(table).map(Number).sort((left, right) => left - right);
  if (sizes.length === 0) {
    context.addIssue({ code: 'custom', message: 'ROLE_DISTRIBUTIONS must contain at least one table size' });
    return;
  }
  for (const [index, size] of sizes.entries()) {
    if (index > 0 && size !== sizes[index - 1]! + 1) {
      context.addIssue({ code: 'custom', message: 'ROLE_DISTRIBUTIONS keys must be a contiguous integer range' });
      return;
    }
    const row = table[String(size)];
    if (row !== undefined && roleCountTotal(row) !== size) {
      context.addIssue({ code: 'custom', path: [String(size)], message: `counts must sum to ${size}` });
    }
  }
});

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN must be set'),
  BOT_USERNAME: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}bot$/, 'BOT_USERNAME must end with "bot"'),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid URL')
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), 'DATABASE_URL must use PostgreSQL'),
  LOG_LEVEL: z.enum(logLevels).default('debug'),
  LOBBY_MAX_PLAYERS: positiveInteger.optional(),
  ROLE_DISTRIBUTIONS: z.string().optional(),
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
  minPlayers: number;
  maxPlayers: number;
  roleDistributions: RoleDistributions;
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
  const roleDistributions = resolveRoleDistributions(values.ROLE_DISTRIBUTIONS);
  const { minPlayers, maxPlayers } = getDistributionBounds(roleDistributions);
  const lobbyMaxPlayers = values.LOBBY_MAX_PLAYERS ?? maxPlayers;
  if (lobbyMaxPlayers < minPlayers || lobbyMaxPlayers > maxPlayers) {
    throw new ConfigurationError(`Invalid application configuration: LOBBY_MAX_PLAYERS: must be between ${minPlayers} and ${maxPlayers}`);
  }

  return {
    botToken: values.BOT_TOKEN,
    botUsername: values.BOT_USERNAME,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
    lobbyMaxPlayers,
    minPlayers,
    maxPlayers,
    roleDistributions,
    roleConfirmationDurationSeconds: values.ROLE_CONFIRMATION_DURATION_SECONDS,
    dayDurationSeconds: values.DAY_DURATION_SECONDS,
    voteDurationSeconds: values.VOTE_DURATION_SECONDS,
    tieDiscussionDurationSeconds: values.TIE_DISCUSSION_DURATION_SECONDS,
    nightDurationSeconds: values.NIGHT_DURATION_SECONDS,
    roleDisplayNames: { prostitute: values.PROSTITUTE_ROLE_NAME },
    testGameEnabled: values.TEST_GAME_ENABLED,
  };
}

function resolveRoleDistributions(raw: string | undefined): RoleDistributions {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_ROLE_DISTRIBUTIONS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError('Invalid application configuration: ROLE_DISTRIBUTIONS: must be valid JSON');
  }

  const table = parsedRoleTableSchema.safeParse(parsed);
  if (!table.success) {
    const details = table.error.issues.map((issue) => `ROLE_DISTRIBUTIONS${issue.path.length === 0 ? '' : `.${issue.path.join('.')}`}: ${issue.message}`).join('; ');
    throw new ConfigurationError(`Invalid application configuration: ${details}`);
  }

  return Object.fromEntries(Object.entries(table.data).map(([size, distribution]) => [Number(size), distribution]));
}
