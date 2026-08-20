import type { Context } from 'grammy';

import type { AppLogger } from '../../observability/logger.js';

export async function canManageGame(context: Context, creatorId: string, logger: AppLogger): Promise<boolean> {
  const userId = context.from?.id;
  const chat = context.chat;
  if (userId === undefined || chat === undefined) {
    logger.warn('[canManageGame] Rejected management action without user or chat');
    return false;
  }

  if (String(userId) === creatorId) {
    return true;
  }

  try {
    const member = await context.api.getChatMember(chat.id, userId);
    const canManage = member.status === 'creator' || member.status === 'administrator';
    logger.debug({ chatId: String(chat.id), userId: String(userId), canManage }, '[canManageGame] Checked administrator access');
    return canManage;
  } catch (error) {
    logger.warn(
      { chatId: String(chat.id), userId: String(userId), error },
      '[canManageGame] Could not check administrator access',
    );
    return false;
  }
}

export function isGameGroup(context: Context): boolean {
  return context.chat?.type === 'group' || context.chat?.type === 'supergroup';
}
