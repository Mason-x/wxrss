import { getSqliteDb } from '~/server/db/sqlite';

interface HtmlCachePayload {
  fakeid: string;
  url: string;
  title: string;
  commentID: string | null;
  mimeType: string;
  content: Buffer;
}

interface ResourceCachePayload {
  fakeid: string;
  url: string;
  mimeType: string;
  content: Buffer;
}

interface JsonCachePayload {
  fakeid: string;
  url: string;
  title?: string;
  data: any;
}

interface ResourceMapCachePayload {
  fakeid: string;
  url: string;
  resources: string[];
}

interface CommentReplyCachePayload {
  fakeid: string;
  url: string;
  title: string;
  contentID: string;
  data: any;
}

interface DebugCachePayload {
  fakeid: string;
  url: string;
  title: string;
  type: string;
  mimeType: string;
  content: Buffer;
}

export interface HtmlCacheEntity {
  fakeid: string;
  url: string;
  title: string;
  commentID: string | null;
  mimeType: string;
  content: Buffer;
}

export interface ResourceCacheEntity {
  fakeid: string;
  url: string;
  mimeType: string;
  content: Buffer;
}

export interface DebugCacheEntity {
  fakeid: string;
  url: string;
  title: string;
  type: string;
  mimeType: string;
  content: Buffer;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function upsertHtmlCache(authKey: string, payload: HtmlCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_html(auth_key, url, fakeid, title, comment_id, mime_type, content_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      title = excluded.title,
      comment_id = excluded.comment_id,
      mime_type = excluded.mime_type,
      content_blob = excluded.content_blob,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.title || '',
    payload.commentID || null,
    payload.mimeType || 'text/html; charset=utf-8',
    payload.content,
    Date.now()
  );
  return true;
}

export async function getHtmlCache(authKey: string, url: string): Promise<HtmlCacheEntity | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    title: string;
    comment_id: string | null;
    mime_type: string;
    content_blob: Buffer;
  }>(
    `
    SELECT fakeid, url, title, comment_id, mime_type, content_blob
    FROM cache_html
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    title: row.title || '',
    commentID: row.comment_id || null,
    mimeType: row.mime_type || 'text/html; charset=utf-8',
    content: row.content_blob,
  };
}

export async function deleteHtmlCache(authKey: string, url: string): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    DELETE FROM cache_html
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  return true;
}

export async function upsertCommentCache(authKey: string, payload: JsonCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_comment(auth_key, url, fakeid, title, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      title = excluded.title,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.title || '',
    JSON.stringify(payload.data ?? null),
    Date.now()
  );
  return true;
}

export async function getCommentCache(authKey: string, url: string): Promise<any | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    title: string;
    data_json: string;
  }>(
    `
    SELECT fakeid, url, title, data_json
    FROM cache_comment
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    title: row.title || '',
    data: parseJson(row.data_json, null),
  };
}

export async function upsertResourceCache(authKey: string, payload: ResourceCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_resource(auth_key, url, fakeid, mime_type, content_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      mime_type = excluded.mime_type,
      content_blob = excluded.content_blob,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.mimeType || 'application/octet-stream',
    payload.content,
    Date.now()
  );
  return true;
}

export async function getResourceCache(authKey: string, url: string): Promise<ResourceCacheEntity | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    mime_type: string;
    content_blob: Buffer;
  }>(
    `
    SELECT fakeid, url, mime_type, content_blob
    FROM cache_resource
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    mimeType: row.mime_type || 'application/octet-stream',
    content: row.content_blob,
  };
}

export async function upsertMetadataCache(authKey: string, payload: JsonCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_metadata(auth_key, url, fakeid, title, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      title = excluded.title,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.title || '',
    JSON.stringify(payload.data ?? null),
    Date.now()
  );
  return true;
}

export async function getMetadataCache(authKey: string, url: string): Promise<any | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    title: string;
    data_json: string;
  }>(
    `
    SELECT fakeid, url, title, data_json
    FROM cache_metadata
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  const data = parseJson<Record<string, any>>(row.data_json, {});
  return {
    ...data,
    fakeid: row.fakeid || data.fakeid || '',
    url: row.url || data.url || '',
    title: row.title || data.title || '',
  };
}

