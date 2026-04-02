import { getRequestHeader, H3Event, parseCookies } from 'h3';
import type { CookieKVValue } from '~/server/kv/cookie';
import { deleteMpCookie, getMpCookie, setMpCookie } from '~/server/kv/cookie';

export type CookieEntity = Record<string, string | number>;

const FALLBACK_COOKIE_TTL_MS = 60 * 60 * 24 * 4 * 1000;

function getCookieTimestamp(value: unknown): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function computeCookieExpiryTimestamp(name: string, value: string): number {
  if (name === 'expires') {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  if (name === 'max-age') {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Date.now() + seconds * 1000 : 0;
  }

  return 0;
}

export class AccountCookie {
  private readonly _token: string;
  private _expiresAt: number;
  private _cookie: CookieEntity[];

  constructor(token: string, cookies: string[]) {
    this._token = token;
    this._cookie = AccountCookie.parse(cookies);
    this._expiresAt = AccountCookie.resolveExpiresAt(this._cookie);
  }

  static create(token: string, cookies: CookieEntity[], expiresAt?: number): AccountCookie {
    const value = new AccountCookie(token, []);
    value._cookie = cookies;
    value._expiresAt = getCookieTimestamp(expiresAt) || AccountCookie.resolveExpiresAt(cookies);
    return value;
  }

  static resolveExpiresAt(cookies: CookieEntity[], now = Date.now()): number {
    const candidates = cookies
      .filter(cookie => String(cookie.value || '') !== 'EXPIRED')
      .map(cookie => getCookieTimestamp(cookie.expires_timestamp))
      .filter(timestamp => timestamp > now);

    if (candidates.length > 0) {
      return Math.min(...candidates);
    }

    return now + FALLBACK_COOKIE_TTL_MS;
  }

  public toString(): string {
    return this.stringify(this._cookie);
  }

  public toJSON(): CookieKVValue {
    return {
      token: this._token,
      cookies: this._cookie,
      expiresAt: this._expiresAt,
    };
  }

  public get(name: string): CookieEntity | undefined {
    return this._cookie.find(cookie => cookie.name === name);
  }

  public get token() {
    return this._token;
  }

  public get expiresAt() {
    return this._expiresAt;
  }

  public get isExpired(): boolean {
    return this._expiresAt <= Date.now();
  }

  public static parse(cookies: string[]): CookieEntity[] {
    const cookieMap = new Map<string, CookieEntity>();

    for (const cookie of cookies) {
      const parts = String(cookie || '')
        .split(';')
        .map(str => str.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        continue;
      }

      const [nameValue, ...attributes] = parts;
      const [name, ...valueParts] = nameValue.split('=');
      const cookieName = String(name || '').trim();
      if (!cookieName) {
        continue;
      }

      const cookieObj: CookieEntity = {
        name: cookieName,
        value: valueParts.join('=').trim(),
      };

      for (const attribute of attributes) {
        const [key, ...attributeValueParts] = attribute.split('=');
        const attributeName = String(key || '')
          .trim()
          .toLowerCase();
        if (!attributeName) {
          continue;
        }

        const attributeValue = attributeValueParts.join('=').trim();
        cookieObj[attributeName] = attributeValue || 'true';

        const expiryTimestamp = computeCookieExpiryTimestamp(attributeName, attributeValue);
        if (expiryTimestamp > 0 || (attributeName === 'max-age' && attributeValue)) {
          cookieObj.expires_timestamp = expiryTimestamp;
        }
      }

      cookieMap.set(cookieName, cookieObj);
    }

    return Array.from(cookieMap.values());
  }

  private stringify(parsedCookie: CookieEntity[]): string {
    return parsedCookie
      .filter(cookie => cookie.value && cookie.value !== 'EXPIRED')
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

class CookieStore {
  store: Map<string, AccountCookie> = new Map<string, AccountCookie>();

  async getAccountCookie(authKey: string): Promise<AccountCookie | null> {
    let cachedAccountCookie = this.store.get(authKey);

    if (!cachedAccountCookie) {
      const cookieValue = await getMpCookie(authKey);
      if (!cookieValue) {
        return null;
      }

      cachedAccountCookie = AccountCookie.create(cookieValue.token, cookieValue.cookies, cookieValue.expiresAt);
      this.store.set(authKey, cachedAccountCookie);
    }

    return cachedAccountCookie;
  }

  async getCookie(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }
    return accountCookie.toString();
  }

  async setCookie(authKey: string, token: string, cookie: string[]): Promise<boolean> {
    const accountCookie = new AccountCookie(token, cookie);
    this.store.set(authKey, accountCookie);
    return await setMpCookie(authKey, accountCookie.toJSON());
  }

  async setCookieValue(authKey: string, value: CookieKVValue): Promise<boolean> {
    const accountCookie = AccountCookie.create(value.token, value.cookies, value.expiresAt);
    this.store.set(authKey, accountCookie);
    return await setMpCookie(authKey, accountCookie.toJSON());
  }

  async deleteCookie(authKey: string): Promise<boolean> {
    this.store.delete(authKey);
    return await deleteMpCookie(authKey);
  }

  async getToken(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }

    return accountCookie.token;
  }

  toJSON(): Record<string, AccountCookie> {
    const json: Record<string, AccountCookie> = {};
    for (const [authKey, accountCookie] of this.store) {
      json[authKey] = accountCookie;
    }
    return json;
  }
}

export const cookieStore = new CookieStore();

export async function getCookieFromStore(event: H3Event): Promise<string | null> {
  let cookie: string | null = null;

  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) {
      return cookie;
    }
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) {
      return cookie;
    }
  }

  return null;
}

export async function getTokenFromStore(event: H3Event): Promise<string | null> {
  let token: string | null = null;

  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) {
      return token;
    }
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) {
      return token;
    }
  }

  return null;
}

export function getCookiesFromRequest(event: H3Event): string {
  const cookies = parseCookies(event);
  return Object.keys(cookies)
    .map(key => `${key}=${encodeURIComponent(cookies[key])}`)
    .join(';');
}

export function getCookieFromResponse(name: string, response: Response): string | null {
  const cookies = AccountCookie.parse(response.headers.getSetCookie());
  const targetCookie = cookies.find(cookie => cookie.name === name);
  if (targetCookie) {
    return targetCookie.value as string;
  }
  return null;
}
