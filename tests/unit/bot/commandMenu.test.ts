import { describe, expect, it, vi } from 'vitest';

import { BOT_COMMANDS, getBotCommands, registerCommandMenu } from '../../../src/bot/commands/commandMenu.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('Telegram command menu', () => {
  it('lists every command handled by the bot', () => {
    expect(BOT_COMMANDS.map((command) => command.command)).toEqual([
      'mafia',
      'startgame',
      'startvote',
      'closenominations',
      'closevote',
      'mafia_status',
      'roles_pending',
      'restore_panel',
      'extendroles',
      'cancelgame',
      'help',
      'start',
    ]);
    expect(new Set(BOT_COMMANDS.map((command) => command.command)).size).toBe(BOT_COMMANDS.length);
  });

  it('sends the menu to Telegram without preventing startup on an API error', async () => {
    const setMyCommands = vi.fn().mockRejectedValue(new Error('temporary API error'));

    await expect(registerCommandMenu({ setMyCommands }, createLogger({ logLevel: 'silent' }))).resolves.toBeUndefined();

    expect(setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS, { scope: { type: 'all_group_chats' } });
  });

  it('adds the development test-game command only when enabled', () => {
    expect(getBotCommands(false)).toEqual(BOT_COMMANDS);
    expect(getBotCommands(true).map((command) => command.command)).toContain('testgame');
  });
});
