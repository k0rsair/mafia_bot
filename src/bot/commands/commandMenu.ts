import type { BotCommand } from 'grammy/types';
import type { BotCommandScopeAllGroupChats } from '@grammyjs/types/settings.js';

import type { AppLogger } from '../../observability/logger.js';

export const BOT_COMMANDS: readonly BotCommand[] = [
  { command: 'mafia', description: 'Создать лобби игры' },
  { command: 'startgame', description: 'Начать игру' },
  { command: 'startvote', description: 'Начать голосование' },
  { command: 'closenominations', description: 'Закрыть номинации' },
  { command: 'closevote', description: 'Закрыть городской раунд' },
  { command: 'mafia_status', description: 'Показать текущую фазу' },
  { command: 'roles_pending', description: 'Кто не подтвердил роль' },
  { command: 'restore_panel', description: 'Вернуть личную панель' },
  { command: 'extendroles', description: 'Продлить подтверждение ролей' },
  { command: 'cancelgame', description: 'Отменить игру (нужно confirm)' },
  { command: 'help', description: 'Показать справку' },
  { command: 'start', description: 'Начать работу с ботом' },
];

const TEST_GAME_COMMAND: BotCommand = { command: 'testgame', description: 'Запустить тест с ботами' };
const GROUP_COMMAND_SCOPE: BotCommandScopeAllGroupChats = { type: 'all_group_chats' };

export function getBotCommands(testGameEnabled: boolean): readonly BotCommand[] {
  return testGameEnabled ? [...BOT_COMMANDS, TEST_GAME_COMMAND] : BOT_COMMANDS;
}

export async function registerCommandMenu(
  api: Readonly<{ setMyCommands(commands: readonly BotCommand[], other?: Readonly<{ scope: BotCommandScopeAllGroupChats }>): Promise<true> }>,
  logger: AppLogger,
  testGameEnabled: boolean = false,
): Promise<void> {
  const commands = getBotCommands(testGameEnabled);
  try {
    await api.setMyCommands(commands, { scope: GROUP_COMMAND_SCOPE });
    logger.info({ commandCount: commands.length, testGameEnabled, commandScope: GROUP_COMMAND_SCOPE.type }, '[registerCommandMenu] Telegram group command menu synchronised');
  } catch (error) {
    logger.error({ commandCount: commands.length, testGameEnabled, error }, '[FIX:command-menu] Failed to synchronise Telegram command menu');
  }
}
