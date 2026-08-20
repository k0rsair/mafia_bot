import type { InlineKeyboardMarkup } from 'grammy/types';

import { encodeGameCallback } from '../callbacks/callbackData.js';

export function renderRoleControl(gameId: string, phaseVersion: number): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: [
      '🎭 Роли распределены!',
      'Каждый игрок нажимает кнопку ниже, чтобы открыть скрытую панель прямо в этом чате.',
      '🔒 Ваша роль видна только вам и боту.',
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [[{ text: '🔒 Открыть личную панель', callback_data: encodeGameCallback(gameId, phaseVersion, 'panel') }]],
    },
  };
}

export function renderNightControl(gameId: string, phaseVersion: number): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: '🌙 Ночь наступила. Если у вас есть ночное действие, откройте скрытую панель.',
    replyMarkup: {
      inline_keyboard: [[{ text: '🔒 Открыть личную панель', callback_data: encodeGameCallback(gameId, phaseVersion, 'panel') }]],
    },
  };
}
