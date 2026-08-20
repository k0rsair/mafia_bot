import type { InlineKeyboardMarkup } from 'grammy/types';

import { encodeLobbyCallback } from '../callbacks/callbackData.js';

type LobbyViewPlayer = Readonly<{
  displayName: string;
}>;

type LobbyViewInput = Readonly<{
  gameId: string;
  players: readonly LobbyViewPlayer[];
  maxPlayers: number;
}>;

export function renderLobby(input: LobbyViewInput): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const playerList = input.players.length === 0
    ? 'Пока никого — станьте первым игроком!'
    : input.players.map((player, index) => `${index + 1}. ${player.displayName}`).join('\n');

  return {
    text: [
      '🎭 Лобби «Мафии» открыто',
      '',
      `👥 Игроки: ${input.players.length}/${input.maxPlayers}`,
      playerList,
      '',
      'Нажмите «Участвовать», а организатор запустит игру командой /startgame.',
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '✅ Участвовать', callback_data: encodeLobbyCallback(input.gameId, 'join') },
          { text: '🚪 Выйти', callback_data: encodeLobbyCallback(input.gameId, 'leave') },
        ],
        [{ text: '▶️ Начать игру', callback_data: encodeLobbyCallback(input.gameId, 'start') }],
      ],
    },
  };
}
