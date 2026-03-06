import { type CookieEntity } from '~/server/utils/CookieStore';
import { getSqliteDb } from '~/server/db/sqlite';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
}

const COOKIE_TTL_MS = 60 * 60 * 24 * 4 * 1000; // 4 days

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  try {
    const db = await getSqliteDb();
    const now = Date.now();
    await db.run(
      `
      INSERT INTO mp_cookie(auth_key, token, cookies_json, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(auth_key) DO UPDATE SET
        token = excluded.token,
        cookies_json = excluded.cookies_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      `,
      key,
      data.token,
      JSON.stringify(Array.isArray(data.cookies) ? data.cookies : []),
      now + COOKIE_TTL_MS,
      now
    );
    return true;
  } catch (err) {
    console.error('sqlite setMpCookie failed:', err);
    return false;
  }
}

export async function getMpCookie(key: CookieKVKey): Promise<CookieKVValue | null> {
  try {
    const db = await getSqliteDb();
    const now = Date.now();
    const row = await db.get<{
      token: string;
      cookies_json: string;
      expires_at: number;
    }>(
      `
      SELECT token, cookies_json, expires_at
      FROM mp_cookie
      WHERE auth_key = ?
      `,
      key
    );

    if (!row) {
      const kv = useStorage('kv');
      const legacy = await kv.get<CookieKVValue>(`cookie:${key}`);
      if (legacy) {
        await setMpCookie(key, legacy);
      }
      return legacy || null;
    }

    if (row.expires_at <= now) {
      await db.run(`DELETE FROM mp_cookie WHERE auth_key = ?`, key);
      return null;
    }

    let cookies: CookieEntity[] = [];
    try {
      const parsed = JSON.parse(row.cookies_json || '[]');
      cookies = Array.isArray(parsed) ? parsed : [];
    } catch {
      cookies = [];
    }

    return {
      token: row.token,
      cookies,
    };
  } catch (err) {
    console.error('sqlite getMpCookie failed:', err);
    return null;
  }
}
