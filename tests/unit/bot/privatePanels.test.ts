import { describe, expect, it } from 'vitest';

import { CallbackGuardError, CallbackGuardService } from '../../../src/application/CallbackGuardService.js';
import { encodeGameCallback, encodeNightTargetCallback, encodeVoteCallback, encodeVoteConfirmationCallback, parseGameCallback, parseVoteCallback } from '../../../src/bot/callbacks/callbackData.js';
import { TelegramEphemeralAdapter } from '../../../src/bot/telegram/ephemeral.js';
import { renderNightPanel, renderRolePanel } from '../../../src/bot/views/ephemeralPanelView.js';
import { renderRoleControl } from '../../../src/bot/views/phaseView.js';
import { createLogger } from '../../../src/observability/logger.js';

describe('group-only private panels', () => {
  it('sends a panel with receiver_user_id while keeping the group control neutral', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: { ephemeral_message_id: 42 } }), { status: 200 });
    };
    const adapter = new TelegramEphemeralAdapter('1234567890:token-value', createLogger({ logLevel: 'silent' }), mockFetch);

    await expect(adapter.sendText({
      chatId: '-100123',
      receiverUserId: '12345',
      callbackQueryId: 'callback-id',
      text: '🔍 Ваша роль: КОМИССАР',
    })).resolves.toEqual({ ephemeral_message_id: 42 });

    expect(requestBody).toMatchObject({ chat_id: '-100123', receiver_user_id: 12345, callback_query_id: 'callback-id' });
    const groupControl = renderRoleControl();
    expect(groupControl.text).not.toMatch(/МАФИЯ|КОМИССАР|ДОКТОР|МИРНЫЙ/i);
    expect(JSON.stringify(groupControl.replyMarkup)).not.toContain('MAFIA');
  });

  it('deletes an ephemeral panel for its receiver', async () => {
    let endpoint = '';
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch: typeof fetch = async (input, init) => {
      endpoint = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };
    const adapter = new TelegramEphemeralAdapter('1234567890:token-value', createLogger({ logLevel: 'silent' }), mockFetch);

    await expect(adapter.deleteEphemeralMessage({
      chatId: '-100123',
      receiverUserId: '12345',
      ephemeralMessageId: 42,
    })).resolves.toBeUndefined();

    expect(endpoint).toContain('/deleteEphemeralMessage');
    expect(requestBody).toEqual({ chat_id: '-100123', receiver_user_id: 12345, ephemeral_message_id: 42 });
  });

  it('rejects a callback replayed from another group', () => {
    const guard = new CallbackGuardService();
    expect(() => guard.assertGameChat({ chatId: '-100123' }, '-100456')).toThrow(CallbackGuardError);
  });

  it('keeps candidate callbacks below Telegram’s 64-byte limit without exposing a player ID', () => {
    const gameId = 'ck7qj6v0m0000g2l9h8a4n2x1';
    const nightCallback = encodeNightTargetCallback(gameId, 123_456, 19);
    const voteCallback = encodeVoteCallback(gameId, 123_456, 19);

    expect(Buffer.byteLength(nightCallback, 'utf8')).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(voteCallback, 'utf8')).toBeLessThanOrEqual(64);
    expect(parseGameCallback(nightCallback)).toMatchObject({ action: 'target', targetIndex: 19 });
    expect(parseVoteCallback(voteCallback)).toMatchObject({ action: 'candidate', targetIndex: 19 });
  });

  it('supports a separate confirmation callback for a mafia draft', () => {
    const callback = encodeGameCallback('game-id', 2, 'mafia-confirm');

    expect(parseGameCallback(callback)).toMatchObject({
      kind: 'game',
      gameId: 'game-id',
      phaseVersion: 2,
      action: 'mafia-confirm',
    });
  });

  it('supports a separate confirmation callback for a city vote draft', () => {
    const callback = encodeVoteConfirmationCallback('game-id', 2);

    expect(parseVoteCallback(callback)).toMatchObject({
      kind: 'vote',
      gameId: 'game-id',
      phaseVersion: 2,
      action: 'confirm',
    });
  });

  it('does not render a second confirmation control after showing a role', () => {
    const panel = renderRolePanel({ role: 'CIVILIAN' });

    expect(panel.text).toContain('Получение роли засчитано автоматически');
    expect(panel).not.toHaveProperty('replyMarkup');
    expect(JSON.stringify(panel)).not.toContain('confirm');
  });

  it('preserves the original alive-player index when a role filters its target list', () => {
    const panel = renderNightPanel({
      gameId: 'game-id',
      phaseVersion: 2,
      candidates: [{ id: 'player-3', displayName: 'Игрок 3', targetIndex: 2 }],
    });
    const button = panel.replyMarkup.inline_keyboard[0]?.[0];
    const callbackData = button !== undefined && 'callback_data' in button ? button.callback_data : undefined;

    expect(parseGameCallback(callbackData ?? '')).toMatchObject({ action: 'target', targetIndex: 2 });
  });
});
