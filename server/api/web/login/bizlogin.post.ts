import dayjs from 'dayjs';
import { getRequestHeader, type H3Event } from 'h3';
import { getMpCookie } from '~/server/kv/cookie';
import {
  getAuthKeyBindingByAuthKey,
  getAuthKeyBindingByIdentity,
  upsertAuthKeyBinding,
} from '~/server/repositories/auth-key-binding';
import { cookieStore, getCookieFromResponse, getCookiesFromRequest } from '~/server/utils/CookieStore';
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

function createAuthKeyCookie(event: H3Event, authKey: string): string {
  const secureAttr = isHttpsRequest(event) ? '; Secure' : '';
  const expiresAt = dayjs().add(4, 'days').toDate().toUTCString();
  return `auth-key=${authKey}; Path=/; Expires=${expiresAt}; HttpOnly; SameSite=Lax${secureAttr}`;
}

function replaceAuthKeySetCookie(headers: Headers, authKey: string, event: H3Event): void {
  const retainedSetCookies = headers.getSetCookie().filter(cookie => !cookie.startsWith('auth-key='));
  headers.delete('set-cookie');
  retainedSetCookies.forEach(cookie => {
    headers.append('set-cookie', cookie);
  });
  headers.append('set-cookie', createAuthKeyCookie(event, authKey));
}

async function resolveCanonicalAuthKey(options: {
  currentAuthKey: string;
  temporaryAuthKey: string;
  info: LoginMpInfo;
}): Promise<string> {
  const currentAuthKey = normalizeAuthKey(options.currentAuthKey);
  const temporaryAuthKey = normalizeAuthKey(options.temporaryAuthKey);
  const identityKey = String(options.info.identity_key || '').trim();

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

async function promoteTemporarySession(temporaryAuthKey: string, canonicalAuthKey: string): Promise<void> {
  const temporaryKey = normalizeAuthKey(temporaryAuthKey);
  const canonicalKey = normalizeAuthKey(canonicalAuthKey);
  if (!temporaryKey || !canonicalKey || temporaryKey === canonicalKey) {
    return;
  }

  const temporarySession = await getMpCookie(temporaryKey);
  if (!temporarySession) {
    return;
  }

  await cookieStore.setCookieValue(canonicalKey, temporarySession);
  await cookieStore.deleteCookie(temporaryKey);
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
    }).then(resp => resp.text());

    const info = extractLoginMpInfo(homeHtml);
    if (!info.nick_name) {
      return createLoginError('获取公众号资料失败，请刷新二维码后重试');
    }

    const canonicalAuthKey = await resolveCanonicalAuthKey({
      currentAuthKey,
      temporaryAuthKey,
      info,
    });

    await promoteTemporarySession(temporaryAuthKey, canonicalAuthKey);

    if (info.identity_key) {
      await upsertAuthKeyBinding({
        identityKey: info.identity_key,
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
      replaceAuthKeySetCookie(headers, canonicalAuthKey, event);
    }

    const body = JSON.stringify({
      nickname: info.nick_name,
      avatar: info.head_img,
      expires: dayjs().add(4, 'days').toString(),
      auth_key: canonicalAuthKey,
      identity_key: info.identity_key || '',
    });

    headers.set('Content-Length', new TextEncoder().encode(body).length.toString());
    return new Response(body, { headers });
  } catch (error) {
    console.error('bizlogin failed:', error);
    return createLoginError();
  }
});
