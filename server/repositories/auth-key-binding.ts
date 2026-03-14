import { getSqliteDb } from '~/server/db/sqlite';

export interface AuthKeyBindingRecord {
  identityKey: string;
  authKey: string;
  userName: string;
  bizUin: string;
  alias: string;
  nickname: string;
  headImg: string;
  updatedAt: number;
}

interface BindingRow {
  identity_key: string;
  auth_key: string;
  user_name: string;
  biz_uin: string;
  alias: string;
  nickname: string;
  head_img: string;
  updated_at: number;
}

export interface UpsertAuthKeyBindingInput {
  identityKey: string;
  authKey: string;
  userName?: string;
  bizUin?: string;
  alias?: string;
  nickname?: string;
  headImg?: string;
}

function mapBindingRow(row: BindingRow): AuthKeyBindingRecord {
  return {
    identityKey: row.identity_key,
    authKey: row.auth_key,
    userName: row.user_name || '',
    bizUin: row.biz_uin || '',
    alias: row.alias || '',
    nickname: row.nickname || '',
    headImg: row.head_img || '',
    updatedAt: Number(row.updated_at) || 0,
  };
}

function getIdentityKeyPriority(identityKey: string): number {
  const normalized = String(identityKey || '').trim();
  if (normalized.startsWith('user_name:')) {
    return 0;
  }
  if (normalized.startsWith('biz_uin:')) {
    return 1;
  }
  if (normalized.startsWith('alias:')) {
    return 2;
  }
  if (normalized.startsWith('profile:')) {
    return 3;
  }
  return 4;
}

function compareBindingRows(a: BindingRow, b: BindingRow): number {
  const priorityDiff = getIdentityKeyPriority(a.identity_key) - getIdentityKeyPriority(b.identity_key);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const updatedAtDiff = (Number(a.updated_at) || 0) - (Number(b.updated_at) || 0);
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  return String(a.identity_key || '').localeCompare(String(b.identity_key || ''), 'en');
}

export async function getAuthKeyBindingByIdentity(identityKey: string): Promise<AuthKeyBindingRecord | null> {
  const normalized = String(identityKey || '').trim();
  if (!normalized) {
    return null;
  }

  const db = await getSqliteDb();
  const row = await db.get<BindingRow>(
    `
    SELECT *
    FROM mp_account_identity
    WHERE identity_key = ?
    `,
    normalized
  );

  return row ? mapBindingRow(row) : null;
}

export async function getAuthKeyBindingByAuthKey(authKey: string): Promise<AuthKeyBindingRecord | null> {
  const normalized = String(authKey || '').trim();
  if (!normalized) {
    return null;
  }

  const db = await getSqliteDb();
  const rows = await db.all<BindingRow>(
    `
    SELECT *
    FROM mp_account_identity
    WHERE auth_key = ?
    `,
    normalized
  );

  const row = (rows || []).sort(compareBindingRows)[0] || null;
  return row ? mapBindingRow(row) : null;
}

export async function upsertAuthKeyBinding(input: UpsertAuthKeyBindingInput): Promise<void> {
  const identityKey = String(input.identityKey || '').trim();
  const authKey = String(input.authKey || '').trim();
  if (!identityKey || !authKey) {
    return;
  }

  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO mp_account_identity(identity_key, auth_key, user_name, biz_uin, alias, nickname, head_img, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(identity_key) DO UPDATE SET
      auth_key = excluded.auth_key,
      user_name = excluded.user_name,
      biz_uin = excluded.biz_uin,
      alias = excluded.alias,
      nickname = excluded.nickname,
      head_img = excluded.head_img,
      updated_at = excluded.updated_at
    `,
    identityKey,
    authKey,
    String(input.userName || '').trim(),
    String(input.bizUin || '').trim(),
    String(input.alias || '').trim(),
    String(input.nickname || '').trim(),
    String(input.headImg || '').trim(),
    Date.now()
  );
}
