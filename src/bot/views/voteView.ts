import type { InlineKeyboardMarkup } from 'grammy/types';

import type { PublicVoteDetail } from '../../domain/game/voteDetails.js';
import type { VoteRoundKind } from '../../domain/game/types.js';
import { encodeVotePanelCallback } from '../callbacks/callbackData.js';

export function renderVoteView(input: Readonly<{
  gameId: string;
  phaseVersion: number;
  kind: VoteRoundKind;
  candidates: readonly Readonly<{ id: string; displayName: string }>[];
  votesCast: number;
  votersTotal: number;
  voteDetails: readonly PublicVoteDetail[];
}>): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: [
      titleForRound(input.kind),
      '',
      promptForRound(input.kind),
      `Подтверждено: ${input.votesCast}/${input.votersTotal}`,
      ...renderVoteDetails(input.voteDetails),
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [[{ text: '🗳️ Открыть моё голосование', callback_data: encodeVotePanelCallback(input.gameId, input.phaseVersion) }]],
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
    `• ${vote.voterDisplayName} → ${vote.targetDisplayName ?? 'пропуск'} ✅`,
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
    case 'NOMINATION': return 'Откройте личную панель, номинируйте игрока и подтвердите выбор. После подтверждения всех раунд завершится сам.';
    case 'PRIMARY': return 'Откройте личную панель, выберите номинанта и подтвердите выбор. Пропуска нет.';
    case 'REVOTE': return 'Откройте личную панель, выберите кандидата ничьей и подтвердите выбор. Пропуска нет.';
    case 'FINAL_DECISION': return 'Откройте личную панель и выберите: казнить всех кандидатов ничьей или оставить всех. Затем подтвердите выбор.';
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'игрок';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}
