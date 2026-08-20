import type { InlineKeyboardMarkup } from 'grammy/types';

import { encodeGameCallback } from '../callbacks/callbackData.js';
import { encodeNightTargetCallback } from '../callbacks/callbackData.js';
import type { Role } from '../../domain/game/types.js';

export function renderRolePanel(input: Readonly<{ gameId: string; phaseVersion: number; role: Role }>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: roleDescription(input.role),
    replyMarkup: {
      inline_keyboard: [[{ text: '✅ Роль получена', callback_data: encodeGameCallback(input.gameId, input.phaseVersion, 'confirm') }]],
    },
  };
}

export function renderRoleConfirmation(): string {
  return '✅ Роль подтверждена. Дождитесь, пока остальные игроки откроют свои панели.';
}

export function renderNightPanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ id: string; displayName: string; targetIndex: number }>[];
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const choices = input.candidates.map((candidate) =>
    ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeNightTargetCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
    }),
  );

  return {
    text: '🌙 Выберите цель ночного действия. До конца ночи выбор можно изменить.',
    replyMarkup: { inline_keyboard: chunk(choices, 2) },
  };
}

export function renderMafiaCouncilPanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ displayName: string; targetIndex: number }>[];
  selections: readonly Readonly<{ actorDisplayName: string; targetDisplayName: string; confirmed: boolean }>[];
  hasOwnDraft: boolean;
  ownDraftConfirmed: boolean;
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const selectionLines = input.selections.length === 0
    ? ['Пока никто не выбрал цель.']
    : input.selections.map((selection) => `• ${selection.actorDisplayName} → ${selection.targetDisplayName} ${selection.confirmed ? '✅' : '⏳'}`);
  const targetRows = chunk(input.candidates.map((candidate) => ({
    text: candidate.displayName.slice(0, 48),
    callback_data: encodeNightTargetCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
  })), 2);
  const confirmationRow = input.hasOwnDraft && !input.ownDraftConfirmed
    ? [[{ text: '✅ Подтвердить мой выбор', callback_data: encodeGameCallback(input.gameId, input.phaseVersion, 'mafia-confirm') }]]
    : [];
  const refreshRow = [[{ text: '🔄 Обновить совет мафии', callback_data: encodeGameCallback(input.gameId, input.phaseVersion, 'panel') }]];

  return {
    text: [
      '🕶️ Совет мафии',
      'Выберите цель как черновик, обсудите выборы и подтвердите свой голос.',
      '',
      'Выборы мафии:',
      ...selectionLines,
      '',
      input.ownDraftConfirmed
        ? '✅ Ваш голос подтверждён. Новая цель снова сделает его черновиком.'
        : '⏳ Убийство учитывает только подтверждённые голоса.',
    ].join('\n'),
    replyMarkup: { inline_keyboard: [...targetRows, ...confirmationRow, ...refreshRow] },
  };
}

export function renderNightChoiceAccepted(): string {
  return '✅ Ночной выбор принят. До конца ночи его можно изменить из панели.';
}

export function renderCommissionerResult(displayName: string, isMafia: boolean): string {
  return `🔍 Проверка этой ночью: ${displayName} — ${isMafia ? 'МАФИЯ' : 'не мафия'}.`;
}

export function renderNoNightAction(): string {
  return '🌙 Ночью у вашей роли нет действия. Дождитесь рассвета.';
}

function roleDescription(role: Role): string {
  switch (role) {
    case 'MAFIA':
      return '🕶️ Ваша роль: МАФИЯ\nНочью откройте скрытую панель и выберите жертву. Днём не выдавайте себя.';
    case 'COMMISSIONER':
      return '🔍 Ваша роль: КОМИССАР\nНочью проверьте одного другого живого игрока. Ответ увидите только вы.';
    case 'DOCTOR':
      return '💉 Ваша роль: ДОКТОР\nНочью выберите, кого спасти. Себя спасать разрешено.';
    case 'CIVILIAN':
      return '🕊️ Ваша роль: МИРНЫЙ ЖИТЕЛЬ\nОбсуждайте днём и голосуйте. Ночью действия нет.';
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
