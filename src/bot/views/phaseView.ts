import type { InlineKeyboardMarkup } from 'grammy/types';
import { DEFAULT_ROLE_DISPLAY_NAMES, type RoleDisplayNames } from '../../domain/game/types.js';

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

export function renderProstituteNightControl(roleDisplayNames: RoleDisplayNames = DEFAULT_ROLE_DISPLAY_NAMES): Readonly<{ text: string; replyMarkup: InlineKeyboardMarkup }> {
  return {
    text: `🌙 Ночная очередь началась. Личная панель роли «${roleDisplayNames.prostitute}» отправлена автоматически; после её действия откроются остальные ночные панели.`,
    replyMarkup: { inline_keyboard: [] },
  };
}
