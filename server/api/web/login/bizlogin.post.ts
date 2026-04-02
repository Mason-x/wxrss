import { getRequestHeader, type H3Event } from 'h3';
import { getMpCookie } from '~/server/kv/cookie';
import {
  findAuthKeyBindingByAccountInfo,
  getAuthKeyBindingByAuthKey,
  getAuthKeyBindingByIdentity,
  upsertAuthKeyBinding,
} from '~/server/repositories/auth-key-binding';
import { getUserAccessByIdentity } from '~/server/repositories/user-access';
import { cookieStore, getCookieFromResponse, getCookiesFromRequest } from '~/server/utils/CookieStore';
import { clearMpSession, resolvePreferenceRole } from '~/server/utils/mp-session';
import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';

interface LoginMpInfo {
  nick_name?: string;
  head_img?: string;
  user_name?: string;
  biz_uin?: string;
  alias?: string;
  identity_key?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCgiDataValue(html: string, keys: string[]): string {
  for (const key of keys) {
    const pattern = new RegExp(
      `(?:wx|window)\\.cgiData\\.${escapeRegExp(key)}\\s*=\\s*(['"])(?<value>[\\s\\S]*?)\\1`,
      'i'
    );
    const match = html.match(pattern);
    const value = match?.groups?.value;
    if (value) {
      return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    }
  }
  return '';
}

function extractLooseValue(html: string, keys: string[]): string {
  for (const key of keys) {
    const patterns = [
      new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*["'](?<value>[^"']+)["']`, 'i'),
      new RegExp(`${escapeRegExp(key)}\\s*=\\s*["'](?<value>[^"']+)["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const value = html.match(pattern)?.groups?.value?.trim();
      if (value) {
        return value;
      }
    }
  }
  return '';
}

function normalizeProfileValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\?.*$/, '');
}

function buildIdentityKey(info: { user_name?: string; biz_uin?: string; alias?: string }): string {
  if (info.user_name) {
    return `user_name:${info.user_name}`;
  }
  if (info.biz_uin) {
    return `biz_uin:${info.biz_uin}`;
  }
  if (info.alias) {
    return `alias:${info.alias}`;
  }
  return '';
}

function extractLoginMpInfo(html: string): LoginMpInfo {
  const nick_name = extractCgiDataValue(html, ['nick_name']) || extractLooseValue(html, ['nick_name']);
  const head_img = extractCgiDataValue(html, ['head_img']) || extractLooseValue(html, ['head_img']);
  const user_name =
    extractCgiDataValue(html, ['user_name', 'user_name_new']) ||
    extractLooseValue(html, ['user_name', 'user_name_new']);
  const biz_uin = extractCgiDataValue(html, ['bizuin', 'biz_uin']) || extractLooseValue(html, ['bizuin', 'biz_uin']);
  const alias = extractCgiDataValue(html, ['alias', 'wx_alias']) || extractLooseValue(html, ['alias', 'wx_alias']);

  const profileNickName = normalizeProfileValue(nick_name);
  const profileHeadImg = normalizeProfileValue(head_img);
  const identity_key =
    buildIdentityKey({ user_name, biz_uin, alias }) ||
    (profileNickName && profileHeadImg
      ? `profile:${profileNickName}|${profileHeadImg}`
      : profileNickName
        ? `profile:${profileNickName}`
        : '');

  return {
    nick_name,
    head_img,
    user_name,
    biz_uin,
    alias,
    identity_key,
  };
}

function mergeLoginMpInfo(base: LoginMpInfo, extra: LoginMpInfo): LoginMpInfo {
  const nick_name = String(base.nick_name || extra.nick_name || '').trim();
  const head_img = String(base.head_img || extra.head_img || '').trim();
  const user_name = String(base.user_name || extra.user_name || '').trim();
  const biz_uin = String(base.biz_uin || extra.biz_uin || '').trim();
  const alias = String(base.alias || extra.alias || '').trim();
  const identity_key =
    buildIdentityKey({ user_name, biz_uin, alias }) || String(base.identity_key || extra.identity_key || '').trim();

  return {
    nick_name,
    head_img,
    user_name,
    biz_uin,
    alias,
    identity_key,
  };
}

