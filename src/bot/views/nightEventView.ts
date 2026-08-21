type NightEventInput = Readonly<{
  gameId: string;
  phaseVersion: number;
  eliminatedDisplayName: string | null;
  savedDisplayName: string | null;
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
  if (input.eliminatedDisplayName !== null) {
    return selectMessage(ELIMINATION_MESSAGES, input, input.eliminatedDisplayName, 'elimination');
  }
  if (input.savedDisplayName !== null) {
    return selectMessage(RESCUE_MESSAGES, input, input.savedDisplayName, 'rescue');
  }
  return selectMessage(QUIET_NIGHT_MESSAGES, input, undefined, 'quiet');
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
