import { getSqliteDb } from '~/server/db/sqlite';
import { resolveAccountOwnerScope } from '~/server/repositories/account-owner';

interface AccountStateRow {
  owner_key: string;
  state_key: string;
  identity_key: string;
  auth_key: string;
  data_json: string;
  updated_at: number;
}

export interface StoredAccountStateResult<T = unknown> {
  exists: boolean;
  data: T | null;
  updatedAt: number;
}

function parseStateJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function migrateLegacyAuthScopedRow(options: {
  ownerKey: string;
  identityKey: string;
  authKey: string;
  stateKey: string;
}): Promise<AccountStateRow | null> {
  if (!options.identityKey) {
    return null;
  }

  const db = await getSqliteDb();
  const legacyOwnerKey = `auth:${options.authKey}`;
  if (legacyOwnerKey === options.ownerKey) {
    return null;
  }

  const legacyRow = await db.get<AccountStateRow>(
    `
    SELECT owner_key, state_key, identity_key, auth_key, data_json, updated_at
    FROM mp_account_state
    WHERE owner_key = ? AND state_key = ?
    `,
    legacyOwnerKey,
    options.stateKey
  );
  if (!legacyRow) {
    return null;
  }

  await db.run(
    `
    INSERT INTO mp_account_state(owner_key, state_key, identity_key, auth_key, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, state_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    options.ownerKey,
    options.stateKey,
    options.identityKey,
    options.authKey,
    legacyRow.data_json,
    Date.now()
  );
  await db.run(`DELETE FROM mp_account_state WHERE owner_key = ? AND state_key = ?`, legacyOwnerKey, options.stateKey);

  return {
    owner_key: options.ownerKey,
    state_key: options.stateKey,
    identity_key: options.identityKey,
    auth_key: options.authKey,
    data_json: legacyRow.data_json,
    updated_at: Date.now(),
  };
}

async function loadStateRow(options: {
  ownerKey: string;
  identityKey: string;
  authKey: string;
  stateKey: string;
}): Promise<AccountStateRow | null> {
  const db = await getSqliteDb();
  const row = await db.get<AccountStateRow>(
    `
    SELECT owner_key, state_key, identity_key, auth_key, data_json, updated_at
    FROM mp_account_state
    WHERE owner_key = ? AND state_key = ?
    `,
    options.ownerKey,
    options.stateKey
  );
  if (row) {
    return row;
  }

  return migrateLegacyAuthScopedRow(options);
}

export async function getStoredAccountStateByAuthKey<T = unknown>(
  authKey: string,
  stateKey: string
): Promise<StoredAccountStateResult<T>> {
  const owner = await resolveAccountOwnerScope(authKey);
  const normalizedStateKey = String(stateKey || '').trim();
  if (!normalizedStateKey) {
    return {
      exists: false,
      data: null,
      updatedAt: 0,
    };
  }

  const row = await loadStateRow({
    ...owner,
    stateKey: normalizedStateKey,
  });
  if (!row) {
    return {
      exists: false,
      data: null,
      updatedAt: 0,
    };
  }

  return {
    exists: true,
    data: parseStateJson<T>(row.data_json),
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function upsertStoredAccountStateByAuthKey<T = unknown>(
  authKey: string,
  stateKey: string,
  data: T
): Promise<StoredAccountStateResult<T>> {
  const owner = await resolveAccountOwnerScope(authKey);
  const normalizedStateKey = String(stateKey || '').trim();
  const now = Date.now();
  const db = await getSqliteDb();

  await db.run(
    `
    INSERT INTO mp_account_state(owner_key, state_key, identity_key, auth_key, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, state_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    owner.ownerKey,
    normalizedStateKey,
    owner.identityKey,
    owner.authKey,
    JSON.stringify(data),
    now
  );

  if (owner.identityKey) {
    await db.run(
      `DELETE FROM mp_account_state WHERE owner_key = ? AND state_key = ?`,
      `auth:${owner.authKey}`,
      normalizedStateKey
    );
  }

  return {
    exists: true,
    data,
    updatedAt: now,
  };
}