async function enrichLoginMpInfo(options: {
  event: H3Event;
  token: string;
  cookie: string;
  info: LoginMpInfo;
}): Promise<LoginMpInfo> {
  if (options.info.user_name || options.info.biz_uin || options.info.alias) {
    return options.info;
  }

  const attempts = [
    {
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/settingpage',
      query: {
        t: 'setting/index',
        action: 'index',
        token: options.token,
        lang: 'zh_CN',
      },
    },
    {
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/settingpage',
      query: {
        t: 'setting/index',
        token: options.token,
        lang: 'zh_CN',
      },
    },
  ] as const;

  let current = options.info;
  for (const attempt of attempts) {
    try {
      const html = await proxyMpRequest({
        event: options.event,
        method: 'GET',
        endpoint: attempt.endpoint,
        query: attempt.query,
        cookie: options.cookie,
        allowDirect: true,
      }).then(resp => resp.text());
      current = mergeLoginMpInfo(current, extractLoginMpInfo(html));
      if (current.user_name || current.biz_uin || current.alias) {
        break;
      }
    } catch {
      // Ignore fallback page failures and keep the fields extracted from home/index.
    }
  }

  return current;
}

function normalizeAuthKey(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'EXPIRED' || normalized === 'undefined' || normalized === 'null') {
    return '';
  }
  return normalized;
}

function isHttpsRequest(event: H3Event): boolean {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https';
  }
  const encrypted = (event.node.req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  return Boolean(encrypted);
}

function createAuthKeyCookie(event: H3Event, authKey: string, expiresAt: number): string {
  const secureAttr = isHttpsRequest(event) ? '; Secure' : '';
  const expires = new Date(expiresAt).toUTCString();
  return `auth-key=${authKey}; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax${secureAttr}`;
}

function replaceAuthKeySetCookie(headers: Headers, authKey: string, event: H3Event, expiresAt: number): void {
  const retainedSetCookies = headers.getSetCookie().filter(cookie => !cookie.startsWith('auth-key='));
  headers.delete('set-cookie');
  retainedSetCookies.forEach(cookie => {
    headers.append('set-cookie', cookie);
  });
  headers.append('set-cookie', createAuthKeyCookie(event, authKey, expiresAt));
}

async function resolveCanonicalAuthKey(options: {
  currentAuthKey: string;
  temporaryAuthKey: string;
  info: LoginMpInfo;
}): Promise<string> {
  const currentAuthKey = normalizeAuthKey(options.currentAuthKey);
  const temporaryAuthKey = normalizeAuthKey(options.temporaryAuthKey);
  const identityKey = String(options.info.identity_key || '').trim();
  const matchedBinding = await findAuthKeyBindingByAccountInfo({
    userName: options.info.user_name,
    bizUin: options.info.biz_uin,
    alias: options.info.alias,
    nickname: options.info.nick_name,
    headImg: options.info.head_img,
  });
  const matchedAuthKey = normalizeAuthKey(matchedBinding?.authKey);

  if (matchedAuthKey) {
    return matchedAuthKey;
  }

  if (identityKey) {
    const existingBinding = await getAuthKeyBindingByIdentity(identityKey);
    const boundAuthKey = normalizeAuthKey(existingBinding?.authKey);
    if (boundAuthKey) {
      return boundAuthKey;
    }

    if (currentAuthKey && currentAuthKey !== temporaryAuthKey) {
      const currentBinding = await getAuthKeyBindingByAuthKey(currentAuthKey);
      if (!currentBinding || currentBinding.identityKey === identityKey) {
        return currentAuthKey;
      }
    }
  }

  if (currentAuthKey && currentAuthKey !== temporaryAuthKey) {
    return currentAuthKey;
  }

  return temporaryAuthKey;
}

async function resolveEffectiveIdentityKey(options: {
  canonicalAuthKey: string;
  extractedIdentityKey: string;
}): Promise<string> {
  const extractedIdentityKey = String(options.extractedIdentityKey || '').trim();
  const canonicalAuthKey = normalizeAuthKey(options.canonicalAuthKey);
  if (!canonicalAuthKey) {
    return extractedIdentityKey;
  }

  const existingBinding = await getAuthKeyBindingByAuthKey(canonicalAuthKey);
  const existingIdentityKey = String(existingBinding?.identityKey || '').trim();
  if (!existingIdentityKey) {
    return extractedIdentityKey;
  }

  if (!extractedIdentityKey || extractedIdentityKey === existingIdentityKey) {
    return existingIdentityKey;
  }

  // Keep the existing owner binding stable once this auth_key has been bound.
  return existingIdentityKey;
}

