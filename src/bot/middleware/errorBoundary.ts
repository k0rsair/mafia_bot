import type { Context, MiddlewareFn } from 'grammy';

import type { AppLogger } from '../../observability/logger.js';

export function createErrorBoundary(logger: AppLogger): MiddlewareFn<Context> {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      logger.error({ updateId: context.update.update_id, error }, '[createErrorBoundary] Telegram handler failed');
      if (context.callbackQuery !== undefined) {
        await context.api.answerCallbackQuery(context.callbackQuery.id, { text: '⚠️ Ведущий столкнулся с ошибкой. Попробуйте ещё раз.' }).catch((callbackError: unknown) => {
          logger.error({ callbackError }, '[createErrorBoundary] Failed to answer callback error');
        });
      }
    }
  };
}
