import { getSqliteDb } from '~/server/db/sqlite';
import { parseStructuredArticleSummary } from '~/server/utils/ai-summary';

export interface ReaderAccount {
  fakeid: string;
  completed: boolean;
  count: number;
  articles: number;
  source_type?: 'mp' | 'rss';
  source_url?: string;
  site_url?: string;
  description?: string;
  category?: string;
  focused?: boolean;
  nickname?: string;
  round_head_img?: string;
  total_count: number;
  create_time?: number;
  update_time?: number;
  last_update_time?: number;
}

export interface ReaderArticle extends Record<string, any> {
  fakeid: string;
  _status: string;
  favorite?: boolean;
  ai_summary?: string;
  ai_tags?: string[];
  is_deleted: boolean;
}

export interface ReaderAiDailyReport {
  reportDate: string;
  title: string;
  contentHtml: string;
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReaderAiProcessingArticle {
  fakeid: string;
  link: string;
  title: string;
  digest: string;
  authorName: string;
  accountName: string;
  createTime: number;
  updateTime: number;
  aiTags: string[];
  aiTaggedAt: number;
  aiSummary: string;
  cachedHtml: string;
}

const ARTICLE_STORAGE_FIELD_ALLOWLIST = new Set<string>([
  'aid',
  'appmsgid',
  'itemidx',
  'link',
  'title',
  'digest',
  'author_name',
  'create_time',
  'update_time',
  'item_show_type',
  'media_duration',
  'appmsg_album_infos',
  'copyright_stat',
  'is_deleted',
  '_status',
  'copyright_type',
  'cover',
  'cover_img_first',
  'cover_img_1_1',
  'cover_img_3_4',
  'pic_cdn_url_1_1',
  'pic_cdn_url_3_4',
  'pic_cdn_url_16_9',
]);

function nowSeconds(): number {
  return Math.round(Date.now() / 1000);
}

function resolveLatestArticleTime(articles: Array<Record<string, any>>): number {
  return articles.reduce((latest, article) => {
    const candidate = Number(article?.update_time || article?.create_time || 0);
    return candidate > latest ? candidate : latest;
  }, 0);
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function buildArticleStorageKey(
  fakeid: string,
  article: Pick<any, 'aid' | 'appmsgid' | 'itemidx' | 'link' | 'create_time' | 'update_time' | 'title'>
): string {
  const aid = (article.aid || '').trim();
  if (aid) {
    return `${fakeid}:${aid}`;
  }

  if (Number.isFinite(article.appmsgid) && Number(article.appmsgid) > 0) {
    return `${fakeid}:appmsg:${article.appmsgid}:${article.itemidx || 0}`;
  }

  const link = (article.link || '').trim();
  if (link) {
    return `${fakeid}:link:${hashString(link)}`;
  }

  const fallback = `${fakeid}:${article.create_time || 0}:${article.update_time || 0}:${article.title || ''}`;
  return `${fakeid}:fallback:${hashString(fallback)}`;
}

function mapAccountRow(row: any): ReaderAccount {
  return {
    fakeid: row.fakeid,
    completed: Boolean(row.completed),
    count: Number(row.count) || 0,
    articles: Number(row.articles) || 0,
    source_type: row.source_type === 'rss' ? 'rss' : 'mp',
    source_url: row.source_url || '',
    site_url: row.site_url || '',
    description: row.description || '',
    category: row.category || '',
    focused: Boolean(row.focused),
    nickname: row.nickname || '',
    round_head_img: row.round_head_img || '',
    total_count: Number(row.total_count) || 0,
    create_time: Number(row.create_time) || 0,
    update_time: Number(row.update_time) || 0,
    last_update_time: Number(row.last_update_time) || 0,
  };
}

function mapArticleRow(row: any): ReaderArticle {
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(row.data_json || '{}');
  } catch {
    data = {};
  }

  return {
    ...data,
    fakeid: row.fakeid,
    _status: row.status || '',
    favorite: Boolean(row.favorite),
    ai_summary: String(row.ai_summary || ''),
    ai_tags: resolveArticleAiTags(row.ai_tags_json, row.ai_summary),
    is_deleted: Boolean(row.is_deleted),
  };
}

function mapArticleLiteRow(row: any): ReaderArticle {
  return {
    fakeid: row.fakeid,
    link: row.link || '',
    aid: row.aid || '',
    appmsgid: Number(row.appmsgid) || 0,
    itemidx: Number(row.itemidx) || 0,
    title: row.title || '',
    digest: row.digest || '',
    author_name: row.author_name || '',
    create_time: Number(row.create_time) || 0,
    update_time: Number(row.update_time) || 0,
    _status: row.status || '',
    favorite: Boolean(row.favorite),
    ai_summary: String(row.ai_summary || ''),
    ai_tags: resolveArticleAiTags(row.ai_tags_json, row.ai_summary),
    is_deleted: Boolean(row.is_deleted),
    round_head_img: row.account_round_head_img || '',
  };
}

function parseStructuredSummaryTags(raw: unknown): string[] {
  const parsed = parseStructuredArticleSummary(String(raw || '').trim());
  return Array.isArray(parsed?.tags) ? normalizeAiTags(parsed.tags) : [];
}

function parseAiTagsJson(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeAiTags(parsed);
  } catch {
    return [];
  }
}

function normalizeAiTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input
        .map(tag => String(tag || '').trim())
        .filter(Boolean)
        .map(tag => {
          const plain = tag
            .replace(/^\{\{\s*|\s*\}\}$/g, '')
            .trim()
            .toLowerCase();
          if (!plain) {
            return '';
          }
          const normalized = plain
            .replace(/[^a-z0-9_\-\s]+/g, ' ')
            .replace(/[\s-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48);
          return normalized ? `{{${normalized}}}` : '';
        })
        .filter(Boolean)
    )
  );
}

function resolveArticleAiTags(rawTags: unknown, rawSummary: unknown): string[] {
  const summaryTags = parseStructuredSummaryTags(rawSummary);
  if (summaryTags.length > 0) {
    return summaryTags;
  }
  return parseAiTagsJson(rawTags);
}

function mapAiDailyReportRow(row: any): ReaderAiDailyReport {
  return {
    reportDate: String(row.report_date || ''),
    title: String(row.title || ''),
    contentHtml: String(row.content_html || ''),
    sourceCount: Number(row.source_count) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function normalizeArticleForStorage(article: any): Record<string, any> {
  const source = article || {};
  const compact: Record<string, any> = {};
  ARTICLE_STORAGE_FIELD_ALLOWLIST.forEach(field => {
    if (source[field] !== undefined) {
      compact[field] = source[field];
    }
  });

  compact.aid = String(compact.aid || '');
  compact.appmsgid = Number(compact.appmsgid) || 0;
  compact.itemidx = Number(compact.itemidx) || 0;
  compact.link = String(compact.link || '');
  compact.title = String(compact.title || '');
  compact.digest = String(compact.digest || '');
  compact.author_name = String(compact.author_name || '');
  compact.create_time = Number(compact.create_time) || 0;
  compact.update_time = Number(compact.update_time) || 0;
  compact.is_deleted = Boolean(compact.is_deleted);
  compact._status = String(compact._status || '');
  return compact;
}

function normalizeLimit(value?: number, fallback = 50, max = 500): number {
  if (!Number.isFinite(value)) return fallback;
  const parsed = Math.floor(Number(value));
  if (parsed < 1) return fallback;
  if (parsed > max) return max;
  return parsed;
}

function normalizeOffset(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  const parsed = Math.floor(Number(value));
  if (parsed < 0) return 0;
  return parsed;
}

function isMeaningfulNickname(value?: string): boolean {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  return !/^\?+$/.test(text);
}

function normalizeSourceType(value?: string): 'mp' | 'rss' {
  return value === 'rss' ? 'rss' : 'mp';
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCategoryForUpsert(payloadCategory: unknown, currentCategory: unknown): string {
  if (typeof payloadCategory !== 'string') {
    return String(currentCategory || '');
  }

  // Keep existing category when upsert payload carries empty category.
  if (!payloadCategory.trim()) {
    return String(currentCategory || '');
  }

  return payloadCategory;
}

async function applyAccountDelta(
  authKey: string,
  payload: Partial<ReaderAccount> & { fakeid: string; total_count?: number; completed?: boolean },
  messageDelta: number,
  articleDelta: number
): Promise<ReaderAccount> {
  const db = await getSqliteDb();
  const current = await db.get<any>(
    `
    SELECT *
    FROM reader_accounts
    WHERE auth_key = ? AND fakeid = ?
    `,
    authKey,
    payload.fakeid
  );

  const now = nowSeconds();
  const safeMessageDelta = Number.isFinite(messageDelta) ? Math.max(0, Math.floor(messageDelta)) : 0;
  const safeArticleDelta = Number.isFinite(articleDelta) ? Math.max(0, Math.floor(articleDelta)) : 0;

  if (!current) {
    const created: ReaderAccount = {
      fakeid: payload.fakeid,
      completed: Boolean(payload.completed),
      count: safeMessageDelta,
      articles: safeArticleDelta,
      source_type: normalizeSourceType(payload.source_type),
      source_url: normalizeOptionalText(payload.source_url),
      site_url: normalizeOptionalText(payload.site_url),
      description: normalizeOptionalText(payload.description),
      category: typeof payload.category === 'string' ? payload.category : '',
      focused: Boolean(payload.focused),
      nickname: payload.nickname || '',
      round_head_img: payload.round_head_img || '',
      total_count: Number.isFinite(payload.total_count) ? Number(payload.total_count) : 0,
      create_time: now,
      update_time: now,
      last_update_time: Number.isFinite(payload.last_update_time) ? Number(payload.last_update_time) : 0,
    };

    await db.run(
      `
      INSERT INTO reader_accounts(
        auth_key, fakeid, completed, count, articles, source_type, source_url, site_url, description, category, focused, nickname, round_head_img, total_count, create_time, update_time, last_update_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      authKey,
      created.fakeid,
      created.completed ? 1 : 0,
      created.count,
      created.articles,
      created.source_type || 'mp',
      created.source_url || '',
      created.site_url || '',
      created.description || '',
      created.category || '',
      created.focused ? 1 : 0,
      created.nickname || '',
      created.round_head_img || '',
      created.total_count,
      created.create_time,
      created.update_time,
      created.last_update_time || 0
    );
    return created;
  }

  const updated: ReaderAccount = {
    fakeid: payload.fakeid,
    completed: Boolean(current.completed) || Boolean(payload.completed),
    count: (Number(current.count) || 0) + safeMessageDelta,
    articles: (Number(current.articles) || 0) + safeArticleDelta,
    source_type: normalizeSourceType(String(payload.source_type || current.source_type || 'mp')),
    source_url: normalizeOptionalText(payload.source_url) || current.source_url || '',
    site_url: normalizeOptionalText(payload.site_url) || current.site_url || '',
    description: normalizeOptionalText(payload.description) || current.description || '',
    category: resolveCategoryForUpsert(payload.category, current.category),
    focused: Boolean(current.focused) || Boolean(payload.focused),
    nickname: isMeaningfulNickname(payload.nickname) ? String(payload.nickname || '') : current.nickname || '',
    round_head_img: payload.round_head_img || current.round_head_img || '',
    total_count: Number.isFinite(payload.total_count) ? Number(payload.total_count) : Number(current.total_count) || 0,
    create_time: Number(current.create_time) || now,
    update_time: now,
    last_update_time: Number.isFinite(payload.last_update_time)
      ? Math.max(Number(payload.last_update_time) || 0, Number(current.last_update_time) || 0)
      : Number(current.last_update_time) || 0,
  };

  await db.run(
    `
    UPDATE reader_accounts
    SET completed = ?, count = ?, articles = ?, source_type = ?, source_url = ?, site_url = ?, description = ?, category = ?, focused = ?, nickname = ?, round_head_img = ?, total_count = ?, update_time = ?, last_update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    updated.completed ? 1 : 0,
    updated.count,
    updated.articles,
    updated.source_type || 'mp',
    updated.source_url || '',
    updated.site_url || '',
    updated.description || '',
    updated.category || '',
    updated.focused ? 1 : 0,
    updated.nickname || '',
    updated.round_head_img || '',
    updated.total_count,
    updated.update_time,
    updated.last_update_time || 0,
    authKey,
    updated.fakeid
  );
  return updated;
}

export async function upsertAccountDelta(
  authKey: string,
  payload: Partial<ReaderAccount> & { fakeid: string; count?: number; articles?: number }
): Promise<ReaderAccount> {
  return applyAccountDelta(authKey, payload, Number(payload.count) || 0, Number(payload.articles) || 0);
}

export async function updateAccountCategory(authKey: string, fakeid: string, category: string): Promise<boolean> {
  const db = await getSqliteDb();
  const now = nowSeconds();
  await db.run(
    `
    UPDATE reader_accounts
    SET category = ?, update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    category || '',
    now,
    authKey,
    fakeid
  );
  return true;
}

export async function updateAccountFocused(authKey: string, fakeid: string, focused: boolean): Promise<boolean> {
  const db = await getSqliteDb();
  const now = nowSeconds();
  await db.run(
    `
    UPDATE reader_accounts
    SET focused = ?, update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    focused ? 1 : 0,
    now,
    authKey,
    fakeid
  );
  return true;
}

export async function updateLastUpdateTime(authKey: string, fakeid: string): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    UPDATE reader_accounts
    SET last_update_time = ?, update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    nowSeconds(),
    nowSeconds(),
    authKey,
    fakeid
  );
  return true;
}

export async function getAccountByFakeid(authKey: string, fakeid: string): Promise<ReaderAccount | null> {
  const db = await getSqliteDb();
  const row = await db.get<any>(
    `
    SELECT *
    FROM reader_accounts
    WHERE auth_key = ? AND fakeid = ?
    `,
    authKey,
    fakeid
  );
  return row ? mapAccountRow(row) : null;
}

export async function listAccounts(
  authKey: string,
  options: { offset?: number; limit?: number; keyword?: string } = {}
): Promise<{ list: ReaderAccount[]; total: number; offset: number; limit: number }> {
  const db = await getSqliteDb();
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 200, 2000);
  const keyword = (options.keyword || '').trim();

  const where: string[] = ['auth_key = ?'];
  const params: any[] = [authKey];

  if (keyword) {
    where.push('(nickname LIKE ? OR source_url LIKE ? OR site_url LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.join(' AND ');
  const totalRow = await db.get<{ total: number }>(
    `
    SELECT COUNT(1) as total
    FROM reader_accounts
    WHERE ${whereSql}
    `,
    ...params
  );
  const total = Number(totalRow?.total) || 0;

  const rows = await db.all<any>(
    `
    SELECT *
    FROM reader_accounts
    WHERE ${whereSql}
    ORDER BY
      CASE
        WHEN last_update_time > 0 THEN last_update_time
        WHEN create_time > 0 THEN create_time
        ELSE 0
      END DESC,
      nickname COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
    `,
    ...params,
    limit,
    offset
  );

  return {
    list: rows.map(mapAccountRow),
    total,
    offset,
    limit,
  };
}

export async function importAccounts(authKey: string, accounts: ReaderAccount[]): Promise<void> {
  const db = await getSqliteDb();
  const now = nowSeconds();
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const source of accounts) {
      const fakeid = source?.fakeid;
      if (!fakeid) continue;
      await db.run(
        `
        INSERT INTO reader_accounts(
          auth_key, fakeid, completed, count, articles, source_type, source_url, site_url, description, category, focused, nickname, round_head_img, total_count, create_time, update_time, last_update_time
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(auth_key, fakeid) DO UPDATE SET
          completed = excluded.completed,
          count = excluded.count,
          articles = excluded.articles,
          source_type = excluded.source_type,
          source_url = excluded.source_url,
          site_url = excluded.site_url,
          description = excluded.description,
          category = excluded.category,
          focused = excluded.focused,
          nickname = excluded.nickname,
          round_head_img = excluded.round_head_img,
          total_count = excluded.total_count,
          update_time = excluded.update_time,
          last_update_time = excluded.last_update_time
        `,
        authKey,
        fakeid,
        0,
        0,
        0,
        normalizeSourceType(source.source_type),
        normalizeOptionalText(source.source_url),
        normalizeOptionalText(source.site_url),
        normalizeOptionalText(source.description),
        source.category || '',
        source.focused ? 1 : 0,
        source.nickname || '',
        source.round_head_img || '',
        0,
        now,
        now,
        0
      );
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

export async function deleteAccounts(authKey: string, fakeids: string[]): Promise<void> {
  const ids = Array.from(new Set((fakeids || []).filter(Boolean)));
  if (ids.length === 0) {
    return;
  }

  const db = await getSqliteDb();
  const placeholders = ids.map(() => '?').join(', ');

  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.run(
      `
      DELETE FROM reader_accounts
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM reader_articles
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM scheduler_articles
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_html
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_comment
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_resource
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_metadata
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_resource_map
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_asset
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_comment_reply
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );
    await db.run(
      `
      DELETE FROM cache_debug
      WHERE auth_key = ? AND fakeid IN (${placeholders})
      `,
      authKey,
      ...ids
    );

    const scheduler = await db.get<{ accounts_json: string }>(
      `SELECT accounts_json FROM scheduler_state WHERE auth_key = ?`,
      authKey
    );
    if (scheduler) {
      let accounts = [] as any[];
      try {
        const parsed = JSON.parse(scheduler.accounts_json || '[]');
        accounts = Array.isArray(parsed) ? parsed : [];
      } catch {
        accounts = [];
      }
      const filtered = accounts.filter(account => !ids.includes(String(account?.fakeid || '')));
      await db.run(
        `
        UPDATE scheduler_state
        SET accounts_json = ?, updated_at = ?
        WHERE auth_key = ?
        `,
        JSON.stringify(filtered),
        Date.now(),
        authKey
      );
    }

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

export async function upsertArticles(
  authKey: string,
  payload: {
    account: Partial<ReaderAccount> & { fakeid: string };
    articles: any[];
    totalCount?: number;
    completed?: boolean;
    messageCountDelta?: number;
  }
): Promise<{ inserted: number; totalCount: number }> {
  const db = await getSqliteDb();
  const fakeid = payload.account.fakeid;
  const articles = Array.isArray(payload.articles) ? payload.articles.map(normalizeArticleForStorage) : [];

  if (!fakeid || articles.length === 0) {
    await applyAccountDelta(
      authKey,
      {
        ...payload.account,
        fakeid,
        completed: Boolean(payload.completed),
        total_count: Number.isFinite(payload.totalCount) ? Number(payload.totalCount) : payload.account.total_count,
      },
      0,
      0
    );
    return {
      inserted: 0,
      totalCount: Number.isFinite(payload.totalCount)
        ? Number(payload.totalCount)
        : Number(payload.account.total_count) || 0,
    };
  }

  const dedupedByKey = new Map<string, Record<string, any>>();
  articles.forEach(article => {
    const key = buildArticleStorageKey(fakeid, article as any);
    dedupedByKey.set(key, article);
  });
  const articleWithKey = Array.from(dedupedByKey.entries()).map(([key, article]) => ({
    key,
    article,
  }));

  let inserted = 0;
  let inferredMessageDelta = 0;

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const { key, article } of articleWithKey) {
      const existed = await db.get<{ present: number }>(
        `
        SELECT 1 AS present
        FROM reader_articles
        WHERE auth_key = ? AND article_key = ?
        LIMIT 1
        `,
        authKey,
        key
      );
      const isNew = !existed;
      if (isNew) {
        inserted += 1;
        if (Number(article?.itemidx) === 1) {
          inferredMessageDelta += 1;
        }
      }

      await db.run(
        `
        INSERT INTO reader_articles(
          auth_key, fakeid, article_key, link, aid, appmsgid, itemidx, title, digest, author_name, create_time, update_time, is_deleted, status, data_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(auth_key, article_key) DO UPDATE SET
          fakeid = excluded.fakeid,
          link = excluded.link,
          aid = excluded.aid,
          appmsgid = excluded.appmsgid,
          itemidx = excluded.itemidx,
          title = excluded.title,
          digest = excluded.digest,
          author_name = excluded.author_name,
          create_time = excluded.create_time,
          update_time = excluded.update_time,
          data_json = excluded.data_json
        `,
        authKey,
        fakeid,
        key,
        String(article?.link || ''),
        String(article?.aid || ''),
        Number(article?.appmsgid) || 0,
        Number(article?.itemidx) || 0,
        String(article?.title || ''),
        String(article?.digest || ''),
        String(article?.author_name || ''),
        Number(article?.create_time) || 0,
        Number(article?.update_time) || 0,
        Number(article?.is_deleted) ? 1 : 0,
        String(article?._status || ''),
        JSON.stringify(article || {})
      );
    }

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  const messageDelta = Number.isFinite(payload.messageCountDelta)
    ? Math.max(0, Math.floor(Number(payload.messageCountDelta)))
    : inferredMessageDelta;
  const totalCount = Number.isFinite(payload.totalCount)
    ? Number(payload.totalCount)
    : Number(payload.account.total_count) || 0;
  const latestArticleTime = resolveLatestArticleTime(articles);

  await applyAccountDelta(
    authKey,
    {
      ...payload.account,
      fakeid,
      completed: Boolean(payload.completed),
      total_count: totalCount,
      last_update_time: latestArticleTime || Number(payload.account.last_update_time) || 0,
    },
    messageDelta,
    inserted
  );

  return {
    inserted,
    totalCount,
  };
}

export async function hitArticleCache(authKey: string, fakeid: string, createTime: number): Promise<boolean> {
  const db = await getSqliteDb();
  const row = await db.get<{ total: number }>(
    `
    SELECT COUNT(1) AS total
    FROM reader_articles
    WHERE auth_key = ? AND fakeid = ? AND create_time < ?
    `,
    authKey,
    fakeid,
    Number(createTime) || 0
  );
  return Number(row?.total) > 0;
}

export async function listArticleCache(
  authKey: string,
  fakeid: string,
  createTime: number,
  limit = 5000
): Promise<ReaderArticle[]> {
  const db = await getSqliteDb();
  const rows = await db.all<any>(
    `
    SELECT *
    FROM reader_articles
    WHERE auth_key = ? AND fakeid = ? AND create_time < ?
    ORDER BY create_time DESC
    LIMIT ?
    `,
    authKey,
    fakeid,
    Number(createTime) || 0,
    normalizeLimit(limit, 5000, 10000)
  );
  return rows.map(mapArticleRow);
}

export interface ArticleCacheSummary {
  cachedRows: number;
  cachedMessageCount: number;
  cachedAppmsgCount: number;
  oldestCreateTime: number;
}

export async function getArticleCacheSummary(
  authKey: string,
  fakeid: string,
  createTime: number
): Promise<ArticleCacheSummary> {
  const db = await getSqliteDb();
  const row = await db.get<{
    cached_rows: number;
    itemidx_count: number;
    appmsg_count: number;
    oldest_create_time: number;
  }>(
    `
    SELECT
      COUNT(1) AS cached_rows,
      SUM(CASE WHEN itemidx = 1 THEN 1 ELSE 0 END) AS itemidx_count,
      COUNT(DISTINCT CASE WHEN appmsgid > 0 THEN appmsgid END) AS appmsg_count,
      MIN(create_time) AS oldest_create_time
    FROM reader_articles
    WHERE auth_key = ? AND fakeid = ? AND create_time < ?
    `,
    authKey,
    fakeid,
    Number(createTime) || 0
  );

  const cachedRows = Number(row?.cached_rows) || 0;
  const itemidxCount = Number(row?.itemidx_count) || 0;
  const appmsgCount = Number(row?.appmsg_count) || 0;
  const oldestCreateTime = Number(row?.oldest_create_time) || 0;
  return {
    cachedRows,
    cachedMessageCount: itemidxCount || appmsgCount || 0,
    cachedAppmsgCount: appmsgCount,
    oldestCreateTime,
  };
}

export async function getArticleByLink(authKey: string, link: string): Promise<ReaderArticle | null> {
  const db = await getSqliteDb();
  const row = await db.get<any>(
    `
    SELECT
      a.fakeid,
      a.link,
      a.aid,
      a.appmsgid,
      a.itemidx,
      a.title,
      a.digest,
      a.author_name,
      a.create_time,
      a.update_time,
      a.favorite,
      a.ai_summary,
      a.ai_tags_json,
      a.is_deleted,
      a.status,
      ac.nickname AS account_nickname,
      ac.category AS account_category,
      ac.round_head_img AS account_round_head_img,
      ch.content_blob AS html_blob
    FROM reader_articles a
    LEFT JOIN reader_accounts ac ON ac.auth_key = a.auth_key AND ac.fakeid = a.fakeid
    LEFT JOIN cache_html ch ON ch.auth_key = a.auth_key AND ch.url = a.link
    WHERE a.auth_key = ? AND a.link = ?
    ORDER BY a.update_time DESC, a.create_time DESC
    LIMIT 1
    `,
    authKey,
    link
  );
  if (!row) {
    return null;
  }
  const article = mapArticleLiteRow(row);
  article.accountName = row.account_nickname || row.fakeid;
  article.category = row.account_category || '';
  article.cachedHtml = Buffer.isBuffer(row.html_blob)
    ? row.html_blob.toString('utf8')
    : row.html_blob instanceof Uint8Array
      ? Buffer.from(row.html_blob).toString('utf8')
      : String(row.html_blob || '');
  return article;
}

export async function updateArticleStatus(authKey: string, link: string, status: string): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    UPDATE reader_articles
    SET status = ?
    WHERE auth_key = ? AND link = ?
    `,
    status || '',
    authKey,
    link
  );
}

export async function updateArticleDeleted(authKey: string, link: string, isDeleted: boolean): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    UPDATE reader_articles
    SET is_deleted = ?
    WHERE auth_key = ? AND link = ?
    `,
    isDeleted ? 1 : 0,
    authKey,
    link
  );
}

export async function updateArticleFavorite(authKey: string, link: string, favorite: boolean): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    UPDATE reader_articles
    SET favorite = ?
    WHERE auth_key = ? AND link = ?
    `,
    favorite ? 1 : 0,
    authKey,
    link
  );
}

export async function updateArticleAiSummary(authKey: string, link: string, summary: string): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    UPDATE reader_articles
    SET ai_summary = ?, ai_summary_updated_at = ?
    WHERE auth_key = ? AND link = ?
    `,
    String(summary || '').trim(),
    nowSeconds(),
    authKey,
    link
  );
}

export async function updateArticleAiTags(authKey: string, link: string, tags: string[]): Promise<void> {
  const db = await getSqliteDb();
  const normalizedTags = normalizeAiTags(tags);
  await db.run(
    `
    UPDATE reader_articles
    SET ai_tags_json = ?, ai_tagged_at = ?
    WHERE auth_key = ? AND link = ?
    `,
    JSON.stringify(normalizedTags),
    nowSeconds(),
    authKey,
    link
  );
}

export async function deleteArticleByLink(authKey: string, link: string): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    DELETE FROM reader_articles
    WHERE auth_key = ? AND link = ?
    `,
    authKey,
    link
  );
}

export async function listArticlesPage(
  authKey: string,
  options: {
    offset?: number;
    limit?: number;
    fakeid?: string;
    category?: string;
    focused?: boolean;
    favorite?: boolean;
  } = {}
): Promise<{ list: ReaderArticle[]; total: number; offset: number; limit: number }> {
  const db = await getSqliteDb();
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 80, 500);

  const where: string[] = ['a.auth_key = ?'];
  const params: any[] = [authKey];

  if (options.fakeid) {
    where.push('a.fakeid = ?');
    params.push(options.fakeid);
  }
  if (typeof options.focused === 'boolean') {
    where.push('COALESCE(ac.focused, 0) = ?');
    params.push(options.focused ? 1 : 0);
  }
  if (typeof options.category === 'string' && options.category.trim()) {
    where.push("COALESCE(ac.category, '') = ?");
    params.push(options.category.trim());
  }
  if (typeof options.favorite === 'boolean') {
    where.push('a.favorite = ?');
    params.push(options.favorite ? 1 : 0);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db.get<{ total: number }>(
    `
    SELECT COUNT(1) AS total
    FROM reader_articles a
    LEFT JOIN reader_accounts ac ON ac.auth_key = a.auth_key AND ac.fakeid = a.fakeid
    WHERE ${whereSql}
    `,
    ...params
  );
  const total = Number(totalRow?.total) || 0;

  const rows = await db.all<any>(
    `
    SELECT
      a.fakeid,
      a.link,
      a.aid,
      a.appmsgid,
      a.itemidx,
      a.title,
      a.digest,
      a.author_name,
      a.create_time,
      a.update_time,
      a.favorite,
      a.ai_summary,
      a.ai_tags_json,
      a.is_deleted,
      a.status,
      ac.nickname AS account_nickname,
      ac.category AS account_category,
      ac.round_head_img AS account_round_head_img
    FROM reader_articles a
    LEFT JOIN reader_accounts ac ON ac.auth_key = a.auth_key AND ac.fakeid = a.fakeid
    WHERE ${whereSql}
    ORDER BY a.update_time DESC, a.create_time DESC
    LIMIT ? OFFSET ?
    `,
    ...params,
    limit,
    offset
  );

  const list = rows.map(row => {
    const article = mapArticleLiteRow(row);
    article.accountName = row.account_nickname || row.fakeid;
    article.category = row.account_category || '';
    return article;
  });

  return {
    list,
    total,
    offset,
    limit,
  };
}

export async function listAiDailyReports(
  authKey: string,
  options: { offset?: number; limit?: number } = {}
): Promise<{ list: ReaderAiDailyReport[]; total: number; offset: number; limit: number }> {
  const db = await getSqliteDb();
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 60, 365);

  const totalRow = await db.get<{ total: number }>(
    `
    SELECT COUNT(1) AS total
    FROM reader_ai_reports
    WHERE auth_key = ?
    `,
    authKey
  );

  const rows = await db.all<any>(
    `
    SELECT report_date, title, content_html, source_count, created_at, updated_at
    FROM reader_ai_reports
    WHERE auth_key = ?
    ORDER BY report_date DESC
    LIMIT ? OFFSET ?
    `,
    authKey,
    limit,
    offset
  );

  return {
    list: rows.map(mapAiDailyReportRow),
    total: Number(totalRow?.total) || 0,
    offset,
    limit,
  };
}

