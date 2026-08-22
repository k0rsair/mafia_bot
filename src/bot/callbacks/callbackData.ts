export type LobbyCallbackAction = 'join' | 'leave' | 'start';

export type GameCallbackAction = 'panel' | 'confirm' | 'mafia-confirm' | 'target' | 'don-check' | 'maniac-skip';

export type GameCallback = Readonly<{
  kind: 'game';
  gameId: string;
  phaseVersion: number;
  action: GameCallbackAction;
  targetIndex?: number;
}>;

export type VoteCallback = Readonly<{
  kind: 'vote';
  gameId: string;
  phaseVersion: number;
  action: 'candidate' | 'confirm' | 'all-leave' | 'all-stay';
  targetIndex?: number;
}>;

export type LobbyCallback = Readonly<{
  kind: 'lobby';
  gameId: string;
  action: LobbyCallbackAction;
}>;

export function encodeLobbyCallback(gameId: string, action: LobbyCallbackAction): string {
  return `l:${gameId}:${action}`;
}

export function parseLobbyCallback(value: string): LobbyCallback | null {
  const [kind, gameId, action, extra] = value.split(':');
  if (kind !== 'lobby' && kind !== 'l') {
    return null;
  }

  if (gameId === undefined || extra !== undefined || !isLobbyAction(action)) {
    return null;
  }

  return { kind: 'lobby', gameId, action };
}

export function encodeGameCallback(gameId: string, phaseVersion: number, action: GameCallbackAction): string {
  if (action === 'target') {
    throw new Error('A target callback requires a target player ID');
  }

  return `g:${gameId}:${phaseVersion.toString(36)}:${action}`;
}

export function encodeNightTargetCallback(gameId: string, phaseVersion: number, targetIndex: number): string {
  return `g:${gameId}:${phaseVersion.toString(36)}:target:${encodeTargetIndex(targetIndex)}`;
}

export function encodeDonCheckCallback(gameId: string, phaseVersion: number, targetIndex: number): string {
  return `g:${gameId}:${phaseVersion.toString(36)}:don-check:${encodeTargetIndex(targetIndex)}`;
}

export function encodeManiacSkipCallback(gameId: string, phaseVersion: number): string {
  return encodeGameCallback(gameId, phaseVersion, 'maniac-skip');
}

export function parseGameCallback(value: string): GameCallback | null {
  const [kind, gameId, phaseVersionValue, action, targetIndexValue, extra] = value.split(':');
  const phaseVersion = phaseVersionValue === undefined ? Number.NaN : Number.parseInt(phaseVersionValue, 36);
  if (kind !== 'g' || gameId === undefined || extra !== undefined || !isGameAction(action) || !Number.isSafeInteger(phaseVersion) || phaseVersion < 1) {
    return null;
  }

  const needsTarget = action === 'target' || action === 'don-check';
  if (!needsTarget && targetIndexValue !== undefined) {
    return null;
  }

  if (needsTarget) {
    const targetIndex = parseTargetIndex(targetIndexValue);
    return targetIndex === null ? null : { kind: 'game', gameId, phaseVersion, action, targetIndex };
  }

  return { kind: 'game', gameId, phaseVersion, action };
}

export function encodeVoteCallback(gameId: string, phaseVersion: number, targetIndex: number): string {
  return `v:${gameId}:${phaseVersion.toString(36)}:candidate:${encodeTargetIndex(targetIndex)}`;
}

export function encodeFinalDecisionCallback(gameId: string, phaseVersion: number, action: 'all-leave' | 'all-stay'): string {
  return `v:${gameId}:${phaseVersion.toString(36)}:${action}`;
}

export function encodeVoteConfirmationCallback(gameId: string, phaseVersion: number): string {
  return `v:${gameId}:${phaseVersion.toString(36)}:confirm`;
}

export function parseVoteCallback(value: string): VoteCallback | null {
  const [kind, gameId, phaseVersionValue, action, targetIndexValue, extra] = value.split(':');
  const phaseVersion = phaseVersionValue === undefined ? Number.NaN : Number.parseInt(phaseVersionValue, 36);
  if (kind !== 'v' || gameId === undefined || extra !== undefined || !Number.isSafeInteger(phaseVersion) || phaseVersion < 1) {
    return null;
  }

  const targetIndex = action === 'candidate' ? parseTargetIndex(targetIndexValue) : undefined;
  if (action === 'candidate' && targetIndex !== null && targetIndex !== undefined) {
    return { kind: 'vote', gameId, phaseVersion, action, targetIndex };
  }
  if ((action === 'confirm' || action === 'all-leave' || action === 'all-stay') && targetIndexValue === undefined) {
    return { kind: 'vote', gameId, phaseVersion, action };
  }

  return null;
}

function isLobbyAction(value: string | undefined): value is LobbyCallbackAction {
  return value === 'join' || value === 'leave' || value === 'start';
}

function isGameAction(value: string | undefined): value is GameCallbackAction {
  return value === 'panel' || value === 'confirm' || value === 'mafia-confirm' || value === 'target' || value === 'don-check' || value === 'maniac-skip';
}

function encodeTargetIndex(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('Target index must be a non-negative safe integer');
  }
  return index.toString(36);
}

function parseTargetIndex(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9a-z]+$/.test(value)) {
    return null;
  }
  const index = Number.parseInt(value, 36);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}
