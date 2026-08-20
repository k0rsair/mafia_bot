import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from '../config/env.js';

const REDACTED_FIELDS = [
  'token',
  'botToken',
  'password',
  'authorization',
  'databaseUrl',
  'role',
  'roles',
  'nightAction',
  'nightActions',
  'target',
  'targetId',
  'privateText',
  'ephemeralText',
  'actionType',
];

export type AppLogger = Logger;

export function createLogger(config: Pick<AppConfig, 'logLevel'>, destination?: DestinationStream): AppLogger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: null,
    redact: {
      paths: REDACTED_FIELDS,
      censor: '[REDACTED]',
    },
  };

  return pino(options, destination);
}
