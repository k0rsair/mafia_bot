import type { BotCommand } from 'grammy/types';

import type { AppLogger } from '../../observability/logger.js';

export const BOT_COMMANDS: readonly BotCommand[] = [
  { command: 'mafia', description: 'Создать лобби игры' },
  { command: 'startgame', description: 'Начать игру' },
  { command: 'startvote', description: 'Начать голосование' },
  { command: 'mafia_status', description: 'Показать текущую фазу' },
  { command: 'roles_pending', description: 'Кто не подтвердил роль' },
  { command: 'restore_panel', description: 'Вернуть личную панель' },
  { command: 'extendroles', description: 'Продлить подтверждение ролей' },
  { command: 'cancelgame', description: 'Отменить игру (нужно confirm)' },
  { command: 'help', description: 'Показать справку' },
  { command: 'start', description: 'Начать работу с ботом' },
];

export async function registerCommandMenu(
  api: Readonly<{ setMyCommands(commands: readonly BotCommand[]): Promise<true> }>,
  logger: AppLogger,
): Promise<void> {
  try {
    await api.setMyCommands(BOT_COMMANDS);
    logger.info({ commandCount: BOT_COMMANDS.length }, '[FIX:command-menu] Telegram command menu synchronised');
  } catch (error) {
    logger.error({ commandCount: BOT_COMMANDS.length, error }, '[FIX:command-menu] Failed to synchronise Telegram command menu');
  }
}