async function promoteTemporarySession(temporaryAuthKey: string, canonicalAuthKey: string) {
  const temporaryKey = normalizeAuthKey(temporaryAuthKey);
  const canonicalKey = normalizeAuthKey(canonicalAuthKey);
  if (!temporaryKey || !canonicalKey) {
    return null;
  }
  if (temporaryKey === canonicalKey) {
    return await getMpCookie(canonicalKey);
  }

  const temporarySession = await getMpCookie(temporaryKey);
  if (!temporarySession) {
    return null;
  }

  await cookieStore.setCookieValue(canonicalKey, temporarySession);
  await cookieStore.deleteCookie(temporaryKey);
  return temporarySession;
}

function createLoginError(message = '登录失败，请刷新二维码后重试') {
  return { err: message };
}

export default defineEventHandler(async event => {
  try {
    const cookie = getCookiesFromRequest(event);
    const currentAuthKey = normalizeAuthKey(getAuthKeyFromRequest(event));

    const payload: Record<string, string | number> = {
      userlang: 'zh_CN',
      redirect_url: '',
      cookie_forbidden: 0,
      cookie_cleaned: 0,
      plugin_used: 0,
      login_type: 3,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    };

    const response: Response = await proxyMpRequest({
      event,
      method: 'POST',
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/bizlogin',
      query: {
        action: 'login',
      },
      body: payload,
      cookie,
      action: 'login',
    });

    const temporaryAuthKey = normalizeAuthKey(getCookieFromResponse('auth-key', response));
    if (!temporaryAuthKey) {
      return createLoginError();
    }

    const temporaryToken = await cookieStore.getToken(temporaryAuthKey);
    const temporaryCookie = await cookieStore.getCookie(temporaryAuthKey);
    if (!temporaryToken || !temporaryCookie) {
      return createLoginError('登录会话未建立，请刷新二维码后重试');
    }

    const homeHtml = await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/home',
      query: {
        t: 'home/index',
        token: temporaryToken,
        lang: 'zh_CN',
      },
      cookie: temporaryCookie,
      allowDirect: true,
    }).then(resp => resp.text());

    const extractedInfo = extractLoginMpInfo(homeHtml);
    const info = await enrichLoginMpInfo({
      event,
      token: temporaryToken,
      cookie: temporaryCookie,
      info: extractedInfo,
    });
    if (!info.nick_name) {
      return createLoginError('获取公众号资料失败，请刷新二维码后重试');
    }

    const canonicalAuthKey = await resolveCanonicalAuthKey({
      currentAuthKey,
      temporaryAuthKey,
      info,
    });
    const effectiveIdentityKey = await resolveEffectiveIdentityKey({
      canonicalAuthKey,
      extractedIdentityKey: info.identity_key || '',
    });

    const access = effectiveIdentityKey ? await getUserAccessByIdentity(effectiveIdentityKey) : null;
    if (access?.disabled) {
      await cookieStore.deleteCookie(temporaryAuthKey).catch(() => undefined);
      if (canonicalAuthKey && canonicalAuthKey !== temporaryAuthKey) {
        await cookieStore.deleteCookie(canonicalAuthKey).catch(() => undefined);
      }
      await clearMpSession(event, canonicalAuthKey || temporaryAuthKey);
      return createLoginError('当前公众号已被管理员禁止登录');
    }

    const promotedSession = await promoteTemporarySession(temporaryAuthKey, canonicalAuthKey);
    const sessionExpiresAt = Number(promotedSession?.expiresAt) || Date.now();

    if (effectiveIdentityKey) {
      await upsertAuthKeyBinding({
        identityKey: effectiveIdentityKey,
        authKey: canonicalAuthKey,
        userName: info.user_name,
        bizUin: info.biz_uin,
        alias: info.alias,
        nickname: info.nick_name,
        headImg: info.head_img,
      });
    }

    const headers = new Headers(response.headers);
    if (canonicalAuthKey !== temporaryAuthKey) {
      replaceAuthKeySetCookie(headers, canonicalAuthKey, event, sessionExpiresAt);
    }

    const body = JSON.stringify({
      nickname: info.nick_name,
      avatar: info.head_img,
      expires: new Date(sessionExpiresAt).toString(),
      auth_key: canonicalAuthKey,
      identity_key: effectiveIdentityKey,
      role: resolvePreferenceRole(effectiveIdentityKey),
    });

    headers.set('Content-Length', new TextEncoder().encode(body).length.toString());
    return new Response(body, { headers });
  } catch (error) {
    console.error('bizlogin failed:', error);
    return createLoginError();
  }
});
