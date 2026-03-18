import { DEFAULT_PREFERENCES, isDefaultPreferences, normalizePreferences } from '#shared/utils/preferences';
import {
  ADMIN_MANAGED_PREFERENCE_KEYS,
  getEditablePreferenceKeys,
  mergePreferenceScopes,
  normalizeAdminManagedPreferences,
  normalizeUserManagedPreferences,
  pickAdminManagedPreferences,
  USER_HIDDEN_PREFERENCE_KEYS,
  USER_MANAGED_PREFERENCE_KEYS,
} from '#shared/utils/preferences-scope';
import { getSqliteDb } from '~/server/db/sqlite';
import { getSchedulerState } from '~/server/kv/scheduler';
import { resolveAccountOwnerScope } from '~/server/repositories/account-owner';
import { getAuthKeyBindingByIdentity } from '~/server/repositories/auth-key-binding';
import { getSystemPreference, upsertSystemPreference } from '~/server/repositories/system-preferences';
import { getAdminIdentityKey, resolveMpSessionByAuthKey } from '~/server/utils/mp-session';
import type { Preferences, PreferencesAccess, PreferencesCapabilities } from '~/types/preferences';

interface PreferencesRow {
  owner_key: string;
  identity_key: string;
  auth_key: string;
  data_json: string;
  updated_at: number;
}

interface UserPreferencesState {
  exists: boolean;
  source: 'stored' | 'default';
  preferences: Partial<Preferences>;
  updatedAt: number;
}

interface ManagedPreferencesState {
  exists: boolean;
  preferences: Partial<Preferences>;
  updatedAt: number;
}

export interface StoredPreferencesResult {
  exists: boolean;
  source: 'stored' | 'default';
  preferences: Preferences;
  userPreferences: Partial<Preferences>;
  managedPreferences: Partial<Preferences>;
  updatedAt: number;
  access: PreferencesAccess;
  capabilities: PreferencesCapabilities;
}

export interface StoredPreferencesEntry {
  ownerKey: string;
  identityKey: string;
  authKey: string;
  preferences: Preferences;
  updatedAt: number;
}

export interface PreferencesResponsePayload {
  data: Preferences;
  exists: boolean;
  source: 'stored' | 'default';
  updatedAt: number;
  access: PreferencesAccess;
  capabilities: PreferencesCapabilities;
}

const MANAGED_PREFERENCES_KEY = 'managed_preferences';

function parsePreferencesInputJson(raw: string): Partial<Preferences> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

function parseNormalizedPreferences(raw: string): Preferences {
  return normalizePreferences(parsePreferencesInputJson(raw));
}

function parseStoredUserPreferences(raw: string): Partial<Preferences> {
  return normalizeUserManagedPreferences(parsePreferencesInputJson(raw));
}

function parseStoredManagedPreferences(raw: string): Partial<Preferences> {
  return normalizeAdminManagedPreferences(parsePreferencesInputJson(raw));
}

