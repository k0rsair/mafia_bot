import type { InlineKeyboardMarkup } from 'grammy/types';

import { encodeDonCheckCallback, encodeFinalDecisionCallback, encodeGameCallback, encodeManiacSkipCallback, encodeNightTargetCallback, encodeVoteCallback, encodeVoteConfirmationCallback } from '../callbacks/callbackData.js';
import { DEFAULT_ROLE_DISPLAY_NAMES, type NightActionType, type Role, type RoleDisplayNames, type VoteRoundKind } from '../../domain/game/types.js';

export function renderRolePanel(input: Readonly<{ role: Role; roleDisplayNames?: RoleDisplayNames }>): Readonly<{ text: string }> {
  return {
    text: `${roleDescription(input.role, input.roleDisplayNames ?? DEFAULT_ROLE_DISPLAY_NAMES)}\n\n✅ Получение роли засчитано автоматически.`,
  };
}

export function renderNightPanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ id: string; displayName: string; targetIndex: number }>[];
  actionType?: NightActionType;
  roleDisplayNames?: RoleDisplayNames;
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const choices = input.candidates.map((candidate) =>
    ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeNightTargetCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
    }),
  );

  return {
    text: nightPrompt(input.actionType ?? 'COMMISSIONER_CHECK', input.roleDisplayNames ?? DEFAULT_ROLE_DISPLAY_NAMES),
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

export function renderCityVotePanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  kind: VoteRoundKind;
  candidates: readonly Readonly<{ displayName: string; targetIndex: number }>[];
  selectedChoice: string | null;
  confirmed: boolean;
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const choiceRows = input.kind === 'FINAL_DECISION'
    ? [[
      { text: '⚰️ Казнить всех кандидатов', callback_data: encodeFinalDecisionCallback(input.gameId, input.phaseVersion, 'all-leave') },
      { text: '🕊️ Оставить всех', callback_data: encodeFinalDecisionCallback(input.gameId, input.phaseVersion, 'all-stay') },
    ]]
    : chunk(input.candidates.map((candidate) => ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeVoteCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
    })), 2);
  const confirmationRow = input.selectedChoice !== null && !input.confirmed
    ? [[{ text: '✅ Подтвердить мой выбор', callback_data: encodeVoteConfirmationCallback(input.gameId, input.phaseVersion) }]]
    : [];

  return {
    text: [
      votePanelTitle(input.kind),
      '',
      input.selectedChoice === null ? 'Ваш выбор: —' : `Ваш выбор: ${input.selectedChoice} ${input.confirmed ? '✅' : '⏳'}`,
      '',
      input.confirmed
        ? '✅ Выбор подтверждён и учтён в голосовании.'
        : input.selectedChoice === null
          ? 'Выберите вариант — до подтверждения он никуда не попадёт.'
          : 'Проверьте выбранный вариант и подтвердите его.',
    ].join('\n'),
    replyMarkup: { inline_keyboard: input.confirmed ? [] : [...choiceRows, ...confirmationRow] },
  };
}

export function renderCommissionerResult(displayName: string, isMafia: boolean): string {
  return `🔍 Проверка Шерифа: ${displayName} — ${isMafia ? 'МАФИЯ' : 'не мафия'}.`;
}

export function renderDonCheckResult(displayName: string, isSheriff: boolean): string {
  return `👑 Проверка Дона: ${displayName} — ${isSheriff ? 'ШЕРИФ' : 'не шериф'}.`;
}

export function renderDonCheckPanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ displayName: string; targetIndex: number }>[];
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: '👑 Отдельная проверка Дона: выберите живого игрока, кроме себя. Результат увидите только вы.',
    replyMarkup: { inline_keyboard: chunk(input.candidates.map((candidate) => ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeDonCheckCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
    })), 2) },
  };
}

export function renderManiacPanel(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  candidates: readonly Readonly<{ displayName: string; targetIndex: number }>[];
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: '🔪 Выберите жертву или пропустите ход. Выбор окончательный.',
    replyMarkup: {
      inline_keyboard: [
        ...chunk(input.candidates.map((candidate) => ({
          text: candidate.displayName.slice(0, 48),
          callback_data: encodeNightTargetCallback(input.gameId, input.phaseVersion, candidate.targetIndex),
        })), 2),
        [{ text: '🤫 Пропустить ход', callback_data: encodeManiacSkipCallback(input.gameId, input.phaseVersion) }],
      ],
    },
  };
}

export function renderNightActionBlocked(): string {
  return '⛔ Ваше личное ночное действие заблокировано. Дождитесь рассвета.';
}

export function renderNoNightAction(): string {
  return '🌙 Ночью у вашей роли нет действия. Дождитесь рассвета.';
}

function roleDescription(role: Role, roleDisplayNames: RoleDisplayNames): string {
  switch (role) {
    case 'MAFIA':
      return '🕶️ Ваша роль: МАФИЯ\nНочью откройте скрытую панель и выберите жертву. Днём не выдавайте себя.';
    case 'COMMISSIONER':
      return '🔍 Ваша роль: ШЕРИФ\nНочью проверьте одного другого живого игрока. Ответ увидите только вы.';
    case 'DOCTOR':
      return '💉 Ваша роль: ДОКТОР\nНочью лечите одного игрока от выстрела мафии. Нельзя лечить одну цель две ночи подряд; себя — только один раз за игру.';
    case 'CIVILIAN':
      return '🕊️ Ваша роль: МИРНЫЙ ЖИТЕЛЬ\nОбсуждайте днём и голосуйте. Ночью действия нет.';
    case 'DON':
      return '👑 Ваша роль: ДОН\nНочью участвуйте в совете мафии и проверяйте одного игрока на Шерифа.';
    case 'PROSTITUTE':
      return `💋 Ваша роль: ${roleDisplayNames.prostitute.toLocaleUpperCase('ru')}\nВы действуете первой: выберите живого игрока, кроме себя. Нельзя приходить к одной цели две ночи подряд.`;
    case 'MANIAC':
      return '🔪 Ваша роль: МАНЬЯК\nНочью выберите жертву или пропустите ход. Вы играете один.';
  }
}

function nightPrompt(actionType: NightActionType, roleDisplayNames: RoleDisplayNames): string {
  switch (actionType) {
    case 'PROSTITUTE_VISIT':
      return `💋 Вы действуете первой как ${roleDisplayNames.prostitute}. Выберите живого игрока, кроме себя. Нельзя ходить к одному человеку две ночи подряд.`;
    case 'DOCTOR_SAVE':
      return '💉 Выберите, кого лечить. Одного человека нельзя лечить две ночи подряд; себя можно лечить один раз за игру.';
    case 'COMMISSIONER_CHECK':
      return '🔍 Выберите живого игрока для проверки. Результат увидите только вы.';
    case 'MANIAC_KILL':
      return '🔪 Выберите живую жертву. Выбор окончательный.';
    case 'MAFIA_KILL':
      return '🕶️ Выберите цель совета мафии.';
    case 'DON_CHECK':
      return '👑 Выберите игрока для проверки Дона.';
    case 'MANIAC_SKIP':
      return '🤫 Пропустите ход Маньяка.';
  }
}

function votePanelTitle(kind: VoteRoundKind): string {
  switch (kind) {
    case 'NOMINATION': return '📣 Ваша номинация';
    case 'PRIMARY': return '🗳️ Ваш голос';
    case 'REVOTE': return '🗳️ Ваш голос в ревоте';
    case 'FINAL_DECISION': return '⚖️ Ваше финальное решение';
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
