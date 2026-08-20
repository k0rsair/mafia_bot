import type { Context, MiddlewareFn } from 'grammy';

import type { AppLogger } from '../../observability/logger.js';

export function createCallbackRateLimit(logger: AppLogger, limit: number = 8, windowMilliseconds: number = 10_000): MiddlewareFn<Context> {
  const requests = new Map<string, number[]>();

  return async (context, next) => {
    if (context.callbackQuery === undefined) {
      await next();
      return;
    }

    const key = `${context.callbackQuery.from.id}:${context.callbackQuery.message?.chat.id ?? 'inline'}`;
    const now = Date.now();
    const recent = (requests.get(key) ?? []).filter((timestamp) => timestamp > now - windowMilliseconds);
    if (recent.length >= limit) {
      logger.warn({ userId: String(context.callbackQuery.from.id) }, '[createCallbackRateLimit] Callback rate limit triggered');
      await context.api.answerCallbackQuery(context.callbackQuery.id, { text: '⌛ Слишком много нажатий. Попробуйте через несколько секунд.', show_alert: true });
      return;
    }

    recent.push(now);
    requests.set(key, recent);
    await next();
  };
}