export async function getAiDailyReport(authKey: string, reportDate: string): Promise<ReaderAiDailyReport | null> {
  const db = await getSqliteDb();
  const row = await db.get<any>(
    `
    SELECT report_date, title, content_html, source_count, created_at, updated_at
    FROM reader_ai_reports
    WHERE auth_key = ? AND report_date = ?
    LIMIT 1
    `,
    authKey,
    String(reportDate || '').trim()
  );
  return row ? mapAiDailyReportRow(row) : null;
}

export async function upsertAiDailyReport(
  authKey: string,
  input: { reportDate: string; title: string; contentHtml: string; sourceCount?: number }
): Promise<ReaderAiDailyReport> {
  const db = await getSqliteDb();
  const now = Date.now();
  await db.run(
    `
    INSERT INTO reader_ai_reports(auth_key, report_date, title, content_html, source_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, report_date) DO UPDATE SET
      title = excluded.title,
      content_html = excluded.content_html,
      source_count = excluded.source_count,
      updated_at = excluded.updated_at
    `,
    authKey,
    String(input.reportDate || '').trim(),
    String(input.title || '').trim(),
    String(input.contentHtml || '').trim(),
    Number(input.sourceCount) || 0,
    now,
    now
  );

  return (await getAiDailyReport(authKey, input.reportDate)) as ReaderAiDailyReport;
}

