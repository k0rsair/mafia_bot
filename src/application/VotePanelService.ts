import type { Game } from '@prisma/client';

import { renderCityVotePanel } from '../bot/views/ephemeralPanelView.js';
import type { AppLogger } from '../observability/logger.js';
import type { TelegramEphemeralAdapter } from '../bot/telegram/ephemeral.js';
import type { PlayerRepository } from '../infrastructure/repositories/PlayerRepository.js';
import { isVirtualTestPlayer } from './TestGameService.js';
import type { VotingService } from './VotingService.js';

type VotePanelInput = Readonly<{
  gameId: string;
  phaseVersion: number;
  chatId: string;
  userId: string;
  callbackQueryId?: string;
}>;

export class VotePanelService {
  public constructor(
    private readonly votingService: VotingService,
    private readonly playerRepository: PlayerRepository,
    private readonly ephemeralAdapter: TelegramEphemeralAdapter,
    private readonly logger: AppLogger,
  ) {}

  public async openPanel(input: VotePanelInput): Promise<void> {
    const state = await this.votingService.getVotePanelState(input);
    const panel = renderCityVotePanel({ gameId: state.game.id, phaseVersion: state.game.stateVersion, ...state });
    await this.ephemeralAdapter.sendText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      ...(input.callbackQueryId === undefined ? {} : { callbackQueryId: input.callbackQueryId }),
      text: panel.text,
      replyMarkup: panel.replyMarkup,
    });
    this.logger.info({ gameId: state.game.id, phase: state.game.phase, phaseVersion: state.game.stateVersion, confirmed: state.confirmed }, '[FIX:city-vote-panel] Personal city vote panel opened');
  }

  public async refreshPanel(input: VotePanelInput & Readonly<{ ephemeralMessageId: number }>): Promise<void> {
    const state = await this.votingService.getVotePanelState(input);
    const panel = renderCityVotePanel({ gameId: state.game.id, phaseVersion: state.game.stateVersion, ...state });
    await this.ephemeralAdapter.editText({
      chatId: input.chatId,
      receiverUserId: input.userId,
      ephemeralMessageId: input.ephemeralMessageId,
      text: panel.text,
      replyMarkup: panel.replyMarkup,
    });
    this.logger.info({ gameId: state.game.id, phase: state.game.phase, phaseVersion: state.game.stateVersion, confirmed: state.confirmed }, '[FIX:city-vote-panel] Personal city vote panel refreshed');
  }

  public async restorePanel(input: Readonly<{ gameId: string; phaseVersion: number; chatId: string; userId: string }>): Promise<void> {
    await this.openPanel(input);
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[FIX:city-vote-panel] Personal city vote panel restored');
  }

  public async deliverVotePanels(game: Game): Promise<void> {
    if (!['DAY_NOMINATION', 'DAY_VOTE', 'DAY_REVOTE', 'DAY_FINAL_DECISION'].includes(game.phase)) {
      return;
    }
    const recipients = (await this.playerRepository.listAlivePlayers(game.id))
      .filter((player) => !isVirtualTestPlayer(player.userId));
    const deliveries = await Promise.allSettled(recipients.map((player) => this.openPanel({
      gameId: game.id,
      phaseVersion: game.stateVersion,
      chatId: game.chatId,
      userId: player.userId,
    })));
    const failedPanelCount = deliveries.filter((delivery) => delivery.status === 'rejected').length;
    this.logger.info(
      {
        gameId: game.id,
        phase: game.phase,
        phaseVersion: game.stateVersion,
        recipientCount: recipients.length,
        deliveredPanelCount: deliveries.length - failedPanelCount,
        failedPanelCount,
      },
      '[FIX:city-vote-panel] Automatic city vote panels delivered',
    );
  }
}
