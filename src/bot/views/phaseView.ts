import type { InlineKeyboardMarkup } from 'grammy/types';

export function renderRoleControl(): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: [
      '🎭 Роли распределены!',
      'Личные панели с ролями отправлены игрокам автоматически прямо в этот чат.',
      '🔒 Ваша роль видна только вам и боту.',
      'Если панель не появилась, используйте /restore_panel.',
    ].join('\n'),
    replyMarkup: { inline_keyboard: [] },
  };
}

export function renderNightControl(): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: '🌙 Ночь наступила. Игроки с ночными действиями получили личные панели автоматически. Если панель не появилась, используйте /restore_panel.',
    replyMarkup: { inline_keyboard: [] },
  };
}

export function renderProstituteNightControl(): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: '🌙 Ночная очередь началась. Личная панель Шлюхи отправлена автоматически; после её действия откроются остальные ночные панели.',
    replyMarkup: { inline_keyboard: [] },
  };
}
