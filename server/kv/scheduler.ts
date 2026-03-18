import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';
import { getSqliteDb } from '~/server/db/sqlite';
import { logMemory } from '~/server/utils/memory-debug';
import { resolveAccountOwnerScope } from '~/server/repositories/account-owner';

type SyncDateRange = '1d' | '3d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'all' | 'point';

export interface SchedulerConfig {
  dailySyncEnabled: boolean;
  dailySyncTime: string; // HH:mm
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
  syncDateRange: SyncDateRange;
  syncDatePoint: number;
}

export interface SchedulerAccount {
  fakeid: string;
  source_type?: 'mp' | 'rss';
  source_url?: string;
  site_url?: string;
  description?: string;
  nickname?: string;
  round_head_img?: string;
  category?: string;
  focused?: boolean;
}

export interface SchedulerState {
  authKey: string;
  ownerKey?: string;
  identityKey?: string;
  config: SchedulerConfig;
  accounts: SchedulerAccount[];
  createdAt: number;
  updatedAt: number;
  lastRunDate?: string;
  lastRunAt?: number;
  lastStatus?: 'idle' | 'running' | 'success' | 'error';
  lastError?: string;
}

export interface SchedulerArticleCache {
  fakeid: string;
  articles: any[];
  totalCount: number;
  updatedAt: number;
}

const SCHEDULER_INDEX_KEY = 'scheduler:index';

const DEFAULT_CONFIG: SchedulerConfig = {
  dailySyncEnabled: true,
  dailySyncTime: '03:00',
  accountSyncMinSeconds: 3,
  accountSyncMaxSeconds: 5,
  syncDateRange: 'all',
  syncDatePoint: 0,
};

function getStorage() {
  return useStorage('kv');
}

function stateKey(ownerKey: string) {
  return `scheduler:state:${ownerKey}`;
}

function articlesKey(ownerKey: string, fakeid: string) {
  return `scheduler:articles:${ownerKey}:${fakeid}`;
}

function normalizeDailySyncTime(value?: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value || '').trim());
  if (!match) {
    return DEFAULT_CONFIG.dailySyncTime;
  }
  return `${match[1]}:${match[2]}`;
}

function normalizeSyncDateRange(value?: string): SyncDateRange {
  const candidates: SyncDateRange[] = ['1d', '3d', '7d', '1m', '3m', '6m', '1y', 'all', 'point'];
  if (value && candidates.includes(value as SyncDateRange)) {
    return value as SyncDateRange;
  }
  return DEFAULT_CONFIG.syncDateRange;
}

type SchedulerConfigInput = Partial<SchedulerConfig> & {
  accountSyncSeconds?: number;
};

export function normalizeSchedulerConfig(input?: SchedulerConfigInput): SchedulerConfig {
  const config = input || {};
  const syncDelayRange = normalizeSyncDelayRange(config, DEFAULT_CONFIG);
  return {
    dailySyncEnabled: Boolean(config.dailySyncEnabled),
    dailySyncTime: normalizeDailySyncTime(config.dailySyncTime),
    accountSyncMinSeconds: syncDelayRange.accountSyncMinSeconds,
    accountSyncMaxSeconds: syncDelayRange.accountSyncMaxSeconds,
    syncDateRange: normalizeSyncDateRange(config.syncDateRange),
    syncDatePoint: Number.isFinite(config.syncDatePoint) ? Number(config.syncDatePoint) : 0,
  };
}

export async function getSchedulerAuthKeyIndex(): Promise<string[]> {
  const db = await getSqliteDb();
  const rows = await db.all<{ auth_key: string }>(
    `
    SELECT auth_key
    FROM scheduler_state
    ORDER BY updated_at DESC
    `
  );
  const authKeys = Array.from(new Set((rows || []).map(row => row.auth_key).filter(Boolean)));
  if (authKeys.length > 0) {
    return authKeys;
  }

  const kv = getStorage();
  const index = (await kv.get<string[]>(SCHEDULER_INDEX_KEY)) || [];
  return Array.from(new Set(index.filter(Boolean)));
}