export async function listAiProcessingArticles(
  authKey: string,
  options: { startTime: number; endTime: number; limit?: number }
): Promise<ReaderAiProcessingArticle[]> {
  const db = await getSqliteDb();
  const startTime = Math.max(0, Math.floor(Number(options.startTime) || 0));
  const endTime = Math.max(startTime, Math.floor(Number(options.endTime) || 0));
  const limit = normalizeLimit(options.limit, 80, 200);

  const rows = await db.all<any>(
    `
    SELECT
      a.fakeid,
      a.link,
      a.title,
      a.digest,
      a.author_name,
      a.create_time,
      a.update_time,
      a.ai_summary,
      a.ai_tags_json,
      a.ai_tagged_at,
      ac.nickname AS account_nickname,
      ch.content_blob AS html_blob
    FROM reader_articles a
    LEFT JOIN reader_accounts ac ON ac.auth_key = a.auth_key AND ac.fakeid = a.fakeid
    LEFT JOIN cache_html ch ON ch.auth_key = a.auth_key AND ch.url = a.link
    WHERE a.auth_key = ?
      AND COALESCE(NULLIF(a.update_time, 0), a.create_time) >= ?
      AND COALESCE(NULLIF(a.update_time, 0), a.create_time) < ?
      AND a.is_deleted = 0
    ORDER BY a.update_time DESC, a.create_time DESC
    LIMIT ?
    `,
    authKey,
    startTime,
    endTime,
    limit
  );

  return rows.map(row => ({
    fakeid: String(row.fakeid || ''),
    link: String(row.link || ''),
    title: String(row.title || ''),
    digest: String(row.digest || ''),
    authorName: String(row.author_name || ''),
    accountName: String(row.account_nickname || row.fakeid || ''),
    createTime: Number(row.create_time) || 0,
    updateTime: Number(row.update_time) || 0,
    aiTags: parseAiTagsJson(row.ai_tags_json),
    aiTaggedAt: Number(row.ai_tagged_at) || 0,
    aiSummary: String(row.ai_summary || ''),
    cachedHtml: Buffer.isBuffer(row.html_blob)
      ? row.html_blob.toString('utf8')
      : row.html_blob instanceof Uint8Array
        ? Buffer.from(row.html_blob).toString('utf8')
        : String(row.html_blob || ''),
  }));
}

