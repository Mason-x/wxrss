import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

type SqliteRunResult = {
  lastID: number;
  changes: number;
};

interface SqliteDb {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: any[]): Promise<SqliteRunResult>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
}

class AsyncSqliteDb implements SqliteDb {
  private readonly statementCache = new Map<string, StatementSync>();
  private readonly statementCacheMax = 256;

  constructor(private readonly db: DatabaseSync) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  private shouldCacheStatement(sql: string): boolean {
    if (sql.length > 4096) {
      return false;
    }

    // Dynamic IN (...) statements vary with placeholder count and can blow up cache cardinality.
    if (/\bIN\s*\(\s*\?(?:\s*,\s*\?){2,}\s*\)/i.test(sql)) {
      return false;
    }

    return true;
  }

  private getStatement(sql: string): StatementSync {
    if (!this.shouldCacheStatement(sql)) {
      return this.db.prepare(sql);
    }

    const cached = this.statementCache.get(sql);
    if (cached) {
      return cached;
    }

    const stmt = this.db.prepare(sql);
    this.statementCache.set(sql, stmt);

    if (this.statementCache.size > this.statementCacheMax) {
      const oldestKey = this.statementCache.keys().next().value as string | undefined;
      if (oldestKey) {
        this.statementCache.delete(oldestKey);
      }
    }

    return stmt;
  }

  async run(sql: string, ...params: any[]): Promise<SqliteRunResult> {
    const stmt = this.getStatement(sql);
    const result = stmt.run(...normalizeParams(params));
    return {
      lastID: Number(result.lastInsertRowid || 0),
      changes: Number(result.changes || 0),
    };
  }

  async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    const stmt = this.getStatement(sql);
    return stmt.get(...normalizeParams(params)) as T | undefined;
  }

  async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    const stmt = this.getStatement(sql);
    return stmt.all(...normalizeParams(params)) as T[];
  }
}

let dbPromise: Promise<SqliteDb> | null = null;

