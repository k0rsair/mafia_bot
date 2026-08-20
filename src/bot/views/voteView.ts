import type { InlineKeyboardMarkup } from 'grammy/types';

import { encodeVoteCallback } from '../callbacks/callbackData.js';

export function renderVoteView(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ id: string; displayName: string }>[];
  votesCast: number;
  votersTotal: number;
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const choices = input.candidates.map((candidate, targetIndex) =>
    ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeVoteCallback(input.gameId, input.phaseVersion, targetIndex),
    }),
  );

  return {
    text: ['🗳️ Дневное голосование', '', 'Выберите игрока или пропустите голосование.', `Голоса: ${input.votesCast}/${input.votersTotal}`].join('\n'),
    replyMarkup: {
      inline_keyboard: [...chunk(choices, 2), [{ text: '🤝 Пропустить', callback_data: encodeVoteCallback(input.gameId, input.phaseVersion, null) }]],
    },
  };
}

export function renderVoteOutcome(input: Readonly<{ outcome: 'ELIMINATION' | 'SKIP' | 'TIE' | 'NO_VOTES'; eliminatedDisplayName?: string }>): string {
  if (input.outcome === 'ELIMINATION') {
    return `⚰️ По итогам голосования выбыл игрок: ${input.eliminatedDisplayName ?? 'неизвестный игрок'}.`;
  }
  if (input.outcome === 'TIE') {
    return '🤝 Голоса разделились поровну. Сегодня никто не выбывает.';
  }
  if (input.outcome === 'SKIP') {
    return '🤝 Большинство выбрало пропуск. Сегодня никто не выбывает.';
  }
  return '🤝 Голосов не было. Сегодня никто не выбывает.';
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
