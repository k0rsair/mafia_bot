type NightEventInput = Readonly<{
  gameId: string;
  phaseVersion: number;
  eliminatedDisplayNames?: readonly string[];
  savedDisplayNames?: readonly string[];
  eliminatedDisplayName?: string | null;
  savedDisplayName?: string | null;
  eliminatedManiacDisplayName?: string | null;
}>;

const ELIMINATION_MESSAGES = [
  (name: string) => `🌅 Кровавый рассвет. На площади нашли ${name} — ночь забрала ещё одного жителя.`,
  (name: string) => `🌫️ Туман рассеялся слишком поздно: следы ночной расправы привели к ${name}. Город потерял жителя.`,
  (name: string) => `🕯️ Утро началось с тяжёлой находки. ${name} не пережил эту ночь, а мафия вновь ушла в тень.`,
  (name: string) => `🚨 Сирены разорвали тишину на рассвете. ${name} стал жертвой ночной охоты.`,
  (name: string) => `🌒 Ночь не пощадила город: ${name} найден без признаков жизни. Пора искать виновных.`,
];

const RESCUE_MESSAGES = [
  (name: string) => `🩺 За ${name} этой ночью пришли, но кто-то успел вытащить его из беды. Мафия осталась ни с чем.`,
  (name: string) => `🚑 Ночной налёт почти удался, но ${name} встретил рассвет живым. Чья-то помощь оказалась быстрее.`,
  (name: string) => `🕯️ ${name} был на волосок от смерти, однако ночной спаситель успел вовремя. Сегодня город без потерь.`,
  (name: string) => `🌤️ Ночь пыталась забрать ${name}, но рассвет он увидел. Мафия промахнулась.`,
];

const QUIET_NIGHT_MESSAGES = [
  '🌫️ Ночной туман скрыл все следы. К рассвету все жители на месте.',
  '🌤️ Рассвет наступил без тревожных находок. Эта ночь обошлась городу без жертв.',
  '🌙 Мафия растворилась во тьме, не оставив городу потерь. Но тишина может быть обманчивой.',
  '🕯️ Утро принесло только тревожное молчание: никто не выбыл этой ночью.',
];

export function renderNightEvent(input: NightEventInput): string {
  const eliminatedDisplayNames = input.eliminatedDisplayNames ?? (input.eliminatedDisplayName === null || input.eliminatedDisplayName === undefined ? [] : [input.eliminatedDisplayName]);
  const savedDisplayNames = input.savedDisplayNames ?? (input.savedDisplayName === null || input.savedDisplayName === undefined ? [] : [input.savedDisplayName]);
  if (eliminatedDisplayNames.length > 0) {
    const elimination = eliminatedDisplayNames.length === 1
      ? selectMessage(ELIMINATION_MESSAGES, input, eliminatedDisplayNames[0], 'elimination')
      : `🌅 Кровавый рассвет. Ночь забрала жителей: ${joinNames(eliminatedDisplayNames)}.`;
    const rescue = savedDisplayNames.length > 0 ? `\n🩺 ${savedSummary(savedDisplayNames)}` : '';
    const maniacReveal = input.eliminatedManiacDisplayName === null || input.eliminatedManiacDisplayName === undefined
      ? ''
      : `\n🔪 Среди погибших был Маньяк — ${input.eliminatedManiacDisplayName}. Его роль раскрыта.`;
    return `${elimination}${rescue}${maniacReveal}`;
  }
  if (savedDisplayNames.length > 0) {
    return savedDisplayNames.length === 1
      ? selectMessage(RESCUE_MESSAGES, input, savedDisplayNames[0], 'rescue')
      : `🩺 Ночной налёт не удался: ${joinNames(savedDisplayNames)} встретили рассвет живыми. Чья-то помощь оказалась быстрее.`;
  }
  return selectMessage(QUIET_NIGHT_MESSAGES, input, undefined, 'quiet');
}

function savedSummary(names: readonly string[]): string {
  return names.length === 1
    ? `${names[0]} встретил рассвет живым благодаря своевременной помощи.`
    : `${joinNames(names)} встретили рассвет живыми благодаря своевременной помощи.`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'житель';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

function selectMessage(
  messages: readonly ((name: string) => string)[] | readonly string[],
  input: NightEventInput,
  displayName: string | undefined,
  eventKind: string,
): string {
  const index = stableIndex(`${input.gameId}:${input.phaseVersion}:${eventKind}:${displayName ?? ''}`, messages.length);
  const message = messages[index];
  if (message === undefined) {
    throw new Error('Night event message list must not be empty');
  }
  return typeof message === 'string' ? message : message(displayName ?? 'житель');
}

function stableIndex(seed: string, length: number): number {
  let hash = 0;
  for (const character of seed) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash % length;
}