function resolveDbPath(): string {
  const configured = process.env.SQLITE_DB_PATH || '.data/sqlite/app.db';
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

function normalizeParams(params: any[]): any[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

function compactLegacyArticlePayload(source: Record<string, any>): Record<string, any> {
  const compact: Record<string, any> = {
    aid: String(source?.aid || ''),
    appmsgid: Number(source?.appmsgid) || 0,
    itemidx: Number(source?.itemidx) || 0,
    link: String(source?.link || ''),
    title: String(source?.title || ''),
    digest: String(source?.digest || ''),
    author_name: String(source?.author_name || ''),
    cover: String(source?.cover || ''),
    create_time: Number(source?.create_time) || 0,
    update_time: Number(source?.update_time) || 0,
    item_show_type: Number(source?.item_show_type) || 0,
    media_duration: String(source?.media_duration || ''),
    appmsg_album_infos: Array.isArray(source?.appmsg_album_infos) ? source.appmsg_album_infos : [],
    copyright_stat: Number(source?.copyright_stat) || 0,
    copyright_type: Number(source?.copyright_type) || 0,
    is_deleted: Boolean(source?.is_deleted),
    _status: String(source?._status || ''),
  };
  return compact;
}

async function compactLegacyArticleJsonIfNeeded(db: SqliteDb): Promise<void> {
  const FLAG_KEY = 'reader_articles_compacted_v1';
  const marked = await db.get<{ value: string }>(
    `
    SELECT value
    FROM system_flags
    WHERE key = ?
    `,
    FLAG_KEY
  );
  if (marked?.value === '1') {
    return;
  }

  const batchSize = 20;
  let cursor = 0;
  for (;;) {
    const rows = await db.all<{ rowid: number; data_json: string; digest: string }>(
      `
      SELECT rowid, data_json, digest
      FROM reader_articles
      WHERE rowid > ?
      ORDER BY rowid ASC
      LIMIT ?
      `,
      cursor,
      batchSize
    );
    if (rows.length === 0) {
      break;
    }

    await db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        cursor = Number(row.rowid) || cursor;
        let parsed: Record<string, any> | null = null;
        try {
          parsed = JSON.parse(row.data_json || '{}');
        } catch {
          parsed = null;
        }
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }

        const compact = compactLegacyArticlePayload(parsed);
        const compactJson = JSON.stringify(compact);
        const compactDigest = String(compact.digest || '');
        if (compactJson !== row.data_json || compactDigest !== String(row.digest || '')) {
          await db.run(
            `
            UPDATE reader_articles
            SET data_json = ?, digest = ?
            WHERE rowid = ?
            `,
            compactJson,
            compactDigest,
            row.rowid
          );
        }
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  await db.run(
    `
    INSERT INTO system_flags(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    `,
    FLAG_KEY,
    '1',
    Date.now()
  );
}

async function initSqlite(): Promise<SqliteDb> {
  const filename = resolveDbPath();
  await mkdir(path.dirname(filename), { recursive: true });
  const db = new AsyncSqliteDb(new DatabaseSync(filename));

  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS mp_cookie (
      auth_key TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      cookies_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mp_cookie_expires_at ON mp_cookie(expires_at);

    CREATE TABLE IF NOT EXISTS system_flags (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_state (
      auth_key TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      accounts_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_date TEXT,
      last_run_at INTEGER,
      last_status TEXT,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scheduler_state_updated_at ON scheduler_state(updated_at);

    CREATE TABLE IF NOT EXISTS scheduler_articles (
      auth_key TEXT NOT NULL,
      fakeid TEXT NOT NULL,
      articles_json TEXT NOT NULL,
      total_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, fakeid)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduler_articles_updated_at ON scheduler_articles(updated_at);

    CREATE TABLE IF NOT EXISTS reader_accounts (
      auth_key TEXT NOT NULL,
      fakeid TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      articles INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '',
      focused INTEGER NOT NULL DEFAULT 0,
      nickname TEXT NOT NULL DEFAULT '',
      round_head_img TEXT NOT NULL DEFAULT '',
      total_count INTEGER NOT NULL DEFAULT 0,
      create_time INTEGER NOT NULL DEFAULT 0,
      update_time INTEGER NOT NULL DEFAULT 0,
      last_update_time INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (auth_key, fakeid)
    );

    CREATE INDEX IF NOT EXISTS idx_reader_accounts_auth_category ON reader_accounts(auth_key, category);
    CREATE INDEX IF NOT EXISTS idx_reader_accounts_auth_focused ON reader_accounts(auth_key, focused);
    CREATE INDEX IF NOT EXISTS idx_reader_accounts_auth_nickname ON reader_accounts(auth_key, nickname);

    CREATE TABLE IF NOT EXISTS reader_articles (
      auth_key TEXT NOT NULL,
      fakeid TEXT NOT NULL,
      article_key TEXT NOT NULL,
      link TEXT NOT NULL DEFAULT '',
      aid TEXT NOT NULL DEFAULT '',
      appmsgid INTEGER NOT NULL DEFAULT 0,
      itemidx INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      digest TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      create_time INTEGER NOT NULL DEFAULT 0,
      update_time INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      PRIMARY KEY (auth_key, article_key)
    );

    CREATE INDEX IF NOT EXISTS idx_reader_articles_auth_fakeid_time ON reader_articles(auth_key, fakeid, create_time DESC);
    CREATE INDEX IF NOT EXISTS idx_reader_articles_auth_link ON reader_articles(auth_key, link);
    CREATE INDEX IF NOT EXISTS idx_reader_articles_auth_time ON reader_articles(auth_key, update_time DESC, create_time DESC);

    CREATE TABLE IF NOT EXISTS cache_html (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      comment_id TEXT,
      mime_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
      content_blob BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_html_auth_fakeid ON cache_html(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_html_updated_at ON cache_html(updated_at);

    CREATE TABLE IF NOT EXISTS cache_comment (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_comment_auth_fakeid ON cache_comment(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_comment_updated_at ON cache_comment(updated_at);

    CREATE TABLE IF NOT EXISTS cache_resource (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      content_blob BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_resource_auth_fakeid ON cache_resource(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_resource_updated_at ON cache_resource(updated_at);

    CREATE TABLE IF NOT EXISTS cache_metadata (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_metadata_auth_fakeid ON cache_metadata(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_metadata_updated_at ON cache_metadata(updated_at);

    CREATE TABLE IF NOT EXISTS cache_resource_map (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      resources_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_resource_map_auth_fakeid ON cache_resource_map(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_resource_map_updated_at ON cache_resource_map(updated_at);

    CREATE TABLE IF NOT EXISTS cache_asset (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      content_blob BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_asset_auth_fakeid ON cache_asset(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_asset_updated_at ON cache_asset(updated_at);

    CREATE TABLE IF NOT EXISTS cache_comment_reply (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      content_id TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url, content_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_comment_reply_auth_fakeid ON cache_comment_reply(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_comment_reply_updated_at ON cache_comment_reply(updated_at);

    CREATE TABLE IF NOT EXISTS cache_debug (
      auth_key TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
      content_blob BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (auth_key, url)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_debug_auth_fakeid ON cache_debug(auth_key, fakeid);
    CREATE INDEX IF NOT EXISTS idx_cache_debug_updated_at ON cache_debug(updated_at);
  `);

  try {
    await db.exec(`
      ALTER TABLE reader_articles ADD COLUMN digest TEXT NOT NULL DEFAULT '';
    `);
  } catch {
    // Ignore when the column already exists.
  }

  await compactLegacyArticleJsonIfNeeded(db);

  return db;
}

export async function getSqliteDb(): Promise<SqliteDb> {
  if (!dbPromise) {
    dbPromise = initSqlite();
  }
  return dbPromise;
}
