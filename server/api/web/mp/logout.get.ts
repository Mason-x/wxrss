import dayjs from 'dayjs';
import { appendResponseHeader, getRequestHeader, type H3Event } from 'h3';
import { cookieStore, getTokenFromStore } from '~/server/utils/CookieStore';
import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';

function isHttpsRequest(event: H3Event): boolean {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https';
  }
  const encrypted = (event.node.req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  return Boolean(encrypted);
}

function createExpiredCookie(event: H3Event, name: string): string {
  const secureAttr = isHttpsRequest(event) ? '; Secure' : '';
  return `${name}=EXPIRED; Path=/; Expires=${dayjs().subtract(1, 'days').toDate().toUTCString()}; HttpOnly; SameSite=Lax${secureAttr}`;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  const token = await getTokenFromStore(event);

  let statusCode = 200;
  let statusText = 'OK';

  if (token) {
    const response: Response = await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/logout',
      query: {
        t: 'wxm-logout',
        token,
        lang: 'zh_CN',
      },
    });
    statusCode = response.status;
    statusText = response.statusText;
  }

  if (authKey) {
    await cookieStore.deleteCookie(authKey);
  }

  appendResponseHeader(event, 'set-cookie', createExpiredCookie(event, 'auth-key'));
  appendResponseHeader(event, 'set-cookie', createExpiredCookie(event, 'uuid'));

  return {
    statusCode,
    statusText,
  };
});
