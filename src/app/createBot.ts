import { Bot, type Context } from 'grammy';

import type { GameService } from '../application/GameService.js';
import type { EphemeralPanelService } from '../application/EphemeralPanelService.js';
import type { NightActionService } from '../application/NightActionService.js';
import type { DayService } from '../application/DayService.js';
import type { PhaseService } from '../application/PhaseService.js';
import type { VotingService } from '../application/VotingService.js';
import type { GameFinalizationService } from '../application/GameFinalizationService.js';
import type { LobbyService } from '../application/LobbyService.js';
import type { TestGameService } from '../application/TestGameService.js';
import type { TelegramEphemeralAdapter } from '../bot/telegram/ephemeral.js';
import type { AppConfig } from '../config/env.js';
import type { AppLogger } from '../observability/logger.js';
import { registerLobbyHandlers } from '../bot/commands/lobbyCommands.js';
import { registerEphemeralCallbacks } from '../bot/callbacks/ephemeralCallbacks.js';
import { registerVoteCallbacks } from '../bot/callbacks/voteCallbacks.js';
import { createErrorBoundary } from '../bot/middleware/errorBoundary.js';
import { createCallbackRateLimit } from '../bot/middleware/rateLimit.js';

type BotDependencies = Readonly<{
  lobbyService: LobbyService;
  gameService: GameService;
  ephemeralPanelService: EphemeralPanelService;
  nightActionService: NightActionService;
  dayService: DayService;
  phaseService: PhaseService;
  votingService: VotingService;
  gameFinalizationService: GameFinalizationService;
  ephemeralAdapter: TelegramEphemeralAdapter;
  testGameService: TestGameService;
}>;

export function createBot(config: AppConfig, logger: AppLogger, dependencies: BotDependencies): Bot<Context> {
  const bot = new Bot<Context>(config.botToken);

  bot.use(createErrorBoundary(logger));
  bot.use(createCallbackRateLimit(logger));

  bot.command('start', async (context) => {
    logger.info({ chatId: String(context.chat.id), userId: String(context.from?.id) }, '[createBot.start] Received /start command');
    await context.reply('👋 Я ведущий игры «Мафия». Добавьте меня в группу и используйте /mafia, чтобы открыть лобби.');
  });

  bot.command('help', async (context) => {
    logger.info({ chatId: String(context.chat.id), userId: String(context.from?.id) }, '[createBot.help] Received /help command');
    const testGameCommand = config.testGameEnabled ? ', /testgame' : '';
    await context.reply(`🎲 Команды: /mafia, /startgame, /startvote, /closenominations, /closevote, /mafia_status, /roles_pending, /restore_panel, /extendroles и /cancelgame${testGameCommand}. Тайные роли и действия откроются в скрытой панели прямо в группе.`);
  });

  registerLobbyHandlers(bot, {
    ...dependencies,
    config,
    logger,
  });
  registerEphemeralCallbacks(bot, dependencies.ephemeralPanelService, dependencies.nightActionService, dependencies.phaseService, dependencies.testGameService, logger);
  registerVoteCallbacks(bot, dependencies.votingService, dependencies.dayService, dependencies.phaseService, dependencies.nightActionService, dependencies.testGameService, logger);

  bot.catch((error) => {
    logger.error(
      { updateId: error.ctx.update.update_id, error: error.error },
      '[createBot.catch] Unhandled Telegram update error',
    );
  });

  return bot;
}
