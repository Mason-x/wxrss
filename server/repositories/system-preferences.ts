import { getSqliteDb } from '~/server/db/sqlite';

interface SystemPreferenceRow {
  key: string;
  data_json: string;
  updated_at: number;
  updated_by_identity_key: string;
}

export interface SystemPreferenceRecord<T = unknown> {
  key: string;
  data: T;
  updatedAt: number;
  updatedByIdentityKey: string;
}

function parseSystemPreferenceData<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mapSystemPreferenceRow<T>(row: SystemPreferenceRow | null | undefined): SystemPreferenceRecord<T> | null {
  if (!row) {
    return null;
  }

  return {
    key: String(row.key || '').trim(),
    data: parseSystemPreferenceData<T>(row.data_json) as T,
    updatedAt: Number(row.updated_at) || 0,
    updatedByIdentityKey: String(row.updated_by_identity_key || '').trim(),
  };
}

export async function getSystemPreference<T = unknown>(key: string): Promise<SystemPreferenceRecord<T> | null> {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const db = await getSqliteDb();
  const row = await db.get<SystemPreferenceRow>(
    `
    SELECT key, data_json, updated_at, updated_by_identity_key
    FROM system_preferences
    WHERE key = ?
    `,
    normalizedKey
  );

  return mapSystemPreferenceRow<T>(row);
}

export async function upsertSystemPreference<T = unknown>(options: {
  key: string;
  data: T;
  updatedByIdentityKey?: string;
}): Promise<SystemPreferenceRecord<T>> {
  const key = String(options.key || '').trim();
  if (!key) {
    throw new Error('key is required');
  }

  const updatedByIdentityKey = String(options.updatedByIdentityKey || '').trim();
  const updatedAt = Date.now();
  const serialized = JSON.stringify(options.data ?? null);
  const db = await getSqliteDb();

  await db.run(
    `
    INSERT INTO system_preferences(key, data_json, updated_at, updated_by_identity_key)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at,
      updated_by_identity_key = excluded.updated_by_identity_key
    `,
    key,
    serialized,
    updatedAt,
    updatedByIdentityKey
  );

  return {
    key,
    data: options.data,
    updatedAt,
    updatedByIdentityKey,
  };
}