export async function upsertResourceMapCache(authKey: string, payload: ResourceMapCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_resource_map(auth_key, url, fakeid, resources_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      resources_json = excluded.resources_json,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    JSON.stringify(Array.isArray(payload.resources) ? payload.resources : []),
    Date.now()
  );
  return true;
}

export async function getResourceMapCache(authKey: string, url: string): Promise<any | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    resources_json: string;
  }>(
    `
    SELECT fakeid, url, resources_json
    FROM cache_resource_map
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    resources: parseJson<string[]>(row.resources_json, []),
  };
}

export async function upsertAssetCache(authKey: string, payload: ResourceCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_asset(auth_key, url, fakeid, mime_type, content_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      mime_type = excluded.mime_type,
      content_blob = excluded.content_blob,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.mimeType || 'application/octet-stream',
    payload.content,
    Date.now()
  );
  return true;
}

export async function getAssetCache(authKey: string, url: string): Promise<ResourceCacheEntity | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    mime_type: string;
    content_blob: Buffer;
  }>(
    `
    SELECT fakeid, url, mime_type, content_blob
    FROM cache_asset
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    mimeType: row.mime_type || 'application/octet-stream',
    content: row.content_blob,
  };
}

export async function upsertCommentReplyCache(authKey: string, payload: CommentReplyCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_comment_reply(auth_key, url, content_id, fakeid, title, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url, content_id) DO UPDATE SET
      fakeid = excluded.fakeid,
      title = excluded.title,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.contentID,
    payload.fakeid || '',
    payload.title || '',
    JSON.stringify(payload.data ?? null),
    Date.now()
  );
  return true;
}

export async function getCommentReplyCache(authKey: string, url: string, contentID: string): Promise<any | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    title: string;
    content_id: string;
    data_json: string;
  }>(
    `
    SELECT fakeid, url, title, content_id, data_json
    FROM cache_comment_reply
    WHERE auth_key = ? AND url = ? AND content_id = ?
    `,
    authKey,
    url,
    contentID
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    title: row.title || '',
    contentID: row.content_id || '',
    data: parseJson(row.data_json, null),
  };
}

export async function upsertDebugCache(authKey: string, payload: DebugCachePayload): Promise<boolean> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO cache_debug(auth_key, url, fakeid, title, type, mime_type, content_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_key, url) DO UPDATE SET
      fakeid = excluded.fakeid,
      title = excluded.title,
      type = excluded.type,
      mime_type = excluded.mime_type,
      content_blob = excluded.content_blob,
      updated_at = excluded.updated_at
    `,
    authKey,
    payload.url,
    payload.fakeid || '',
    payload.title || '',
    payload.type || '',
    payload.mimeType || 'text/html; charset=utf-8',
    payload.content,
    Date.now()
  );
  return true;
}

export async function getDebugCache(authKey: string, url: string): Promise<DebugCacheEntity | null> {
  const db = await getSqliteDb();
  const row = await db.get<{
    fakeid: string;
    url: string;
    title: string;
    type: string;
    mime_type: string;
    content_blob: Buffer;
  }>(
    `
    SELECT fakeid, url, title, type, mime_type, content_blob
    FROM cache_debug
    WHERE auth_key = ? AND url = ?
    `,
    authKey,
    url
  );
  if (!row) return null;
  return {
    fakeid: row.fakeid || '',
    url: row.url || '',
    title: row.title || '',
    type: row.type || '',
    mimeType: row.mime_type || 'text/html; charset=utf-8',
    content: row.content_blob,
  };
}

export async function listDebugCache(authKey: string, limit = 1000): Promise<DebugCacheEntity[]> {
  const db = await getSqliteDb();
  const rows = await db.all<{
    fakeid: string;
    url: string;
    title: string;
    type: string;
    mime_type: string;
    content_blob: Buffer;
  }>(
    `
    SELECT fakeid, url, title, type, mime_type, content_blob
    FROM cache_debug
    WHERE auth_key = ?
    ORDER BY updated_at DESC
    LIMIT ?
    `,
    authKey,
    Math.max(1, Math.min(5000, Math.floor(Number(limit) || 1000)))
  );

  return rows.map(row => ({
    fakeid: row.fakeid || '',
    url: row.url || '',
    title: row.title || '',
    type: row.type || '',
    mimeType: row.mime_type || 'text/html; charset=utf-8',
    content: row.content_blob,
  }));
}