export async function listAccountAiProcessingArticles(
  authKey: string,
  fakeid: string,
  options: { limit?: number } = {}
): Promise<ReaderAiProcessingArticle[]> {
  const db = await getSqliteDb();
  const normalizedFakeid = String(fakeid || '').trim();
  const limit = normalizeLimit(options.limit, 10, 40);

  if (!normalizedFakeid) {
    return [];
  }

  const rows = await db.all<any>(
    `
    SELECT
      a.fakeid,
      a.link,
      a.title,
      a.digest,
      a.author_name,
      a.create_time,
      a.update_time,
      a.ai_summary,
      a.ai_tags_json,
      a.ai_tagged_at,
      ac.nickname AS account_nickname,
      ch.content_blob AS html_blob
    FROM reader_articles a
    LEFT JOIN reader_accounts ac ON ac.auth_key = a.auth_key AND ac.fakeid = a.fakeid
    LEFT JOIN cache_html ch ON ch.auth_key = a.auth_key AND ch.url = a.link
    WHERE a.auth_key = ?
      AND a.fakeid = ?
      AND a.is_deleted = 0
    ORDER BY COALESCE(NULLIF(a.update_time, 0), a.create_time) DESC, a.create_time DESC
    LIMIT ?
    `,
    authKey,
    normalizedFakeid,
    limit
  );

  return rows.map(row => ({
    fakeid: String(row.fakeid || ''),
    link: String(row.link || ''),
    title: String(row.title || ''),
    digest: String(row.digest || ''),
    authorName: String(row.author_name || ''),
    accountName: String(row.account_nickname || row.fakeid || ''),
    createTime: Number(row.create_time) || 0,
    updateTime: Number(row.update_time) || 0,
    aiTags: parseAiTagsJson(row.ai_tags_json),
    aiTaggedAt: Number(row.ai_tagged_at) || 0,
    aiSummary: String(row.ai_summary || ''),
    cachedHtml: Buffer.isBuffer(row.html_blob)
      ? row.html_blob.toString('utf8')
      : row.html_blob instanceof Uint8Array
        ? Buffer.from(row.html_blob).toString('utf8')
        : String(row.html_blob || ''),
  }));
}
