import { isDefaultPreferences, normalizePreferences } from '#shared/utils/preferences';
import { getSqliteDb } from '~/server/db/sqlite';
import { getSchedulerState } from '~/server/kv/scheduler';
import { resolveAccountOwnerScope } from '~/server/repositories/account-owner';
import type { Preferences } from '~/types/preferences';

interface PreferencesRow {
  owner_key: string;
  identity_key: string;
  auth_key: string;
  data_json: string;
  updated_at: number;
}

export interface StoredPreferencesResult {
  exists: boolean;
  source: 'stored' | 'default';
  preferences: Preferences;
  updatedAt: number;
}

function parsePreferencesJson(raw: string): Preferences {
  try {
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return normalizePreferences();
  }
}

function shouldReplacePreferencesRow(currentRow: PreferencesRow | null, alternateRow: PreferencesRow): boolean {
  if (!currentRow) {
    return true;
  }

  const currentPreferences = parsePreferencesJson(currentRow.data_json);
  const alternatePreferences = parsePreferencesJson(alternateRow.data_json);
  return isDefaultPreferences(currentPreferences) && !isDefaultPreferences(alternatePreferences);
}

async function migrateLegacyAuthScopedRow(options: {
  ownerKey: string;
  identityKey: string;
  authKey: string;
}): Promise<PreferencesRow | null> {
  if (!options.identityKey) {
    return null;
  }

  const db = await getSqliteDb();
  const legacyOwnerKey = `auth:${options.authKey}`;
  if (legacyOwnerKey === options.ownerKey) {
    return null;
  }

  const legacyRow = await db.get<PreferencesRow>(
    `
    SELECT owner_key, identity_key, auth_key, data_json, updated_at
    FROM mp_preferences
    WHERE owner_key = ?
    `,
    legacyOwnerKey
  );
  if (!legacyRow) {
    return null;
  }

  await db.run(
    `
    INSERT INTO mp_preferences(owner_key, identity_key, auth_key, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    options.ownerKey,
    options.identityKey,
    options.authKey,
    legacyRow.data_json,
    Date.now()
  );
  await db.run(`DELETE FROM mp_preferences WHERE owner_key = ?`, legacyOwnerKey);

  return {
    owner_key: options.ownerKey,
    identity_key: options.identityKey,
    auth_key: options.authKey,
    data_json: legacyRow.data_json,
    updated_at: Date.now(),
  };
}

async function migrateAlternateOwnerRow(options: {
  ownerKey: string;
  identityKey: string;
  authKey: string;
  currentRow?: PreferencesRow | null;
}): Promise<PreferencesRow | null> {
  if (!options.authKey) {
    return options.currentRow || null;
  }

  const db = await getSqliteDb();
  const alternateRow = await db.get<PreferencesRow>(
    `
    SELECT owner_key, identity_key, auth_key, data_json, updated_at
    FROM mp_preferences
    WHERE auth_key = ? AND owner_key <> ?
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    options.authKey,
    options.ownerKey
  );
  if (!alternateRow || !shouldReplacePreferencesRow(options.currentRow || null, alternateRow)) {
    return options.currentRow || null;
  }

  const now = Date.now();
  await db.run(
    `
    INSERT INTO mp_preferences(owner_key, identity_key, auth_key, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    options.ownerKey,
    options.identityKey,
    options.authKey,
    alternateRow.data_json,
    now
  );
  await db.run(`DELETE FROM mp_preferences WHERE owner_key = ?`, alternateRow.owner_key);

  return {
    owner_key: options.ownerKey,
    identity_key: options.identityKey,
    auth_key: options.authKey,
    data_json: alternateRow.data_json,
    updated_at: now,
  };
}

async function loadPreferencesRow(options: {
  ownerKey: string;
  identityKey: string;
  authKey: string;
}): Promise<PreferencesRow | null> {
  const db = await getSqliteDb();
  const row = await db.get<PreferencesRow>(
    `
    SELECT owner_key, identity_key, auth_key, data_json, updated_at
    FROM mp_preferences
    WHERE owner_key = ?
    `,
    options.ownerKey
  );
  if (row) {
    return migrateAlternateOwnerRow({
      ...options,
      currentRow: row,
    });
  }

  const legacyRow = await migrateLegacyAuthScopedRow(options);
  if (legacyRow) {
    return legacyRow;
  }

  return migrateAlternateOwnerRow(options);
}

function buildSchedulerFallback(authKey: string): Promise<Preferences> {
  return getSchedulerState(authKey)
    .then(state =>
      normalizePreferences({
        dailySyncEnabled: state?.config.dailySyncEnabled,
        dailySyncTime: state?.config.dailySyncTime,
        accountSyncMinSeconds: state?.config.accountSyncMinSeconds,
        accountSyncMaxSeconds: state?.config.accountSyncMaxSeconds,
        syncDateRange: state?.config.syncDateRange,
        syncDatePoint: state?.config.syncDatePoint,
      })
    )
    .catch(() => normalizePreferences());
}

export async function getStoredPreferencesByAuthKey(authKey: string): Promise<StoredPreferencesResult> {
  const owner = await resolveAccountOwnerScope(authKey);
  const row = await loadPreferencesRow(owner);

  if (row) {
    return {
      exists: true,
      source: 'stored',
      preferences: parsePreferencesJson(row.data_json),
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  return {
    exists: false,
    source: 'default',
    preferences: await buildSchedulerFallback(owner.authKey),
    updatedAt: 0,
  };
}

export async function upsertStoredPreferencesByAuthKey(
  authKey: string,
  input?: Partial<Preferences> | null
): Promise<StoredPreferencesResult> {
  const owner = await resolveAccountOwnerScope(authKey);
  const preferences = normalizePreferences(input);
  const now = Date.now();
  const db = await getSqliteDb();

  await db.run(
    `
    INSERT INTO mp_preferences(owner_key, identity_key, auth_key, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    owner.ownerKey,
    owner.identityKey,
    owner.authKey,
    JSON.stringify(preferences),
    now
  );

  if (owner.identityKey) {
    await db.run(`DELETE FROM mp_preferences WHERE owner_key = ?`, `auth:${owner.authKey}`);
  }

  return {
    exists: true,
    source: 'stored',
    preferences,
    updatedAt: now,
  };
}
