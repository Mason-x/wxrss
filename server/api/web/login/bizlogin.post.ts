import dayjs from 'dayjs';
import { getRequestHeader, type H3Event } from 'h3';
import { request } from '#shared/utils/request';
import { getMpCookie } from '~/server/kv/cookie';
import { getAuthKeyBindingByAuthKey, getAuthKeyBindingByIdentity, upsertAuthKeyBinding } from '~/server/repositories/auth-key-binding';
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
  const currentAuthKey = String(options.currentAuthKey || '').trim();
  const temporaryAuthKey = String(options.temporaryAuthKey || '').trim();
  const identityKey = String(options.info.identity_key || '').trim();

  if (identityKey) {
    const existingBinding = await getAuthKeyBindingByIdentity(identityKey);
    if (existingBinding?.authKey) {
      return existingBinding.authKey;
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
  const temporaryKey = String(temporaryAuthKey || '').trim();
  const canonicalKey = String(canonicalAuthKey || '').trim();
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

export default defineEventHandler(async event => {
  const cookie = getCookiesFromRequest(event);
  const currentAuthKey = getAuthKeyFromRequest(event);

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

  const temporaryAuthKey = getCookieFromResponse('auth-key', response);
  if (!temporaryAuthKey) {
    return {
      err: '登录失败，请稍后重试',
    };
  }

  const info = await request<LoginMpInfo>('/api/web/mp/info', {
    headers: {
      Cookie: `auth-key=${temporaryAuthKey}`,
    },
  });

  if (!info?.nick_name) {
    return {
      err: '获取公众号昵称失败，请稍后重试',
    };
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
  });

  headers.set('Content-Length', new TextEncoder().encode(body).length.toString());
  return new Response(body, { headers });
});
