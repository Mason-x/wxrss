import path from 'node:path';
import { request as httpsRequest } from 'node:https';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';

type ChildStartMessage = {
  type: 'start';
  payload: ReaderBatchAccountChildInput;
};

type ChildCancelMessage = {
  type: 'cancel';
};

type ChildInboundMessage = ChildStartMessage | ChildCancelMessage;

type ChildOutboundMessage =
  | { type: 'started'; pid: number; fakeid: string }
  | {
      type: 'account-start';
      fakeid: string;
      nickname: string;
      syncedMessages: number;
      totalMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'account-page';
      fakeid: string;
      nickname: string;
      begin: number;
      size: number;
      page: number;
      pageMessageCount: number;
      articleCount: number;
      inserted: number;
      totalInserted: number;
      totalCount: number;
      completed: boolean;
      syncedMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'account-done';
      fakeid: string;
      nickname: string;
      totalInserted: number;
      totalCount: number;
      syncedMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'success';
      fakeid: string;
      nickname: string;
      totalInserted: number;
      totalCount: number;
      syncedMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'canceled';
      fakeid: string;
      nickname: string;
      message: string;
    }
  | {
      type: 'error';
      fakeid: string;
      nickname: string;
      message: string;
    };

interface ReaderAccountRecord {
  fakeid: string;
  completed: boolean;
  count: number;
  articles: number;
  category?: string;
  focused?: boolean;
  nickname?: string;
  round_head_img?: string;
  total_count: number;
  create_time?: number;
  update_time?: number;
  last_update_time?: number;
}

interface ReaderBatchAccountChildInput {
  authKey: string;
  token: string;
  cookie: string;
  userAgent: string;
  timeoutMs: number;
  maxJsonBytes: number;
  syncTimestamp: number;
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
  account: ReaderAccountRecord;
}

interface DirectAppmsgPublishResponse {
  base_resp: {
    ret: number;
    err_msg?: string;
  };
  articles?: Record<string, any>[];
  total_count?: number;
  page_message_count?: number;
  completed?: boolean;
}