async function setSchedulerAuthKeyIndex(index: string[]): Promise<void> {
  const normalized = Array.from(new Set(index.filter(Boolean)));
  const kv = getStorage();
  await kv.set(SCHEDULER_INDEX_KEY, normalized);
}

export async function addSchedulerAuthKeyToIndex(authKey: string): Promise<void> {
  const index = await getSchedulerAuthKeyIndex();
  if (index.includes(authKey)) return;
  index.push(authKey);
  await setSchedulerAuthKeyIndex(index);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeSchedulerAccount(account: Partial<SchedulerAccount>): SchedulerAccount | null {
  const fakeid = String(account?.fakeid || '').trim();
  if (!fakeid) {
    return null;
  }

  return {
    fakeid,
    source_type: account?.source_type === 'rss' ? 'rss' : 'mp',
    source_url: String(account?.source_url || '').trim(),
    site_url: String(account?.site_url || '').trim(),
    description: String(account?.description || '').trim(),
    nickname: String(account?.nickname || '').trim(),
    round_head_img: String(account?.round_head_img || '').trim(),
    category: String(account?.category || '').trim(),
    focused: Boolean(account?.focused),
  };
}

function normalizeState(
  authKey: string,
  state: Partial<SchedulerState> & { ownerKey?: string; identityKey?: string }
): SchedulerState {
  return {
    authKey,
    ownerKey: String(state.ownerKey || '').trim(),
    identityKey: String(state.identityKey || '').trim(),
    config: normalizeSchedulerConfig(state.config),
    accounts: Array.isArray(state.accounts)
      ? state.accounts
          .map(account => normalizeSchedulerAccount(account || {}))
          .filter((account): account is SchedulerAccount => Boolean(account))
      : [],
    createdAt: state.createdAt || Date.now(),
    updatedAt: state.updatedAt || Date.now(),
    lastRunDate: state.lastRunDate,
    lastRunAt: state.lastRunAt,
    lastStatus: state.lastStatus || 'idle',
    lastError: state.lastError || '',
  };
}

export async function getSchedulerState(authKey: string): Promise<SchedulerState | null> {
  const owner = await resolveAccountOwnerScope(authKey);
  const db = await getSqliteDb();
  const row = await db.get<{
    owner_key: string;
    identity_key: string;
    auth_key: string;
    config_json: string;
    accounts_json: string;
    created_at: number;
    updated_at: number;
    last_run_date?: string;
    last_run_at?: number;
    last_status?: SchedulerState['lastStatus'];
    last_error?: string;
  }>(
    `
    SELECT owner_key, identity_key, auth_key, config_json, accounts_json, created_at, updated_at, last_run_date, last_run_at, last_status, last_error
    FROM scheduler_state
    WHERE owner_key = ?
    `,
    owner.ownerKey
  );

  if (row) {
    if (row.auth_key !== owner.authKey || row.identity_key !== owner.identityKey) {
      await db.run(
        `
        UPDATE scheduler_state
        SET auth_key = ?, identity_key = ?
        WHERE owner_key = ?
        `,
        owner.authKey,
        owner.identityKey,
        owner.ownerKey
      );
    }

    return normalizeState(owner.authKey, {
      ownerKey: owner.ownerKey,
      identityKey: owner.identityKey,
      config: parseJson<SchedulerConfig>(row.config_json, DEFAULT_CONFIG),
      accounts: parseJson<SchedulerAccount[]>(row.accounts_json, []),
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      lastRunDate: row.last_run_date,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
    });
  }

  const kv = getStorage();
  const current = await kv.get<SchedulerState>(stateKey(owner.ownerKey));
  const legacy = current || (await kv.get<SchedulerState>(stateKey(owner.authKey)));
  if (!legacy) {
    return null;
  }

  const normalized = normalizeState(owner.authKey, {
    ...legacy,
    ownerKey: owner.ownerKey,
    identityKey: owner.identityKey,
  });
  await upsertSchedulerState(authKey, {
    config: normalized.config,
    accounts: normalized.accounts,
    lastRunDate: normalized.lastRunDate,
    lastRunAt: normalized.lastRunAt,
    lastStatus: normalized.lastStatus,
    lastError: normalized.lastError,
  });
  return {
    ...normalized,
    createdAt: normalized.createdAt || legacy.createdAt || Date.now(),
  };
}

export async function upsertSchedulerState(
  authKey: string,
  payload: {
    config?: Partial<SchedulerConfig>;
    accounts?: SchedulerAccount[];
    lastRunDate?: string;
    lastRunAt?: number;
    lastStatus?: SchedulerState['lastStatus'];
    lastError?: string;
  }
): Promise<SchedulerState> {
  const owner = await resolveAccountOwnerScope(authKey);
  const prev = await getSchedulerState(authKey);

  const nextConfig = normalizeSchedulerConfig({
    ...(prev?.config || DEFAULT_CONFIG),
    ...(payload.config || {}),
  });

  const nextAccounts = Array.isArray(payload.accounts)
    ? payload.accounts
        .map(account => normalizeSchedulerAccount(account || {}))
        .filter((account): account is SchedulerAccount => Boolean(account))
    : prev?.accounts || [];

  const state: SchedulerState = {
    authKey: owner.authKey,
    ownerKey: owner.ownerKey,
    identityKey: owner.identityKey,
    config: nextConfig,
    accounts: nextAccounts,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
    lastRunDate: payload.lastRunDate ?? prev?.lastRunDate,
    lastRunAt: payload.lastRunAt ?? prev?.lastRunAt,
    lastStatus: payload.lastStatus ?? prev?.lastStatus ?? 'idle',
    lastError: payload.lastError ?? prev?.lastError ?? '',
  };

  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO scheduler_state (
      owner_key, identity_key, auth_key, config_json, accounts_json, created_at, updated_at, last_run_date, last_run_at, last_status, last_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      config_json = excluded.config_json,
      accounts_json = excluded.accounts_json,
      updated_at = excluded.updated_at,
      last_run_date = excluded.last_run_date,
      last_run_at = excluded.last_run_at,
      last_status = excluded.last_status,
      last_error = excluded.last_error
    `,
    state.ownerKey,
    state.identityKey,
    state.authKey,
    JSON.stringify(state.config),
    JSON.stringify(state.accounts),
    state.createdAt,
    state.updatedAt,
    state.lastRunDate || null,
    state.lastRunAt || null,
    state.lastStatus || 'idle',
    state.lastError || ''
  );

  const kv = getStorage();
  await kv.set(stateKey(owner.ownerKey), state);
  await addSchedulerAuthKeyToIndex(owner.authKey);
  return state;
}

export async function listSchedulerStates(): Promise<SchedulerState[]> {
  const db = await getSqliteDb();
  const rows = await db.all<{
    owner_key: string;
    identity_key: string;
    auth_key: string;
    config_json: string;
    accounts_json: string;
    created_at: number;
    updated_at: number;
    last_run_date?: string;
    last_run_at?: number;
    last_status?: SchedulerState['lastStatus'];
    last_error?: string;
  }>(
    `
    SELECT owner_key, identity_key, auth_key, config_json, accounts_json, created_at, updated_at, last_run_date, last_run_at, last_status, last_error
    FROM scheduler_state
    ORDER BY updated_at DESC
    `
  );

  if (rows.length > 0) {
    return rows.map(row =>
      normalizeState(row.auth_key, {
        ownerKey: row.owner_key,
        identityKey: row.identity_key,
        config: parseJson<SchedulerConfig>(row.config_json, DEFAULT_CONFIG),
        accounts: parseJson<SchedulerAccount[]>(row.accounts_json, []),
        createdAt: Number(row.created_at) || Date.now(),
        updatedAt: Number(row.updated_at) || Date.now(),
        lastRunDate: row.last_run_date,
        lastRunAt: row.last_run_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
      })
    );
  }

  const authKeys = await getSchedulerAuthKeyIndex();
  const states = await Promise.all(authKeys.map(authKey => getSchedulerState(authKey)));
  return states.filter((state): state is SchedulerState => Boolean(state));
}

export async function getSchedulerArticles(authKey: string, fakeid: string): Promise<SchedulerArticleCache | null> {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const owner = await resolveAccountOwnerScope(authKey);
  const db = await getSqliteDb();
  const row = await db.get<{
    auth_key: string;
    owner_key: string;
    identity_key: string;
    articles_json: string;
    total_count: number;
    updated_at: number;
  }>(
    `
    SELECT auth_key, owner_key, identity_key, articles_json, total_count, updated_at
    FROM scheduler_articles
    WHERE owner_key = ? AND fakeid = ?
    `,
    owner.ownerKey,
    fakeid
  );

  if (row) {
    if (row.auth_key !== owner.authKey || row.identity_key !== owner.identityKey) {
      await db.run(
        `
        UPDATE scheduler_articles
        SET auth_key = ?, identity_key = ?
        WHERE owner_key = ? AND fakeid = ?
        `,
        owner.authKey,
        owner.identityKey,
        owner.ownerKey,
        fakeid
      );
    }
    if (debugMemory) {
      logMemory('scheduler-kv:parse-start', {
        fakeid,
        jsonBytes: Buffer.byteLength(row.articles_json || ''),
      });
    }
    const articles = parseJson<any[]>(row.articles_json, []);
    if (debugMemory) {
      logMemory('scheduler-kv:parse-done', {
        fakeid,
        jsonBytes: Buffer.byteLength(row.articles_json || ''),
        articleCount: Array.isArray(articles) ? articles.length : 0,
      });
    }
    return {
      fakeid,
      articles,
      totalCount: Number.isFinite(row.total_count) ? Number(row.total_count) : 0,
      updatedAt: Number.isFinite(row.updated_at) ? Number(row.updated_at) : Date.now(),
    };
  }

  const kv = getStorage();
  const data =
    (await kv.get<SchedulerArticleCache>(articlesKey(owner.ownerKey, fakeid))) ||
    (await kv.get<SchedulerArticleCache>(articlesKey(owner.authKey, fakeid)));
  if (!data) {
    return null;
  }

  const normalized = {
    fakeid,
    articles: Array.isArray(data.articles) ? data.articles : [],
    totalCount: Number.isFinite(data.totalCount) ? Number(data.totalCount) : 0,
    updatedAt: Number.isFinite(data.updatedAt) ? Number(data.updatedAt) : Date.now(),
  };
  await setSchedulerArticles(owner.authKey, fakeid, {
    articles: normalized.articles,
    totalCount: normalized.totalCount,
  });
  return normalized;
}

export async function setSchedulerArticles(
  authKey: string,
  fakeid: string,
  payload: {
    articles: any[];
    totalCount: number;
  }
): Promise<SchedulerArticleCache> {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const owner = await resolveAccountOwnerScope(authKey);
  const value: SchedulerArticleCache = {
    fakeid,
    articles: Array.isArray(payload.articles) ? payload.articles : [],
    totalCount: Number.isFinite(payload.totalCount) ? Number(payload.totalCount) : 0,
    updatedAt: Date.now(),
  };
  const serialized = JSON.stringify(value.articles);
  if (debugMemory) {
    logMemory('scheduler-kv:serialize-done', {
      fakeid,
      articleCount: value.articles.length,
      jsonBytes: Buffer.byteLength(serialized),
    });
  }
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO scheduler_articles(owner_key, identity_key, auth_key, fakeid, articles_json, total_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, fakeid) DO UPDATE SET
      identity_key = excluded.identity_key,
      auth_key = excluded.auth_key,
      articles_json = excluded.articles_json,
      total_count = excluded.total_count,
      updated_at = excluded.updated_at
    `,
    owner.ownerKey,
    owner.identityKey,
    owner.authKey,
    fakeid,
    serialized,
    value.totalCount,
    value.updatedAt
  );

  const kv = getStorage();
  await kv.set(articlesKey(owner.ownerKey, fakeid), value);
  return value;
}

export async function getSchedulerArticlesMap(
  authKey: string,
  fakeids: string[]
): Promise<Record<string, SchedulerArticleCache>> {
  const pairs = await Promise.all(
    fakeids.map(async fakeid => {
      const data = await getSchedulerArticles(authKey, fakeid);
      return [fakeid, data] as const;
    })
  );

  const map: Record<string, SchedulerArticleCache> = {};
  for (const [fakeid, data] of pairs) {
    if (data) {
      map[fakeid] = data;
    }
  }
  return map;
}
