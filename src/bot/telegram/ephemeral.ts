import type { InlineKeyboardMarkup } from 'grammy/types';

import type { AppLogger } from '../../observability/logger.js';

type EphemeralPayload = Readonly<{
  chatId: string;
  receiverUserId: string;
  text: string;
  callbackQueryId?: string;
  replyMarkup?: InlineKeyboardMarkup;
}>;

type EphemeralMessage = Readonly<{
  ephemeral_message_id: number;
}>;

type TelegramApiResponse<T> = Readonly<{
  ok: boolean;
  result?: T;
  description?: string;
}>;

export class TelegramEphemeralError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TelegramEphemeralError';
  }
}

export class TelegramEphemeralAdapter {
  public constructor(
    private readonly botToken: string,
    private readonly logger: AppLogger,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async sendText(payload: EphemeralPayload): Promise<EphemeralMessage> {
    this.logger.debug(
      { chatId: payload.chatId, receiverUserId: payload.receiverUserId, hasCallbackQuery: Boolean(payload.callbackQueryId) },
      '[TelegramEphemeralAdapter.sendText] Sending ephemeral panel',
    );

    return this.callApi<EphemeralMessage>('sendMessage', {
      chat_id: payload.chatId,
      receiver_user_id: toSafeTelegramId(payload.receiverUserId),
      text: payload.text,
      ...(payload.callbackQueryId === undefined ? {} : { callback_query_id: payload.callbackQueryId }),
      ...(payload.replyMarkup === undefined ? {} : { reply_markup: payload.replyMarkup }),
    });
  }

  public async editText(input: Readonly<{
    chatId: string;
    receiverUserId: string;
    ephemeralMessageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }>): Promise<void> {
    this.logger.debug(
      { chatId: input.chatId, receiverUserId: input.receiverUserId, ephemeralMessageId: input.ephemeralMessageId },
      '[TelegramEphemeralAdapter.editText] Editing ephemeral panel',
    );

    await this.callApi<boolean>('editEphemeralMessageText', {
      chat_id: input.chatId,
      receiver_user_id: toSafeTelegramId(input.receiverUserId),
      ephemeral_message_id: input.ephemeralMessageId,
      text: input.text,
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
    });
  }

  public async deleteEphemeralMessage(input: Readonly<{
    chatId: string;
    receiverUserId: string;
    ephemeralMessageId: number;
  }>): Promise<void> {
    this.logger.debug(
      { chatId: input.chatId, receiverUserId: input.receiverUserId },
      '[TelegramEphemeralAdapter.deleteEphemeralMessage] Deleting ephemeral panel',
    );

    await this.callApi<boolean>('deleteEphemeralMessage', {
      chat_id: input.chatId,
      receiver_user_id: toSafeTelegramId(input.receiverUserId),
      ephemeral_message_id: input.ephemeralMessageId,
    });
  }

  private async callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImplementation(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      const description = payload.description ?? `HTTP ${response.status}`;
      this.logger.error({ method, status: response.status, description }, '[TelegramEphemeralAdapter.callApi] Telegram API call failed');
      throw new TelegramEphemeralError(`${method} failed: ${description}`);
    }

    this.logger.debug({ method }, '[TelegramEphemeralAdapter.callApi] Telegram API call succeeded');
    return payload.result;
  }
}

function toSafeTelegramId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TelegramEphemeralError('Telegram user ID must be a positive safe integer');
  }

  return parsed;
}
