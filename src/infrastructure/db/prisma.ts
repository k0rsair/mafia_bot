import { PrismaClient } from '@prisma/client';

import type { AppConfig } from '../../config/env.js';
import type { AppLogger } from '../../observability/logger.js';

export function createPrismaClient(config: Pick<AppConfig, 'databaseUrl'>, logger: AppLogger): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('query', (event) => {
    logger.debug({ durationMs: event.duration, target: event.target }, '[createPrismaClient] Database query completed');
  });
  client.$on('warn', (event) => {
    logger.warn({ target: event.target }, '[createPrismaClient] Database warning');
  });
  client.$on('error', (event) => {
    logger.error({ target: event.target }, '[createPrismaClient] Database error');
  });

  return client;
}