function shouldReplacePreferencesRow(currentRow: PreferencesRow | null, alternateRow: PreferencesRow): boolean {
  if (!currentRow) {
    return true;
  }

  const currentPreferences = parseNormalizedPreferences(currentRow.data_json);
  const alternatePreferences = parseNormalizedPreferences(alternateRow.data_json);
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
    legacyRow.data_json,
    now
  );
  await db.run(`DELETE FROM mp_preferences WHERE owner_key = ?`, legacyOwnerKey);

  return {
    owner_key: options.ownerKey,
    identity_key: options.identityKey,
    auth_key: options.authKey,
    data_json: legacyRow.data_json,
    updated_at: now,
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

async function buildSchedulerFallback(authKey: string): Promise<Partial<Preferences>> {
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

async function getUserPreferencesState(authKey: string): Promise<UserPreferencesState & { ownerKey: string; identityKey: string }> {
  const owner = await resolveAccountOwnerScope(authKey);
  const row = await loadPreferencesRow(owner);
  if (row) {
    return {
      ownerKey: owner.ownerKey,
      identityKey: owner.identityKey,
      exists: true,
      source: 'stored',
      preferences: parseStoredUserPreferences(row.data_json),
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  return {
    ownerKey: owner.ownerKey,
    identityKey: owner.identityKey,
    exists: false,
    source: 'default',
    preferences: normalizeUserManagedPreferences(await buildSchedulerFallback(owner.authKey)),
    updatedAt: 0,
  };
}

async function readManagedPreferencesState(): Promise<ManagedPreferencesState | null> {
  const record = await getSystemPreference<Partial<Preferences>>(MANAGED_PREFERENCES_KEY);
  if (!record?.data || typeof record.data !== 'object') {
    return null;
  }

  return {
    exists: true,
    preferences: normalizeAdminManagedPreferences(record.data),
    updatedAt: record.updatedAt,
  };
}

async function ensureManagedPreferencesState(): Promise<ManagedPreferencesState> {
  const existing = await readManagedPreferencesState();
  if (existing) {
    return existing;
  }

  let seed = normalizeAdminManagedPreferences(DEFAULT_PREFERENCES);
  const adminIdentityKey = getAdminIdentityKey();
  if (adminIdentityKey) {
    const binding = await getAuthKeyBindingByIdentity(adminIdentityKey);
    const adminAuthKey = String(binding?.authKey || '').trim();
    if (adminAuthKey) {
      const owner = await resolveAccountOwnerScope(adminAuthKey);
      const row = await loadPreferencesRow(owner);
      if (row) {
        seed = {
          ...seed,
          ...parseStoredManagedPreferences(row.data_json),
        };
      } else {
        seed = {
          ...seed,
          ...pickAdminManagedPreferences(await buildSchedulerFallback(adminAuthKey)),
        };
      }
    }
  }

  const stored = await upsertSystemPreference({
    key: MANAGED_PREFERENCES_KEY,
    data: seed,
    updatedByIdentityKey: adminIdentityKey,
  });

  return {
    exists: false,
    preferences: normalizeAdminManagedPreferences(stored.data),
    updatedAt: stored.updatedAt,
  };
}

function createPreferencesAccess(role: PreferencesAccess['role']): PreferencesAccess {
  return {
    role,
    editableKeys: getEditablePreferenceKeys(role),
    userManagedKeys: [...USER_MANAGED_PREFERENCE_KEYS],
    adminManagedKeys: [...ADMIN_MANAGED_PREFERENCE_KEYS],
  };
}

function createPreferencesCapabilities(preferences: Preferences): PreferencesCapabilities {
  const privateProxyCount = Array.isArray(preferences.privateProxyList) ? preferences.privateProxyList.length : 0;

  return {
    aiConfigured: Boolean(
      String(preferences.aiSummaryApiKey || '').trim() &&
        String(preferences.aiSummaryBaseUrl || '').trim() &&
        String(preferences.aiSummaryModel || '').trim()
    ),
    newrankConfigured: Boolean(String(preferences.newrankCookie || '').trim()),
    privateProxyConfigured: privateProxyCount > 0,
    privateProxyCount,
  };
}

function projectPreferencesForRole(preferences: Preferences, role: PreferencesAccess['role']): Preferences {
  if (role === 'admin') {
    return preferences;
  }

  const projected = normalizePreferences(preferences);
  for (const key of USER_HIDDEN_PREFERENCE_KEYS) {
    switch (key) {
      case 'privateProxyList':
        projected.privateProxyList = [];
        break;
      case 'privateProxyAuthorization':
        projected.privateProxyAuthorization = '';
        break;
      case 'newrankCookie':
        projected.newrankCookie = '';
        break;
      case 'aiSummaryBaseUrl':
        projected.aiSummaryBaseUrl = '';
        break;
      case 'aiSummaryApiKey':
        projected.aiSummaryApiKey = '';
        break;
      case 'aiSummaryModel':
        projected.aiSummaryModel = '';
        break;
      case 'aiSummarySystemPrompt':
        projected.aiSummarySystemPrompt = '';
        break;
      case 'aiTagSystemPrompt':
        projected.aiTagSystemPrompt = '';
        break;
      case 'aiDailyReportSystemPrompt':
        projected.aiDailyReportSystemPrompt = '';
        break;
    }
  }

  return projected;
}

function createResponsePayload(result: StoredPreferencesResult): PreferencesResponsePayload {
  return {
    data: projectPreferencesForRole(result.preferences, result.access.role),
    exists: result.exists,
    source: result.source,
    updatedAt: result.updatedAt,
    access: result.access,
    capabilities: result.capabilities,
  };
}

async function persistUserPreferencesRow(options: {
  authKey: string;
  ownerKey: string;
  identityKey: string;
  preferences: Partial<Preferences>;
}): Promise<number> {
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
    options.ownerKey,
    options.identityKey,
    options.authKey,
    JSON.stringify(options.preferences),
    now
  );

  if (options.identityKey) {
    await db.run(`DELETE FROM mp_preferences WHERE owner_key = ?`, `auth:${options.authKey}`);
  }

  return now;
}

async function persistManagedPreferences(options: {
  preferences: Partial<Preferences>;
  updatedByIdentityKey?: string;
}): Promise<number> {
  const stored = await upsertSystemPreference({
    key: MANAGED_PREFERENCES_KEY,
    data: options.preferences,
    updatedByIdentityKey: options.updatedByIdentityKey,
  });
  return stored.updatedAt;
}

export async function getStoredPreferencesByAuthKey(authKey: string): Promise<StoredPreferencesResult> {
  const session = await resolveMpSessionByAuthKey(authKey);
  const role = session?.role || 'user';
  const userState = await getUserPreferencesState(authKey);
  const managedState = await ensureManagedPreferencesState();
  const preferences = mergePreferenceScopes(userState.preferences, managedState.preferences);

  return {
    exists: userState.exists,
    source: userState.source,
    preferences,
    userPreferences: userState.preferences,
    managedPreferences: managedState.preferences,
    updatedAt: Math.max(userState.updatedAt, managedState.updatedAt),
    access: createPreferencesAccess(role),
    capabilities: createPreferencesCapabilities(preferences),
  };
}

export async function getPreferencesResponseByAuthKey(authKey: string): Promise<PreferencesResponsePayload> {
  const result = await getStoredPreferencesByAuthKey(authKey);
  return createResponsePayload(result);
}

export async function upsertStoredPreferencesByAuthKey(
  authKey: string,
  input?: Partial<Preferences> | null
): Promise<StoredPreferencesResult> {
  const current = await getStoredPreferencesByAuthKey(authKey);
  const owner = await resolveAccountOwnerScope(authKey);
  const session = await resolveMpSessionByAuthKey(authKey);
  const role = session?.role || 'user';
  const incoming = input || {};

  const nextUserPreferences = normalizeUserManagedPreferences({
    ...current.userPreferences,
    ...incoming,
  });
  const nextManagedPreferences =
    role === 'admin'
      ? normalizeAdminManagedPreferences({
          ...current.managedPreferences,
          ...incoming,
        })
      : current.managedPreferences;

  const userUpdatedAt = await persistUserPreferencesRow({
    authKey: owner.authKey,
    ownerKey: owner.ownerKey,
    identityKey: owner.identityKey,
    preferences: nextUserPreferences,
  });

  const managedUpdatedAt =
    role === 'admin'
      ? await persistManagedPreferences({
          preferences: nextManagedPreferences,
          updatedByIdentityKey: owner.identityKey,
        })
      : current.updatedAt;

  const preferences = mergePreferenceScopes(nextUserPreferences, nextManagedPreferences);

  return {
    exists: true,
    source: 'stored',
    preferences,
    userPreferences: nextUserPreferences,
    managedPreferences: nextManagedPreferences,
    updatedAt: Math.max(userUpdatedAt, managedUpdatedAt),
    access: createPreferencesAccess(role),
    capabilities: createPreferencesCapabilities(preferences),
  };
}

export async function getUpsertedPreferencesResponseByAuthKey(
  authKey: string,
  input?: Partial<Preferences> | null
): Promise<PreferencesResponsePayload> {
  const result = await upsertStoredPreferencesByAuthKey(authKey, input);
  return createResponsePayload(result);
}

export async function listStoredPreferencesEntries(): Promise<StoredPreferencesEntry[]> {
  const db = await getSqliteDb();
  const identityRows = await db.all<{ identity_key: string; auth_key: string }>(
    `
    SELECT identity_key, auth_key
    FROM mp_account_identity
    ORDER BY updated_at DESC
    `
  );
  const results = new Map<string, StoredPreferencesEntry>();

  for (const row of identityRows || []) {
    const authKey = String(row.auth_key || '').trim();
    if (!authKey || results.has(authKey)) {
      continue;
    }

    const owner = await resolveAccountOwnerScope(authKey);
    const effective = await getStoredPreferencesByAuthKey(authKey);
    results.set(authKey, {
      ownerKey: owner.ownerKey,
      identityKey: owner.identityKey,
      authKey: owner.authKey,
      preferences: effective.preferences,
      updatedAt: effective.updatedAt,
    });
  }

  const legacyRows = await db.all<PreferencesRow>(
    `
    SELECT owner_key, identity_key, auth_key, data_json, updated_at
    FROM mp_preferences
    ORDER BY updated_at DESC
    `
  );

  for (const row of legacyRows || []) {
    const authKey = String(row.auth_key || '').trim();
    if (!authKey || results.has(authKey)) {
      continue;
    }

    const effective = await getStoredPreferencesByAuthKey(authKey);
    results.set(authKey, {
      ownerKey: String(row.owner_key || '').trim(),
      identityKey: String(row.identity_key || '').trim(),
      authKey,
      preferences: effective.preferences,
      updatedAt: effective.updatedAt || Number(row.updated_at) || 0,
    });
  }

  return Array.from(results.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}
