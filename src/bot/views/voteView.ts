import type { InlineKeyboardMarkup } from 'grammy/types';

import type { PublicVoteDetail } from '../../domain/game/voteDetails.js';
import type { VoteRoundKind } from '../../domain/game/types.js';
import { encodeFinalDecisionCallback, encodeVoteCallback } from '../callbacks/callbackData.js';

export function renderVoteView(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  kind: VoteRoundKind;
  candidates: readonly Readonly<{ id: string; displayName: string }>[];
  votesCast: number;
  votersTotal: number;
  voteDetails: readonly PublicVoteDetail[];
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  const choices = input.candidates.map((candidate, targetIndex) =>
    ({
      text: candidate.displayName.slice(0, 48),
      callback_data: encodeVoteCallback(input.gameId, input.phaseVersion, targetIndex),
    }),
  );

  const isFinalDecision = input.kind === 'FINAL_DECISION';
  return {
    text: [
      titleForRound(input.kind),
      '',
      promptForRound(input.kind),
      `Голоса: ${input.votesCast}/${input.votersTotal}`,
      ...renderVoteDetails(input.voteDetails),
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: isFinalDecision
        ? [[
          { text: '⚰️ Казнить всех кандидатов', callback_data: encodeFinalDecisionCallback(input.gameId, input.phaseVersion, 'all-leave') },
          { text: '🕊️ Оставить всех', callback_data: encodeFinalDecisionCallback(input.gameId, input.phaseVersion, 'all-stay') },
        ]]
        : chunk(choices, 2),
    },
  };
}

export function renderVoteOutcome(input: Readonly<{ outcome: 'ELIMINATION' | 'SKIP' | 'TIE' | 'NO_VOTES'; kind?: VoteRoundKind; eliminatedDisplayNames?: readonly string[]; eliminatedDisplayName?: string; alibiedDisplayNames?: readonly string[] }>): string {
  const eliminatedDisplayNames = input.eliminatedDisplayNames ?? (input.eliminatedDisplayName === undefined ? [] : [input.eliminatedDisplayName]);
  const alibiText = input.alibiedDisplayNames === undefined || input.alibiedDisplayNames.length === 0
    ? ''
    : `\n🪪 Алиби подтверждено: ${joinNames(input.alibiedDisplayNames)} остаётся в игре.`;
  if (input.outcome === 'ELIMINATION') {
    const elimination = eliminatedDisplayNames.length === 0
      ? '⚰️ Решение города не привело к выбытию.'
      : `⚰️ По итогам голосования выбывает: ${joinNames(eliminatedDisplayNames)}.`;
    return `${elimination}${alibiText}`;
  }
  if (input.outcome === 'TIE') {
    return '🤝 Голоса разделились поровну. Сегодня никто не выбывает.';
  }
  if (input.outcome === 'SKIP') {
    if (input.kind === 'FINAL_DECISION') {
      return '🕊️ Город решил оставить всех кандидатов ничьей.';
    }
    return '🤝 Большинство выбрало пропуск. Сегодня никто не выбывает.';
  }
  return '🤝 Голосов не было. Сегодня никто не выбывает.';
}

export function renderClosedVoteView(input: Readonly<{
  outcome: 'ELIMINATION' | 'SKIP' | 'TIE' | 'NO_VOTES';
  kind?: VoteRoundKind;
  eliminatedDisplayName?: string;
  eliminatedDisplayNames?: readonly string[];
  alibiedDisplayNames?: readonly string[];
  voteDetails?: readonly PublicVoteDetail[];
}>): string {
  return [
    '🗳️ Дневное голосование завершено.',
    ...renderVoteDetails(input.voteDetails ?? []),
    '',
    'Результат:',
    renderVoteOutcome(input),
  ].join('\n');
}

function renderVoteDetails(voteDetails: readonly PublicVoteDetail[]): string[] {
  if (voteDetails.length === 0) {
    return [];
  }
  return ['', 'Кто за кого:', ...voteDetails.map((vote) =>
    `• ${vote.voterDisplayName} → ${vote.targetDisplayName ?? 'пропуск'}`,
  )];
}

function titleForRound(kind: VoteRoundKind): string {
  switch (kind) {
    case 'NOMINATION': return '📣 Номинации города';
    case 'PRIMARY': return '🗳️ Основное городское голосование';
    case 'REVOTE': return '🗳️ Повторное голосование';
    case 'FINAL_DECISION': return '⚖️ Финальное решение города';
  }
}

function promptForRound(kind: VoteRoundKind): string {
  switch (kind) {
    case 'NOMINATION': return 'Номинируйте одного игрока. Организатор закроет этап номинаций.';
    case 'PRIMARY': return 'Выберите одного из номинированных игроков. Пропуска нет.';
    case 'REVOTE': return 'Выберите одного из кандидатов ничьей. Пропуска нет.';
    case 'FINAL_DECISION': return 'Город выбирает: казнить всех кандидатов ничьей или оставить всех.';
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'игрок';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
