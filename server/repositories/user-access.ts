import { getSqliteDb } from '~/server/db/sqlite';

interface UserAccessRow {
  identity_key: string;
  disabled: number;
  disabled_at: number;
  updated_at: number;
  updated_by_identity_key: string;
}

interface UserDirectoryRow extends UserAccessRow {
  auth_key: string;
  user_name: string;
  biz_uin: string;
  alias: string;
  nickname: string;
  head_img: string;
  last_login_at: number;
}

export interface UserAccessRecord {
  identityKey: string;
  disabled: boolean;
  disabledAt: number;
  updatedAt: number;
  updatedByIdentityKey: string;
}

export interface UserDirectoryEntry extends UserAccessRecord {
  authKey: string;
  userName: string;
  bizUin: string;
  alias: string;
  nickname: string;
  headImg: string;
  lastLoginAt: number;
}

function mapUserAccessRow(row: UserAccessRow | null | undefined): UserAccessRecord | null {
  if (!row) {
    return null;
  }

  return {
    identityKey: String(row.identity_key || '').trim(),
    disabled: Number(row.disabled) === 1,
    disabledAt: Number(row.disabled_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    updatedByIdentityKey: String(row.updated_by_identity_key || '').trim(),
  };
}

function mapUserDirectoryRow(row: UserDirectoryRow): UserDirectoryEntry {
  const access = mapUserAccessRow(row);

  return {
    identityKey: String(row.identity_key || '').trim(),
    authKey: String(row.auth_key || '').trim(),
    userName: String(row.user_name || '').trim(),
    bizUin: String(row.biz_uin || '').trim(),
    alias: String(row.alias || '').trim(),
    nickname: String(row.nickname || '').trim(),
    headImg: String(row.head_img || '').trim(),
    lastLoginAt: Number(row.last_login_at) || 0,
    disabled: access?.disabled || false,
    disabledAt: access?.disabledAt || 0,
    updatedAt: Number(row.updated_at) || 0,
    updatedByIdentityKey: access?.updatedByIdentityKey || '',
  };
}

export async function getUserAccessByIdentity(identityKey: string): Promise<UserAccessRecord | null> {
  const normalizedIdentityKey = String(identityKey || '').trim();
  if (!normalizedIdentityKey) {
    return null;
  }

  const db = await getSqliteDb();
  const row = await db.get<UserAccessRow>(
    `
    SELECT identity_key, disabled, disabled_at, updated_at, updated_by_identity_key
    FROM mp_user_access
    WHERE identity_key = ?
    `,
    normalizedIdentityKey
  );

  return mapUserAccessRow(row);
}

export async function upsertUserAccessByIdentity(options: {
  identityKey: string;
  disabled: boolean;
  updatedByIdentityKey?: string;
}): Promise<UserAccessRecord> {
  const identityKey = String(options.identityKey || '').trim();
  if (!identityKey) {
    throw new Error('identityKey is required');
  }

  const now = Date.now();
  const disabled = options.disabled === true;
  const disabledAt = disabled ? now : 0;
  const updatedByIdentityKey = String(options.updatedByIdentityKey || '').trim();
  const db = await getSqliteDb();

  await db.run(
    `
    INSERT INTO mp_user_access(identity_key, disabled, disabled_at, updated_at, updated_by_identity_key)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(identity_key) DO UPDATE SET
      disabled = excluded.disabled,
      disabled_at = excluded.disabled_at,
      updated_at = excluded.updated_at,
      updated_by_identity_key = excluded.updated_by_identity_key
    `,
    identityKey,
    disabled ? 1 : 0,
    disabledAt,
    now,
    updatedByIdentityKey
  );

  return {
    identityKey,
    disabled,
    disabledAt,
    updatedAt: now,
    updatedByIdentityKey,
  };
}

export async function listUserDirectoryEntries(): Promise<UserDirectoryEntry[]> {
  const db = await getSqliteDb();
  const rows = await db.all<UserDirectoryRow>(
    `
    SELECT
      identity.identity_key,
      identity.auth_key,
      identity.user_name,
      identity.biz_uin,
      identity.alias,
      identity.nickname,
      identity.head_img,
      identity.updated_at AS last_login_at,
      COALESCE(access.disabled, 0) AS disabled,
      COALESCE(access.disabled_at, 0) AS disabled_at,
      COALESCE(access.updated_at, identity.updated_at) AS updated_at,
      COALESCE(access.updated_by_identity_key, '') AS updated_by_identity_key
    FROM mp_account_identity AS identity
    LEFT JOIN mp_user_access AS access
      ON access.identity_key = identity.identity_key
    ORDER BY identity.updated_at DESC, identity.identity_key ASC
    `
  );

  return (rows || []).map(mapUserDirectoryRow);
}
