import type { Game } from '@prisma/client';

import { createBot } from './app/createBot.js';
import { GameService } from './application/GameService.js';
import { EphemeralPanelService } from './application/EphemeralPanelService.js';
import { LobbyService } from './application/LobbyService.js';
import { PhaseClock } from './application/PhaseClock.js';
import { PhaseService, type PhaseDeadlineResult } from './application/PhaseService.js';
import { NightActionService } from './application/NightActionService.js';
import { NightResolutionService } from './application/NightResolutionService.js';
import { DayService } from './application/DayService.js';
import { VotingService, type AppliedVoteResolution } from './application/VotingService.js';
import { GameFinalizationService } from './application/GameFinalizationService.js';
import { RecoveryService } from './application/RecoveryService.js';
import { TestGameService } from './application/TestGameService.js';
import { loadConfig } from './config/env.js';
import { createPrismaClient } from './infrastructure/db/prisma.js';
import { GameRepository } from './infrastructure/repositories/GameRepository.js';
import { PhaseJobRepository } from './infrastructure/repositories/PhaseJobRepository.js';
import { NightActionRepository } from './infrastructure/repositories/NightActionRepository.js';
import { PlayerRepository } from './infrastructure/repositories/PlayerRepository.js';
import { VoteRepository } from './infrastructure/repositories/VoteRepository.js';
import { VoteRoundRepository } from './infrastructure/repositories/VoteRoundRepository.js';
import { DayEffectRepository } from './infrastructure/repositories/DayEffectRepository.js';
import { createLogger } from './observability/logger.js';
import { TelegramEphemeralAdapter } from './bot/telegram/ephemeral.js';
import { renderDayDiscussion } from './bot/views/dayView.js';
import { renderNightEvent } from './bot/views/nightEventView.js';
import { renderNightControl, renderProstituteNightControl, renderRoleControl } from './bot/views/phaseView.js';
import { renderClosedVoteView } from './bot/views/voteView.js';
import { renderFinalView } from './bot/views/finalView.js';
import { registerCommandMenu } from './bot/commands/commandMenu.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const prisma = createPrismaClient(config, logger);
  const gameRepository = new GameRepository(prisma, logger);
  const playerRepository = new PlayerRepository(prisma, logger);
  const phaseJobRepository = new PhaseJobRepository(prisma, logger);
  const nightActionRepository = new NightActionRepository(prisma, logger);
  const voteRepository = new VoteRepository(prisma, logger);
  const voteRoundRepository = new VoteRoundRepository(prisma, logger);
  const dayEffectRepository = new DayEffectRepository(prisma, logger);
  const lobbyService = new LobbyService(gameRepository, playerRepository, logger, config.lobbyMaxPlayers);
  const gameService = new GameService(gameRepository, playerRepository, lobbyService, config, logger);
  const nightResolutionService = new NightResolutionService(playerRepository, nightActionRepository, logger, dayEffectRepository);
  const votingService = new VotingService(gameRepository, playerRepository, voteRepository, logger, undefined, voteRoundRepository, dayEffectRepository);
  const gameFinalizationService = new GameFinalizationService(gameRepository, playerRepository, logger);
  const dayService = new DayService(playerRepository, voteRepository, logger, voteRoundRepository);
  const phaseService = new PhaseService(gameRepository, nightResolutionService, votingService, gameFinalizationService, config, logger, playerRepository, dayService);
  const testGameService = new TestGameService(lobbyService, gameService, playerRepository, nightActionRepository, votingService, phaseService, logger);
  const ephemeralAdapter = new TelegramEphemeralAdapter(config.botToken, logger);
  const nightActionService = new NightActionService(gameRepository, playerRepository, nightActionRepository, ephemeralAdapter, logger);
  const ephemeralPanelService = new EphemeralPanelService(gameRepository, playerRepository, phaseService, nightActionService, ephemeralAdapter, logger);
  const bot = createBot(config, logger, {
    lobbyService,
    gameService,
    ephemeralPanelService,
    nightActionService,
    dayService,
    phaseService,
    votingService,
    gameFinalizationService,
    ephemeralAdapter,
    testGameService,
  });
  await registerCommandMenu(bot.api, logger, config.testGameEnabled);
  const closeVoteControlMessage = async (
    game: Readonly<{ id: string; chatId: string; controlMessageId: number | null }>,
    resolution: AppliedVoteResolution,
  ): Promise<void> => {
    if (game.controlMessageId === null) {
      logger.warn({ gameId: game.id }, '[FIX:vote-closure] Vote control message was not recorded');
      return;
    }
    try {
      await bot.api.editMessageText(game.chatId, game.controlMessageId, renderClosedVoteView({
        outcome: resolution.resolution.outcome,
        ...(resolution.roundKind === undefined ? {} : { kind: resolution.roundKind }),
        eliminatedDisplayNames: resolution.eliminatedPlayers.map((player) => player.displayName),
        alibiedDisplayNames: resolution.alibiedPlayers.map((player) => player.displayName),
        voteDetails: resolution.voteDetails,
      }), { reply_markup: { inline_keyboard: [] } });
    } catch {
      logger.warn({ gameId: game.id }, '[FIX:vote-closure] Could not close vote control message');
    }
  };
  const publishNightStart = async (game: Game): Promise<void> => {
    if (game.phase === 'NIGHT_PROSTITUTE') {
      const regularNight = await testGameService.playVirtualProstituteAction(game);
      if (regularNight !== null) {
        await publishNightStart(regularNight);
        return;
      }
      const view = renderProstituteNightControl();
      const controlMessage = await bot.api.sendMessage(game.chatId, view.text, { reply_markup: view.replyMarkup });
      await gameRepository.setControlMessageId(game.id, controlMessage.message_id);
      await nightActionService.deliverNightPanels(game);
      return;
    }
    if (game.phase !== 'NIGHT') {
      logger.warn({ gameId: game.id, phase: game.phase, stateVersion: game.stateVersion }, '[publishNightStart] Ignored unexpected night-start phase');
      return;
    }
    const testCompletion = await testGameService.playVirtualNightActions(game);
    if (testCompletion !== null) {
      await publishVirtualNightCompletion(bot.api, testCompletion);
      return;
    }

    const nightView = renderNightControl();
    const controlMessage = await bot.api.sendMessage(game.chatId, nightView.text, { reply_markup: nightView.replyMarkup });
    await gameRepository.setControlMessageId(game.id, controlMessage.message_id);
    await nightActionService.deliverNightPanels(game);
  };
  const phaseClock = new PhaseClock(phaseJobRepository, phaseService, logger, async (result) => {
    if (result.kind === 'ROLE_CONFIRMATION_EXPIRED') {
      await bot.api.sendMessage(result.game.chatId, '⌛ Время подтверждения ролей истекло. Организатор может отменить игру или попросить игроков использовать /restore_panel.');
    }
    if (result.kind === 'NIGHT_RESOLVED') {
      const text = renderNightEvent({
        gameId: result.game.id,
        phaseVersion: result.game.stateVersion,
        eliminatedDisplayNames: result.resolution.eliminatedPlayers.map((player) => player.displayName),
        savedDisplayNames: result.resolution.savedPlayers.map((player) => player.displayName),
        eliminatedManiacDisplayName: result.resolution.eliminatedManiacPlayer?.displayName ?? null,
      });
      await bot.api.sendMessage(result.game.chatId, text);
      await bot.api.sendMessage(result.game.chatId, renderDayDiscussion());
    }
    if (result.kind === 'NIGHT_STARTED') {
      await publishNightStart(result.game);
    }
    if (result.kind === 'DAY_NOMINATION_STARTED') {
      await testGameService.castVirtualVotes(result.game);
      const view = await dayService.renderVote(result.game);
      const controlMessage = await bot.api.sendMessage(result.game.chatId, view.text, { reply_markup: view.replyMarkup });
      await gameRepository.setControlMessageId(result.game.id, controlMessage.message_id);
    }
    if (result.kind === 'DAY_REVOTE_STARTED') {
      await testGameService.castVirtualVotes(result.game);
      const view = await dayService.renderVote(result.game);
      const controlMessage = await bot.api.sendMessage(result.game.chatId, view.text, { reply_markup: view.replyMarkup });
      await gameRepository.setControlMessageId(result.game.id, controlMessage.message_id);
    }
    if (result.kind === 'DAY_TIE_DISCUSSION_STARTED') {
      const controlMessage = await bot.api.sendMessage(result.game.chatId, '🤝 Первый тур завершился ничьей. У города есть 30 секунд на обсуждение перед повторным голосованием.');
      await gameRepository.setControlMessageId(result.game.id, controlMessage.message_id);
    }
    if (result.kind === 'DAY_FINAL_DECISION_STARTED') {
      await testGameService.castVirtualVotes(result.game);
      const view = await dayService.renderVote(result.game);
      const controlMessage = await bot.api.sendMessage(result.game.chatId, view.text, { reply_markup: view.replyMarkup });
      await gameRepository.setControlMessageId(result.game.id, controlMessage.message_id);
    }
    if (result.kind === 'DAY_NOMINATION_EXPIRED' || result.kind === 'DAY_REVOTE_EXPIRED' || result.kind === 'DAY_FINAL_DECISION_EXPIRED') {
      await bot.api.sendMessage(result.game.chatId, '⌛ Время городского подраунда истекло. Организатор может завершить его актуальным контролом.');
    }
    if (result.kind === 'DAY_VOTE_STARTED') {
      await testGameService.castVirtualVotes(result.game);
      const view = await dayService.renderVote(result.game);
      const controlMessage = await bot.api.sendMessage(result.game.chatId, view.text, { reply_markup: view.replyMarkup });
      await gameRepository.setControlMessageId(result.game.id, controlMessage.message_id);
    }
    if (result.kind === 'DAY_VOTE_RESOLVED') {
      await closeVoteControlMessage(result.game, result.resolution);
      await publishNightStart(result.game);
    }
    if (result.kind === 'GAME_FINISHED') {
      if (result.voteResolution !== undefined) {
        await closeVoteControlMessage(result.game, result.voteResolution);
      }
      if (result.nightResolution !== undefined) {
        const dawnText = renderNightEvent({
          gameId: result.game.id,
          phaseVersion: result.game.stateVersion,
          eliminatedDisplayNames: result.nightResolution.eliminatedPlayers.map((player) => player.displayName),
          savedDisplayNames: result.nightResolution.savedPlayers.map((player) => player.displayName),
          eliminatedManiacDisplayName: result.nightResolution.eliminatedManiacPlayer?.displayName ?? null,
        });
        await bot.api.sendMessage(result.game.chatId, dawnText);
      }
      await bot.api.sendMessage(result.game.chatId, renderFinalView(result.finalization));
    }
  });

  logger.info(
    {
      botUsername: config.botUsername,
      lobbyMaxPlayers: config.lobbyMaxPlayers,
      logLevel: config.logLevel,
    },
    '[main] Starting Mafia game master polling',
  );

  const stop = (signal: string): void => {
    logger.info({ signal }, '[main] Stopping Mafia game master polling');
    bot.stop();
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  try {
    const recoveryService = new RecoveryService(gameRepository, logger);
    for (const game of await recoveryService.recoverActiveGames()) {
      if (game.phase === 'ROLE_CONFIRMATION') {
        const view = renderRoleControl();
        const message = await bot.api.sendMessage(game.chatId, view.text, { reply_markup: view.replyMarkup });
        await gameRepository.setControlMessageId(game.id, message.message_id);
        const delivery = await ephemeralPanelService.deliverRolePanels(game);
        if (delivery.nightStarted && delivery.nightGame !== undefined) {
          await publishNightStart(delivery.nightGame);
        }
      } else if (game.phase === 'NIGHT_PROSTITUTE' || game.phase === 'NIGHT') {
        await publishNightStart(game);
      } else if (game.phase === 'DAY_NOMINATION' || game.phase === 'DAY_VOTE' || game.phase === 'DAY_REVOTE' || game.phase === 'DAY_FINAL_DECISION') {
        await testGameService.castVirtualVotes(game);
        const view = await dayService.renderVote(game);
        const message = await bot.api.sendMessage(game.chatId, view.text, { reply_markup: view.replyMarkup });
        await gameRepository.setControlMessageId(game.id, message.message_id);
      } else if (game.phase === 'DAY_DISCUSSION') {
        const message = await bot.api.sendMessage(game.chatId, '☀️ Игра восстановлена. Обсуждение продолжается до сохранённого дедлайна.');
        await gameRepository.setControlMessageId(game.id, message.message_id);
      } else if (game.phase === 'DAY_TIE_DISCUSSION') {
        const message = await bot.api.sendMessage(game.chatId, '🤝 Игра восстановлена: идёт 30-секундное обсуждение ничьей перед повторным голосованием.');
        await gameRepository.setControlMessageId(game.id, message.message_id);
      }
    }
    phaseClock.start();
    await bot.start({
      onStart: (botInfo) => logger.info({ botId: botInfo.id, botUsername: botInfo.username }, '[main] Polling started'),
    });
  } finally {
    phaseClock.stop();
    logger.info('[main] Disconnecting from database');
    await prisma.$disconnect();
  }
}

async function publishVirtualNightCompletion(
  api: Readonly<{ sendMessage(chatId: string, text: string): Promise<unknown> }>,
  completion: Extract<PhaseDeadlineResult, { kind: 'NIGHT_RESOLVED' | 'GAME_FINISHED' }> | null,
): Promise<void> {
  if (completion === null) {
    return;
  }

  const resolution = completion.kind === 'GAME_FINISHED' ? completion.nightResolution : completion.resolution;
  if (resolution === undefined) {
    return;
  }
  const dawnText = renderNightEvent({
    gameId: completion.game.id,
    phaseVersion: completion.game.stateVersion,
    eliminatedDisplayName: resolution.eliminatedPlayer?.displayName ?? null,
    savedDisplayName: resolution.savedPlayer?.displayName ?? null,
  });
  await api.sendMessage(completion.game.chatId, dawnText);
  if (completion.kind === 'GAME_FINISHED') {
    await api.sendMessage(completion.game.chatId, renderFinalView(completion.finalization));
    return;
  }
  await api.sendMessage(completion.game.chatId, renderDayDiscussion());
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[main] Fatal startup error: ${message}\n`);
  process.exitCode = 1;
});
