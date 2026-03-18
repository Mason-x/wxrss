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
  publicId: string;
  userName: string;
  bizUin: string;
  alias: string;
  nickname: string;
  headImg: string;
  lastLoginAt: number;
  memberCount: number;
  identityKeys: string[];
  authKeys: string[];
  matchKeys: string[];
}

export interface UserDirectoryGroup {
  entry: UserDirectoryEntry;
  rows: UserDirectoryRow[];
}

interface ExactUserAccessUpsertInput {
  identityKey: string;
  disabled: boolean;
  updatedByIdentityKey?: string;
}

const OWNER_SCOPED_USER_TABLES = [
  'mp_preferences',
  'mp_account_state',
  'scheduler_state',
  'scheduler_articles',
  'reader_accounts',
  'reader_articles',
  'reader_ai_reports',
  'cache_html',
  'cache_comment',
  'cache_resource',
  'cache_metadata',
  'cache_resource_map',
  'cache_asset',
  'cache_comment_reply',
  'cache_debug',
] as const;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeLowerText(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeHeadImg(value: unknown): string {
  return normalizeText(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\?.*$/, '');
}

function normalizeUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map(value => normalizeText(value))
        .filter(Boolean)
    )
  );
}

function getIdentityKeyPriority(identityKey: string): number {
  const normalized = normalizeText(identityKey);
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

function extractProfileNickname(identityKey: string): string {
  const normalized = normalizeText(identityKey);
  if (!normalized.startsWith('profile:')) {
    return '';
  }

  const payload = normalized.slice('profile:'.length);
  const separatorIndex = payload.indexOf('|');
  return normalizeText(separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload);
}

function extractUserNameIdentityValue(identityKey: string): string {
  const normalized = normalizeText(identityKey);
  if (!normalized.startsWith('user_name:')) {
    return '';
  }
  return normalizeText(normalized.slice('user_name:'.length));
}

function looksLikeStableMpId(value: string): boolean {
  const normalized = normalizeLowerText(value);
  return /^gh[_a-z0-9-]{8,}$/.test(normalized);
}

function normalizeStablePublicId(value: unknown): string {
  const normalized = normalizeLowerText(value);
  return looksLikeStableMpId(normalized) ? normalized : '';
}

function resolveStablePublicId(
  row: Pick<UserDirectoryRow, 'identity_key' | 'user_name' | 'nickname'>
): string {
  return (
    normalizeStablePublicId(row.user_name) ||
    normalizeStablePublicId(extractUserNameIdentityValue(row.identity_key)) ||
    normalizeStablePublicId(row.nickname) ||
    normalizeStablePublicId(extractProfileNickname(row.identity_key))
  );
}

function getBaseUserGroupingKeys(
  row: Pick<UserDirectoryRow, 'identity_key' | 'user_name' | 'biz_uin' | 'alias' | 'nickname'>
): string[] {
  const keys = new Set<string>();
  const userName = normalizeLowerText(row.user_name);
  const bizUin = normalizeLowerText(row.biz_uin);
  const alias = normalizeLowerText(row.alias);
  const publicId = resolveStablePublicId(row);

  if (publicId) {
    keys.add(`public_id:${publicId}`);
  }
  if (userName) {
    keys.add(`user_name:${userName}`);
  }
  if (bizUin) {
    keys.add(`biz_uin:${bizUin}`);
  }
  if (alias) {
    keys.add(`alias:${alias}`);
  }

  return Array.from(keys);
}

function hasStableGroupingIdentity(row: Pick<UserDirectoryRow, 'user_name' | 'biz_uin' | 'alias' | 'nickname' | 'identity_key'>): boolean {
  return getBaseUserGroupingKeys(row).length > 0;
}

function getUserGroupingKeys(
  row: Pick<UserDirectoryRow, 'identity_key' | 'auth_key' | 'user_name' | 'biz_uin' | 'alias' | 'nickname' | 'head_img'>,
  options?: {
    bridgeableHeadImgs?: Set<string>;
    publicIdsByAuthKey?: Map<string, Set<string>>;
  }
): string[] {
  const keys = new Set(getBaseUserGroupingKeys(row));
  const normalizedHeadImg = normalizeHeadImg(row.head_img);
  const normalizedAuthKey = normalizeText(row.auth_key);

  if (normalizedAuthKey) {
    const publicIds = options?.publicIdsByAuthKey?.get(normalizedAuthKey);
    if (publicIds) {
      for (const publicId of publicIds) {
        keys.add(`public_id:${publicId}`);
      }
    }
  }

  if (normalizedHeadImg && options?.bridgeableHeadImgs?.has(normalizedHeadImg)) {
    keys.add(`head_img_bridge:${normalizedHeadImg}`);
  }

  if (keys.size === 0) {
    keys.add(`identity:${normalizeText(row.identity_key)}`);
  }

  return Array.from(keys);
}

function getDisplayScore(row: UserDirectoryRow): number {
  let score = 0;

  if (normalizeText(row.user_name)) {
    score += 120;
  }
  if (normalizeText(row.biz_uin)) {
    score += 90;
  }
  if (normalizeText(row.alias)) {
    score += 60;
  }
  if (normalizeText(row.nickname) && !looksLikeStableMpId(row.nickname)) {
    score += 24;
  }
  if (normalizeHeadImg(row.head_img)) {
    score += 8;
  }

  return score;
}

function compareDirectoryRows(left: UserDirectoryRow, right: UserDirectoryRow): number {
  const scoreDiff = getDisplayScore(right) - getDisplayScore(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const lastLoginDiff = (Number(right.last_login_at) || 0) - (Number(left.last_login_at) || 0);
  if (lastLoginDiff !== 0) {
    return lastLoginDiff;
  }

  const identityPriorityDiff = getIdentityKeyPriority(left.identity_key) - getIdentityKeyPriority(right.identity_key);
  if (identityPriorityDiff !== 0) {
    return identityPriorityDiff;
  }

  return normalizeText(left.identity_key).localeCompare(normalizeText(right.identity_key), 'en');
}

function mapUserAccessRow(row: UserAccessRow | null | undefined): UserAccessRecord | null {
  if (!row) {
    return null;
  }

  return {
    identityKey: normalizeText(row.identity_key),
    disabled: Number(row.disabled) === 1,
    disabledAt: Number(row.disabled_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    updatedByIdentityKey: normalizeText(row.updated_by_identity_key),
  };
}

async function listRawUserDirectoryRows(): Promise<UserDirectoryRow[]> {
  const db = await getSqliteDb();
  return db.all<UserDirectoryRow>(
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
}

function buildUserDirectoryGroups(rows: UserDirectoryRow[]): UserDirectoryGroup[] {
  const sortedRows = [...rows].sort(compareDirectoryRows);
  const rowByIdentityKey = new Map<string, UserDirectoryRow>();
  const identityKeysByMatchKey = new Map<string, Set<string>>();
  const stableHeadImgCounts = new Map<string, number>();
  const publicIdsByAuthKey = new Map<string, Set<string>>();

  for (const row of sortedRows) {
    const publicId = resolveStablePublicId(row);
    const authKey = normalizeText(row.auth_key);
    if (publicId && authKey) {
      const current = publicIdsByAuthKey.get(authKey) || new Set<string>();
      current.add(publicId);
      publicIdsByAuthKey.set(authKey, current);
    }

    if (!hasStableGroupingIdentity(row)) {
      continue;
    }

    const normalizedHeadImg = normalizeHeadImg(row.head_img);
    if (!normalizedHeadImg) {
      continue;
    }

    stableHeadImgCounts.set(normalizedHeadImg, (stableHeadImgCounts.get(normalizedHeadImg) || 0) + 1);
  }

  const bridgeableHeadImgs = new Set(
    Array.from(stableHeadImgCounts.entries())
      .filter(([, count]) => Number(count) > 0)
      .map(([headImg]) => headImg)
  );

  for (const row of sortedRows) {
    const identityKey = normalizeText(row.identity_key);
    rowByIdentityKey.set(identityKey, row);

    for (const matchKey of getUserGroupingKeys(row, { bridgeableHeadImgs, publicIdsByAuthKey })) {
      const current = identityKeysByMatchKey.get(matchKey) || new Set<string>();
      current.add(identityKey);
      identityKeysByMatchKey.set(matchKey, current);
    }
  }

  const visited = new Set<string>();
  const groups: UserDirectoryGroup[] = [];

  for (const row of sortedRows) {
    const startIdentityKey = normalizeText(row.identity_key);
    if (!startIdentityKey || visited.has(startIdentityKey)) {
      continue;
    }

    const queue = [startIdentityKey];
    const componentRows: UserDirectoryRow[] = [];
    const componentMatchKeys = new Set<string>();

    while (queue.length > 0) {
      const currentIdentityKey = queue.shift();
      if (!currentIdentityKey || visited.has(currentIdentityKey)) {
        continue;
      }

      const currentRow = rowByIdentityKey.get(currentIdentityKey);
      if (!currentRow) {
        continue;
      }

      visited.add(currentIdentityKey);
      componentRows.push(currentRow);

      for (const matchKey of getUserGroupingKeys(currentRow, { bridgeableHeadImgs, publicIdsByAuthKey })) {
        componentMatchKeys.add(matchKey);
        const relatedIdentityKeys = identityKeysByMatchKey.get(matchKey);
        if (!relatedIdentityKeys) {
          continue;
        }

        for (const relatedIdentityKey of relatedIdentityKeys) {
          if (!visited.has(relatedIdentityKey)) {
            queue.push(relatedIdentityKey);
          }
        }
      }
    }

    const primaryRow = [...componentRows].sort(compareDirectoryRows)[0];
    if (!primaryRow) {
      continue;
    }

    const sortedComponentRows = [...componentRows].sort(
      (left, right) =>
        (Number(right.last_login_at) || 0) - (Number(left.last_login_at) || 0) || compareDirectoryRows(left, right)
    );
    const latestDisabledRow = [...componentRows]
      .filter(item => Number(item.disabled) === 1)
      .sort((left, right) => (Number(right.updated_at) || 0) - (Number(left.updated_at) || 0))[0];

    groups.push({
      rows: componentRows,
      entry: {
        identityKey: normalizeText(primaryRow.identity_key),
        authKey: normalizeText(primaryRow.auth_key),
        publicId:
          sortedComponentRows.map(item => resolveStablePublicId(item)).find(Boolean) ||
          resolveStablePublicId(primaryRow),
        userName: normalizeText(primaryRow.user_name),
        bizUin: normalizeText(primaryRow.biz_uin),
        alias: normalizeText(primaryRow.alias),
        nickname: normalizeText(primaryRow.nickname),
        headImg:
          normalizeText(sortedComponentRows.find(item => normalizeHeadImg(item.head_img))?.head_img) ||
          normalizeText(primaryRow.head_img),
        lastLoginAt: Math.max(...componentRows.map(item => Number(item.last_login_at) || 0), 0),
        disabled: Boolean(latestDisabledRow),
        disabledAt: Number(latestDisabledRow?.disabled_at) || 0,
        updatedAt: Math.max(...componentRows.map(item => Number(item.updated_at) || 0), 0),
        updatedByIdentityKey: normalizeText(latestDisabledRow?.updated_by_identity_key),
        memberCount: componentRows.length,
        identityKeys: normalizeUnique(componentRows.map(item => item.identity_key)),
        authKeys: normalizeUnique(componentRows.map(item => item.auth_key)),
        matchKeys: Array.from(componentMatchKeys),
      },
    });
  }

  return groups.sort(
    (left, right) =>
      (Number(right.entry.lastLoginAt) || 0) - (Number(left.entry.lastLoginAt) || 0) ||
      compareDirectoryRows(
        right.rows.sort(compareDirectoryRows)[0] || right.rows[0],
        left.rows.sort(compareDirectoryRows)[0] || left.rows[0]
      )
  );
}

async function getUserDirectoryGroupByIdentityInternal(identityKey: string): Promise<UserDirectoryGroup | null> {
  const normalizedIdentityKey = normalizeText(identityKey);
  if (!normalizedIdentityKey) {
    return null;
  }

  const rows = await listRawUserDirectoryRows();
  const groups = buildUserDirectoryGroups(rows);
  return groups.find(group => group.entry.identityKeys.includes(normalizedIdentityKey)) || null;
}

async function getExactUserAccessByIdentity(identityKey: string): Promise<UserAccessRecord | null> {
  const normalizedIdentityKey = normalizeText(identityKey);
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

async function upsertExactUserAccessByIdentity(options: ExactUserAccessUpsertInput): Promise<void> {
  const identityKey = normalizeText(options.identityKey);
  if (!identityKey) {
    throw new Error('identityKey is required');
  }

  const now = Date.now();
  const disabled = options.disabled === true;
  const disabledAt = disabled ? now : 0;
  const updatedByIdentityKey = normalizeText(options.updatedByIdentityKey);
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
}

function buildInClause(values: string[]): string {
  return values.map(() => '?').join(', ');
}

async function deleteFromOwnerScopedTable(options: {
  tableName: string;
  ownerKeys: string[];
  identityKeys: string[];
  authKeys: string[];
}): Promise<void> {
  const clauses: string[] = [];
  const params: string[] = [];

  if (options.ownerKeys.length > 0) {
    clauses.push(`owner_key IN (${buildInClause(options.ownerKeys)})`);
    params.push(...options.ownerKeys);
  }
  if (options.identityKeys.length > 0) {
    clauses.push(`identity_key IN (${buildInClause(options.identityKeys)})`);
    params.push(...options.identityKeys);
  }
  if (options.authKeys.length > 0) {
    clauses.push(`auth_key IN (${buildInClause(options.authKeys)})`);
    params.push(...options.authKeys);
  }

  if (clauses.length === 0) {
    return;
  }

  const db = await getSqliteDb();
  await db.run(`DELETE FROM ${options.tableName} WHERE ${clauses.join(' OR ')}`, ...params);
}

export async function getUserDirectoryGroupByIdentity(identityKey: string): Promise<UserDirectoryGroup | null> {
  return getUserDirectoryGroupByIdentityInternal(identityKey);
}

export async function getUserAccessByIdentity(identityKey: string): Promise<UserAccessRecord | null> {
  const group = await getUserDirectoryGroupByIdentityInternal(identityKey);
  if (!group) {
    return getExactUserAccessByIdentity(identityKey);
  }

  return {
    identityKey: group.entry.identityKey,
    disabled: group.entry.disabled,
    disabledAt: group.entry.disabledAt,
    updatedAt: group.entry.updatedAt,
    updatedByIdentityKey: group.entry.updatedByIdentityKey,
  };
}

export async function upsertUserAccessByIdentity(options: {
  identityKey: string;
  disabled: boolean;
  updatedByIdentityKey?: string;
}): Promise<UserAccessRecord> {
  const identityKey = normalizeText(options.identityKey);
  if (!identityKey) {
    throw new Error('identityKey is required');
  }

  const group = await getUserDirectoryGroupByIdentityInternal(identityKey);
  const identityKeys = group?.entry.identityKeys.length ? group.entry.identityKeys : [identityKey];
  const db = await getSqliteDb();

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const currentIdentityKey of identityKeys) {
      await upsertExactUserAccessByIdentity({
        identityKey: currentIdentityKey,
        disabled: options.disabled,
        updatedByIdentityKey: options.updatedByIdentityKey,
      });
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  const updatedGroup = await getUserDirectoryGroupByIdentityInternal(identityKey);
  if (updatedGroup) {
    return {
      identityKey: updatedGroup.entry.identityKey,
      disabled: updatedGroup.entry.disabled,
      disabledAt: updatedGroup.entry.disabledAt,
      updatedAt: updatedGroup.entry.updatedAt,
      updatedByIdentityKey: updatedGroup.entry.updatedByIdentityKey,
    };
  }

  const now = Date.now();
  return {
    identityKey,
    disabled: options.disabled === true,
    disabledAt: options.disabled === true ? now : 0,
    updatedAt: now,
    updatedByIdentityKey: normalizeText(options.updatedByIdentityKey),
  };
}

export async function deleteUserDirectoryByIdentity(identityKey: string): Promise<UserDirectoryEntry | null> {
  const group = await getUserDirectoryGroupByIdentityInternal(identityKey);
  if (!group) {
    return null;
  }

  const ownerKeys = normalizeUnique([
    ...group.entry.identityKeys.map(item => `identity:${item}`),
    ...group.entry.authKeys.map(item => `auth:${item}`),
  ]);
  const identityKeys = group.entry.identityKeys;
  const authKeys = group.entry.authKeys;
  const db = await getSqliteDb();

  await db.exec('BEGIN IMMEDIATE');
  try {
    if (identityKeys.length > 0) {
      await db.run(
        `DELETE FROM mp_user_access WHERE identity_key IN (${buildInClause(identityKeys)})`,
        ...identityKeys
      );
      await db.run(
        `DELETE FROM mp_account_identity WHERE identity_key IN (${buildInClause(identityKeys)})`,
        ...identityKeys
      );
    }

    if (authKeys.length > 0) {
      await db.run(
        `DELETE FROM mp_cookie WHERE auth_key IN (${buildInClause(authKeys)})`,
        ...authKeys
      );
    }

    for (const tableName of OWNER_SCOPED_USER_TABLES) {
      await deleteFromOwnerScopedTable({
        tableName,
        ownerKeys,
        identityKeys,
        authKeys,
      });
    }

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  return group.entry;
}

export async function listUserDirectoryEntries(): Promise<UserDirectoryEntry[]> {
  const rows = await listRawUserDirectoryRows();
  return buildUserDirectoryGroups(rows).map(group => group.entry);
}