interface ArticleCacheSummary {
  cachedRows: number;
  cachedMessageCount: number;
  cachedAppmsgCount: number;
  oldestCreateTime: number;
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

const CANCEL_ERROR_MESSAGE = 'batch sync canceled';

let cancelRequested = false;
let started = false;

function sendMessage(message: ChildOutboundMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function sendMessageAsync(message: ChildOutboundMessage): Promise<void> {
  if (typeof process.send !== 'function') {
    return;
  }

  await new Promise<void>(resolve => {
    try {
      (process.send as any)(message, undefined, undefined, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function sendFinalMessageAndExit(message: ChildOutboundMessage, code: number): Promise<never> {
  await sendMessageAsync(message);
  try {
    if (typeof process.disconnect === 'function') {
      process.disconnect();
    }
  } catch {
    // Ignore disconnect errors and exit anyway.
  }
  process.exit(code);
}

function nowSeconds(): number {
  return Math.round(Date.now() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveDbPath(): string {
  const configured = process.env.SQLITE_DB_PATH || '.data/sqlite/app.db';
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

async function openDb(): Promise<Database> {
  const db = await open({
    filename: resolveDbPath(),
    driver: sqlite3.Database,
  });
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function buildArticleStorageKey(
  fakeid: string,
  article: Pick<any, 'aid' | 'appmsgid' | 'itemidx' | 'link' | 'create_time' | 'update_time' | 'title'>
): string {
  const aid = String(article?.aid || '').trim();
  if (aid) {
    return `${fakeid}:${aid}`;
  }

  if (Number.isFinite(article?.appmsgid) && Number(article.appmsgid) > 0) {
    return `${fakeid}:appmsg:${article.appmsgid}:${article?.itemidx || 0}`;
  }

  const link = String(article?.link || '').trim();
  if (link) {
    return `${fakeid}:link:${hashString(link)}`;
  }

  const fallback = `${fakeid}:${article?.create_time || 0}:${article?.update_time || 0}:${article?.title || ''}`;
  return `${fakeid}:fallback:${hashString(fallback)}`;
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

function compactArticlePayload(article: Record<string, any>): Record<string, any> {
  return {
    aid: String(article?.aid || ''),
    appmsgid: Number(article?.appmsgid) || 0,
    itemidx: Number(article?.itemidx) || 0,
    link: String(article?.link || ''),
    title: String(article?.title || ''),
    digest: String(article?.digest || ''),
    author_name: String(article?.author_name || ''),
    cover: String(article?.cover || ''),
    create_time: Number(article?.create_time) || 0,
    update_time: Number(article?.update_time) || 0,
    item_show_type: Number(article?.item_show_type) || 0,
    media_duration: String(article?.media_duration || ''),
    appmsg_album_infos: Array.isArray(article?.appmsg_album_infos) ? article.appmsg_album_infos : [],
    copyright_stat: Number(article?.copyright_stat) || 0,
    copyright_type: Number(article?.copyright_type) || 0,
    is_deleted: Boolean(article?.is_deleted),
    _status: String(article?._status || ''),
  };
}

function countMessagesFromArticles(articles: Record<string, any>[]): number {
  const countByItemidx = articles.filter(article => Number(article?.itemidx) === 1).length;
  const countByAppmsg = new Set(
    articles.map(article => Number(article?.appmsgid)).filter(appmsgid => Number.isFinite(appmsgid) && appmsgid > 0)
  ).size;
  return countByItemidx || countByAppmsg || (articles.length > 0 ? 1 : 0);
}

function isMeaningfulNickname(value?: string): boolean {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  return !/^\?+$/.test(text);
}

function resolveCategoryForUpsert(payloadCategory: unknown, currentCategory: unknown): string {
  if (typeof payloadCategory !== 'string') {
    return String(currentCategory || '');
  }
  if (!payloadCategory.trim()) {
    return String(currentCategory || '');
  }
  return payloadCategory;
}

function mapAccountRow(row: any): ReaderAccountRecord {
  return {
    fakeid: String(row.fakeid || ''),
    completed: Boolean(row.completed),
    count: Number(row.count) || 0,
    articles: Number(row.articles) || 0,
    category: String(row.category || ''),
    focused: Boolean(row.focused),
    nickname: String(row.nickname || ''),
    round_head_img: String(row.round_head_img || ''),
    total_count: Number(row.total_count) || 0,
    create_time: Number(row.create_time) || 0,
    update_time: Number(row.update_time) || 0,
    last_update_time: Number(row.last_update_time) || 0,
  };
}

async function getAccountByFakeid(db: Database, authKey: string, fakeid: string): Promise<ReaderAccountRecord | null> {
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

async function updateLastUpdateTime(db: Database, authKey: string, fakeid: string): Promise<void> {
  const now = nowSeconds();
  await db.run(
    `
    UPDATE reader_accounts
    SET last_update_time = ?, update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    now,
    now,
    authKey,
    fakeid
  );
}

async function applyAccountDelta(
  db: Database,
  authKey: string,
  payload: Partial<ReaderAccountRecord> & { fakeid: string; total_count?: number; completed?: boolean },
  messageDelta: number,
  articleDelta: number
): Promise<ReaderAccountRecord> {
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
    const created: ReaderAccountRecord = {
      fakeid: payload.fakeid,
      completed: Boolean(payload.completed),
      count: safeMessageDelta,
      articles: safeArticleDelta,
      category: typeof payload.category === 'string' ? payload.category : '',
      focused: Boolean(payload.focused),
      nickname: String(payload.nickname || ''),
      round_head_img: String(payload.round_head_img || ''),
      total_count: Number.isFinite(payload.total_count) ? Number(payload.total_count) : 0,
      create_time: now,
      update_time: now,
      last_update_time: Number.isFinite(payload.last_update_time) ? Number(payload.last_update_time) : 0,
    };

    await db.run(
      `
      INSERT INTO reader_accounts(
        auth_key, fakeid, completed, count, articles, category, focused, nickname, round_head_img, total_count, create_time, update_time, last_update_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      authKey,
      created.fakeid,
      created.completed ? 1 : 0,
      created.count,
      created.articles,
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

  const updated: ReaderAccountRecord = {
    fakeid: payload.fakeid,
    completed: Boolean(current.completed) || Boolean(payload.completed),
    count: (Number(current.count) || 0) + safeMessageDelta,
    articles: (Number(current.articles) || 0) + safeArticleDelta,
    category: resolveCategoryForUpsert(payload.category, current.category),
    focused: Boolean(current.focused) || Boolean(payload.focused),
    nickname: isMeaningfulNickname(payload.nickname) ? String(payload.nickname || '') : String(current.nickname || ''),
    round_head_img: String(payload.round_head_img || current.round_head_img || ''),
    total_count: Number.isFinite(payload.total_count) ? Number(payload.total_count) : Number(current.total_count) || 0,
    create_time: Number(current.create_time) || now,
    update_time: now,
    last_update_time: Number.isFinite(payload.last_update_time)
      ? Number(payload.last_update_time)
      : Number(current.last_update_time) || 0,
  };

  await db.run(
    `
    UPDATE reader_accounts
    SET completed = ?, count = ?, articles = ?, category = ?, focused = ?, nickname = ?, round_head_img = ?, total_count = ?, update_time = ?, last_update_time = ?
    WHERE auth_key = ? AND fakeid = ?
    `,
    updated.completed ? 1 : 0,
    updated.count,
    updated.articles,
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

async function upsertArticles(
  db: Database,
  authKey: string,
  payload: {
    account: Partial<ReaderAccountRecord> & { fakeid: string };
    articles: any[];
    totalCount?: number;
    completed?: boolean;
    messageCountDelta?: number;
  }
): Promise<{ inserted: number; totalCount: number }> {
  const fakeid = payload.account.fakeid;
  const articles = Array.isArray(payload.articles) ? payload.articles.map(normalizeArticleForStorage) : [];

  if (!fakeid || articles.length === 0) {
    await applyAccountDelta(
      db,
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
      totalCount: Number.isFinite(payload.totalCount) ? Number(payload.totalCount) : Number(payload.account.total_count) || 0,
    };
  }

  const dedupedByKey = new Map<string, Record<string, any>>();
  for (const article of articles) {
    const key = buildArticleStorageKey(fakeid, article as any);
    dedupedByKey.set(key, article);
  }

  let inserted = 0;
  let inferredMessageDelta = 0;

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, article] of dedupedByKey.entries()) {
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

  await applyAccountDelta(
    db,
    authKey,
    {
      ...payload.account,
      fakeid,
      completed: Boolean(payload.completed),
      total_count: totalCount,
    },
    messageDelta,
    inserted
  );

  return {
    inserted,
    totalCount,
  };
}

async function getArticleCacheSummary(
  db: Database,
  authKey: string,
  fakeid: string,
  createTime: number
): Promise<ArticleCacheSummary> {
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

async function fetchAppmsgPublishDirect(
  token: string,
  cookie: string,
  fakeid: string,
  begin: number,
  size: number,
  userAgent: string,
  timeoutMs: number,
  maxJsonBytes: number
): Promise<DirectAppmsgPublishResponse> {
  const endpoint = new URL('https://mp.weixin.qq.com/cgi-bin/appmsgpublish');
  endpoint.search = new URLSearchParams({
    sub: 'list',
    search_field: 'null',
    begin: String(begin),
    count: String(size),
    query: '',
    fakeid,
    type: '101_1',
    free_publish_type: '1',
    sub_action: 'list_ex',
    token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  }).toString();

  const text = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port ? Number(endpoint.port) : undefined,
        path: endpoint.pathname + endpoint.search,
        method: 'GET',
        headers: {
          Referer: 'https://mp.weixin.qq.com/',
          Origin: 'https://mp.weixin.qq.com',
          'User-Agent': userAgent,
          'Accept-Encoding': 'identity',
          Connection: 'close',
          Cookie: cookie,
        },
        agent: false,
      },
      response => {
        const status = Number(response.statusCode || 0);
        const contentLength = Number(response.headers['content-length'] || 0);
        if (Number.isFinite(contentLength) && contentLength > maxJsonBytes) {
          response.resume();
          reject(new Error(`mp response too large(status=${status}, content-length=${contentLength}, limit=${maxJsonBytes})`));
          return;
        }

        response.setEncoding('utf8');
        let bytes = 0;
        let body = '';
        let settled = false;

        const fail = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          response.destroy();
          reject(error);
        };

        response.on('data', chunk => {
          const chunkText = String(chunk || '');
          bytes += Buffer.byteLength(chunkText, 'utf8');
          if (bytes > maxJsonBytes) {
            fail(new Error(`mp response too large(status=${status}, bytes=${bytes}, limit=${maxJsonBytes})`));
            return;
          }
          body += chunkText;
        });
        response.on('end', () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(body);
        });
        response.on('error', error => {
          fail(error instanceof Error ? error : new Error(String(error)));
        });
      }
    );

    req.on('error', error => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    req.setTimeout(Math.max(1000, timeoutMs), () => {
      req.destroy(new Error(`mp request timeout(timeoutMs=${timeoutMs})`));
    });
    req.end();
  });

  let raw: Record<string, any>;
  try {
    raw = JSON.parse(text || '{}') as Record<string, any>;
  } catch {
    throw new Error(`mp response is not json: ${String(text || '').slice(0, 220)}`);
  }

  if (!raw?.base_resp) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'invalid appmsgpublish response',
      },
    };
  }

  if (Number(raw.base_resp.ret) !== 0) {
    return {
      base_resp: {
        ret: Number(raw.base_resp.ret) || -1,
        err_msg: String(raw.base_resp.err_msg || 'appmsgpublish failed'),
      },
    };
  }

  let publishPage: { total_count?: number; publish_list?: Array<{ publish_info?: string }> };
  try {
    publishPage = JSON.parse(String(raw.publish_page || '{}')) as {
      total_count?: number;
      publish_list?: Array<{ publish_info?: string }>;
    };
  } catch {
    throw new Error('appmsgpublish publish_page parse failed');
  }

  const publishList = Array.isArray(publishPage.publish_list) ? publishPage.publish_list : [];
  const articles: Record<string, any>[] = [];
  let pageMessageCount = 0;

  for (const item of publishList) {
    if (!item?.publish_info) {
      continue;
    }
    pageMessageCount += 1;
    try {
      const publishInfo = JSON.parse(String(item.publish_info || '{}')) as {
        appmsgex?: Record<string, any>[];
      };
      const appmsgList = Array.isArray(publishInfo.appmsgex) ? publishInfo.appmsgex : [];
      for (const article of appmsgList) {
        articles.push(compactArticlePayload(article));
      }
    } catch {
      // Ignore malformed publish_info blocks and continue syncing.
    }
  }

  return {
    base_resp: {
      ret: 0,
      err_msg: String(raw.base_resp.err_msg || ''),
    },
    articles,
    total_count: Number(publishPage.total_count) || 0,
    page_message_count: pageMessageCount,
    completed: pageMessageCount === 0,
  };
}

function ensureNotCanceled(): void {
  if (!cancelRequested) {
    return;
  }
  throw new Error(CANCEL_ERROR_MESSAGE);
}

async function syncOneAccount(db: Database, payload: ReaderBatchAccountChildInput) {
  const account = payload.account;
  const fakeid = String(account.fakeid || '');
  const nickname = String(account.nickname || fakeid);
  const originalLastUpdateTime = Number(account.last_update_time) || 0;
  let begin = 0;
  let page = 0;
  let totalInserted = 0;
  let latestTotalCount = Number(account.total_count) || 0;

  sendMessage({
    type: 'account-start',
    fakeid,
    nickname,
    syncedMessages: Number(account.count) || 0,
    totalMessages: Number(account.total_count) || 0,
    syncedArticles: Number(account.articles) || 0,
  });

  for (;;) {
    ensureNotCanceled();
    const size = begin === 0 ? 1 : 10;
    const resp = await fetchAppmsgPublishDirect(
      payload.token,
      payload.cookie,
      fakeid,
      begin,
      size,
      payload.userAgent,
      payload.timeoutMs,
      payload.maxJsonBytes
    );
    if (Number(resp.base_resp.ret) === 200003) {
      throw new Error('session expired');
    }
    if (Number(resp.base_resp.ret) !== 0) {
      throw new Error(`${resp.base_resp.ret}:${resp.base_resp.err_msg || 'appmsgpublish failed'}`);
    }

    const articles = Array.isArray(resp.articles) ? resp.articles : [];
    const totalCount = Number(resp.total_count) || latestTotalCount;
    const pageMessageCount = Number(resp.page_message_count) || 0;
    const completed = Boolean(resp.completed);
    latestTotalCount = totalCount;

    const upsertResult = await upsertArticles(db, payload.authKey, {
      account: {
        fakeid: account.fakeid,
        nickname: account.nickname || '',
        round_head_img: account.round_head_img || '',
        category: account.category || '',
        focused: Boolean(account.focused),
        total_count: totalCount,
      },
      articles,
      totalCount,
      completed,
    });
    totalInserted += Number(upsertResult.inserted) || 0;

    if (begin === 0 && Number(upsertResult.inserted) > 0) {
      await updateLastUpdateTime(db, payload.authKey, fakeid);
    }

    const latestAccount = await getAccountByFakeid(db, payload.authKey, fakeid);
    const syncedMessages = Number(latestAccount?.count) || begin;
    const syncedArticles = Number(latestAccount?.articles) || totalInserted;
    sendMessage({
      type: 'account-page',
      fakeid,
      nickname,
      begin,
      size,
      page,
      pageMessageCount,
      articleCount: articles.length,
      inserted: Number(upsertResult.inserted) || 0,
      totalInserted,
      totalCount,
      completed,
      syncedMessages,
      syncedArticles,
    });

    const noNewOnThisPage = pageMessageCount > 0 && Number(upsertResult.inserted) === 0;
    if (completed || noNewOnThisPage) {
      break;
    }

    let step = pageMessageCount > 0 ? pageMessageCount : countMessagesFromArticles(articles);
    if (step <= 0) {
      step = 1;
    }
    begin += step;

    let shouldLoadMore = true;
    let cacheBoundaryCreateTime = 0;
    const lastArticle = articles.at(-1);
    if (lastArticle && originalLastUpdateTime > 0 && Number(lastArticle.create_time) < originalLastUpdateTime) {
      const summary = await getArticleCacheSummary(db, payload.authKey, fakeid, Number(lastArticle.create_time) || 0);
      if (summary.cachedRows > 0) {
        begin += Number(summary.cachedMessageCount) || 0;
        cacheBoundaryCreateTime = Number(summary.oldestCreateTime) || 0;
      }
    }

    const tailCreateTime = cacheBoundaryCreateTime > 0
      ? cacheBoundaryCreateTime
      : Number(lastArticle?.create_time) || 0;
    if (tailCreateTime > 0 && tailCreateTime < payload.syncTimestamp) {
      shouldLoadMore = false;
    }

    page += 1;
    if (!shouldLoadMore) {
      break;
    }

    await sleep(pickRandomSyncDelayMs(payload));
  }

  const latestAccount = await getAccountByFakeid(db, payload.authKey, fakeid);
  const syncedMessages = Number(latestAccount?.count) || begin;
  const syncedArticles = Number(latestAccount?.articles) || totalInserted;
  sendMessage({
    type: 'account-done',
    fakeid,
    nickname,
    totalInserted,
    totalCount: latestTotalCount,
    syncedMessages,
    syncedArticles,
  });

  return {
    fakeid,
    nickname,
    totalInserted,
    totalCount: latestTotalCount,
    syncedMessages,
    syncedArticles,
  };
}

function waitForStartPayload(): Promise<ReaderBatchAccountChildInput> {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1000, Number(process.env.MP_REQUEST_TIMEOUT_MS || 30000)) + 5000;
    const timer = setTimeout(() => {
      reject(new Error('batch child start payload timeout'));
    }, timeoutMs);

    const onMessage = (message: ChildInboundMessage) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'cancel') {
        cancelRequested = true;
        return;
      }
      if (message.type !== 'start' || !message.payload) {
        return;
      }
      clearTimeout(timer);
      process.off('message', onMessage);
      process.on('message', next => {
        if (next && typeof next === 'object' && (next as ChildInboundMessage).type === 'cancel') {
          cancelRequested = true;
        }
      });
      resolve(message.payload);
    };

    process.on('message', onMessage);
  });
}

process.on('SIGTERM', () => {
  cancelRequested = true;
});
process.on('SIGINT', () => {
  cancelRequested = true;
});

try {
  const payload = await waitForStartPayload();
  if (started) {
    throw new Error('batch child already started');
  }
  started = true;
  sendMessage({
    type: 'started',
    pid: process.pid,
    fakeid: String(payload.account.fakeid || ''),
  });

  const db = await openDb();
  try {
    const result = await syncOneAccount(db, payload);
    await sendFinalMessageAndExit({
      type: 'success',
      ...result,
    }, 0);
  } finally {
    await db.close();
  }
} catch (error) {
  const message = String((error as Error)?.message || error || 'sync failed');
  if (message === CANCEL_ERROR_MESSAGE) {
    await sendFinalMessageAndExit({
      type: 'canceled',
      fakeid: '',
      nickname: '',
      message,
    }, 0);
  }

  await sendFinalMessageAndExit({
    type: 'error',
    fakeid: '',
    nickname: '',
    message,
  }, 1);
}
