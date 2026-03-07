export interface SyncDelayRange {
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
}

export interface LegacySyncDelayInput {
  accountSyncMinSeconds?: number | null;
  accountSyncMaxSeconds?: number | null;
  accountSyncSeconds?: number | null;
}

const DEFAULT_MIN_SECONDS = 3;
const DEFAULT_MAX_SECONDS = 5;
const MIN_ALLOWED_SECONDS = 1;
const MAX_ALLOWED_SECONDS = 30;

function normalizeSingleDelaySeconds(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(Number(value));
  if (parsed < MIN_ALLOWED_SECONDS) {
    return MIN_ALLOWED_SECONDS;
  }
  if (parsed > MAX_ALLOWED_SECONDS) {
    return MAX_ALLOWED_SECONDS;
  }
  return parsed;
}

export function normalizeSyncDelayRange(
  input?: LegacySyncDelayInput | null,
  defaults?: Partial<SyncDelayRange> | null
): SyncDelayRange {
  const defaultMin = normalizeSingleDelaySeconds(defaults?.accountSyncMinSeconds, DEFAULT_MIN_SECONDS);
  const defaultMaxSeed = defaults?.accountSyncMaxSeconds ?? Math.max(defaultMin, DEFAULT_MAX_SECONDS);
  const defaultMax = normalizeSingleDelaySeconds(defaultMaxSeed, Math.max(defaultMin, DEFAULT_MAX_SECONDS));

  const legacyValue = Number.isFinite(input?.accountSyncSeconds as number)
    ? normalizeSingleDelaySeconds(input?.accountSyncSeconds, defaultMin)
    : undefined;

  let min = Number.isFinite(input?.accountSyncMinSeconds as number)
    ? normalizeSingleDelaySeconds(input?.accountSyncMinSeconds, defaultMin)
    : legacyValue ?? defaultMin;
  let max = Number.isFinite(input?.accountSyncMaxSeconds as number)
    ? normalizeSingleDelaySeconds(input?.accountSyncMaxSeconds, defaultMax)
    : legacyValue ?? defaultMax;

  if (min > max) {
    [min, max] = [max, min];
  }

  return {
    accountSyncMinSeconds: min,
    accountSyncMaxSeconds: max,
  };
}

export function pickRandomSyncDelaySeconds(
  input?: LegacySyncDelayInput | null,
  defaults?: Partial<SyncDelayRange> | null
): number {
  const { accountSyncMinSeconds, accountSyncMaxSeconds } = normalizeSyncDelayRange(input, defaults);
  if (accountSyncMaxSeconds <= accountSyncMinSeconds) {
    return accountSyncMinSeconds;
  }

  return accountSyncMinSeconds + Math.floor(Math.random() * (accountSyncMaxSeconds - accountSyncMinSeconds + 1));
}

export function pickRandomSyncDelayMs(
  input?: LegacySyncDelayInput | null,
  defaults?: Partial<SyncDelayRange> | null
): number {
  return pickRandomSyncDelaySeconds(input, defaults) * 1000;
}
