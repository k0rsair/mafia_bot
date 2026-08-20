import type { Game } from '@prisma/client';

export class CallbackGuardError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CallbackGuardError';
  }
}

/** Validates immutable callback context before a game action is persisted. */
export class CallbackGuardService {
  public assertGameChat(game: Pick<Game, 'chatId'>, actualChatId: string): void {
    if (game.chatId !== actualChatId) {
      throw new CallbackGuardError('Эта кнопка принадлежит другому игровому чату.');
    }
  }
}
