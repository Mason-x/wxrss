import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions as NativeRequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import dayjs from 'dayjs';
import { H3Event, parseCookies } from 'h3';
import { v4 as uuidv4 } from 'uuid';
import { isDev, USER_AGENT } from '~/config';
import type { RequestOptions } from '~/server/types';
import { cookieStore, getCookieFromStore } from '~/server/utils/CookieStore';
import { logRequest, logResponse } from '~/server/utils/logger';
import { isMemoryDebugEnabled, logMemory } from '~/server/utils/memory-debug';

interface NativeTextResponse {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  text: string;
  bytes: number;
}

function toMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function getDebugMpRequestEnabled(): boolean {
  return process.env.NUXT_DEBUG_MP_REQUEST === 'true' && isDev;
}

function getMaxJsonBytes(): number {
  return Math.max(1024 * 1024, Number(process.env.MP_PROXY_MAX_JSON_BYTES || 8 * 1024 * 1024));
}

function getSoftHeapLimitMb(): number | null {
  const configured = Number(process.env.MP_PROXY_SOFT_HEAP_MB || 3000);
  if (!Number.isFinite(configured) || configured <= 0) {
    return null;
  }
  return Math.floor(configured);
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value || '');
}

function assertProxyHeapAvailable(
  endpoint: string,
  method: string,
  requestId: string,
  debugMemory: boolean,
  stage: string
): void {
  const limitMb = getSoftHeapLimitMb();
  if (!limitMb) {
    return;
  }

  const heapUsedMb = toMb(process.memoryUsage().heapUsed);
  if (heapUsedMb < limitMb) {
    return;
  }

  if (debugMemory) {
    logMemory(stage, {
      endpoint,
      method,
      requestId,
      limitMb,
    });
  }

  throw new Error(`mp proxy aborted due to heap pressure(heapUsedMb=${heapUsedMb}, limitMb=${limitMb})`);
}

async function readJsonTextWithNativeHttp(options: {
  endpoint: string;
  method: RequestOptions['method'];
  headers: Headers;
  bodyText?: string;
  timeoutMs: number;
  maxBytes: number;
  redirect?: RequestRedirect;
  requestId: string;
  debugMemory: boolean;
  redirectCount?: number;
}): Promise<NativeTextResponse> {
  const targetUrl = new URL(options.endpoint);
  const requestImpl = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const requestHeaders = new Headers(options.headers);

  // Avoid pooling retained sockets on the JSON proxy path.
  requestHeaders.set('Connection', 'close');
  if (options.bodyText) {
    if (!requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', 'application/x-www-form-urlencoded; charset=UTF-8');
    }
    requestHeaders.set('content-length', Buffer.byteLength(options.bodyText, 'utf8').toString());
  }

  return await new Promise((resolve, reject) => {
    const requestOptions: NativeRequestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port ? Number(targetUrl.port) : undefined,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: options.method,
      headers: Object.fromEntries(requestHeaders.entries()),
      agent: false,
    };

    const req = requestImpl(requestOptions, response => {
      const status = Number(response.statusCode || 0);
      const statusText = response.statusMessage || '';
      const location = getHeaderValue(response.headers, 'location');
      const shouldRedirect = options.redirect !== 'manual' && Boolean(location) && [301, 302, 303, 307, 308].includes(status);

      if (shouldRedirect) {
        response.resume();
        const redirectCount = Number(options.redirectCount || 0);
        if (redirectCount >= 5) {
          reject(new Error(`mp response redirected too many times(status=${status})`));
          return;
        }

        const nextMethod = status === 303 && options.method !== 'GET' ? 'GET' : options.method;
        const nextBodyText = nextMethod === options.method ? options.bodyText : undefined;
        resolve(readJsonTextWithNativeHttp({
          ...options,
          endpoint: new URL(location, targetUrl).toString(),
          method: nextMethod,
          bodyText: nextBodyText,
          redirectCount: redirectCount + 1,
        }));
        return;
      }

      const contentLength = Number(getHeaderValue(response.headers, 'content-length') || 0);
      const contentType = getHeaderValue(response.headers, 'content-type');
      if (options.debugMemory) {
        logMemory('proxy-mp:response-received', {
          endpoint: options.endpoint,
          method: options.method,
          status,
          contentLength,
          contentType,
          requestId: options.requestId,
        });
      }

      assertProxyHeapAvailable(
        options.endpoint,
        options.method,
        options.requestId,
        options.debugMemory,
        'proxy-mp:memory-pressure-after-response'
      );

      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        response.resume();
        reject(new Error(`mp response too large(status=${status}, content-length=${contentLength}, limit=${options.maxBytes})`));
        return;
      }

      if (options.debugMemory) {
        logMemory('proxy-mp:json-read-start', {
          endpoint: options.endpoint,
          method: options.method,
          requestId: options.requestId,
          limit: options.maxBytes,
        });
      }

      response.setEncoding('utf8');
      let bytes = 0;
      let text = '';
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
        if (bytes > options.maxBytes) {
          fail(new Error(`mp response too large(status=${status}, bytes=${bytes}, limit=${options.maxBytes})`));
          return;
        }
        text += chunkText;
      });

      response.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        if (options.debugMemory) {
          logMemory('proxy-mp:json-read-done', {
            endpoint: options.endpoint,
            method: options.method,
            requestId: options.requestId,
            bytes,
          });
        }
        resolve({
          status,
          statusText,
          headers: response.headers,
          text,
          bytes,
        });
      });

      response.on('error', error => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });

    req.on('error', error => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`mp request timeout(timeoutMs=${options.timeoutMs})`));
    });

    if (options.bodyText) {
      req.write(options.bodyText);
    }
    req.end();
  });
}

function isHttpsRequest(event: H3Event): boolean {
  const xForwardedProto = getRequestHeader(event, 'x-forwarded-proto');
  if (xForwardedProto) {
    const proto = xForwardedProto.split(',')[0]?.trim().toLowerCase();
    return proto === 'https';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Boolean((event as any)?.node?.req?.socket?.encrypted);
}

export async function proxyMpRequest(options: RequestOptions) {
  const headers = new Headers({
    Referer: options.referer || 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity',
  });

  const cookie: string | null = options.cookie || (await getCookieFromStore(options.event));
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  const redirect = options.redirect || 'follow';
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.MP_REQUEST_TIMEOUT_MS || 30000));
  const endpoint = options.query
    ? `${options.endpoint}?${new URLSearchParams(options.query as Record<string, string>).toString()}`
    : options.endpoint;
  const bodyText = options.method === 'POST' && options.body
    ? new URLSearchParams(options.body as Record<string, string>).toString()
    : undefined;

  const requestInit: RequestInit = {
    method: options.method,
    headers,
    redirect,
  };
  if (bodyText) {
    requestInit.body = bodyText;
  }

  const debugMemory = isMemoryDebugEnabled();
  if (debugMemory) {
    logMemory('proxy-mp:request-start', {
      endpoint,
      method: options.method,
      parseJson: Boolean(options.parseJson),
      action: options.action || '',
    });
  }

  const requestId = uuidv4().replace(/-/g, '');
  const debugMpRequestEnabled = getDebugMpRequestEnabled();
  const request = new Request(endpoint, requestInit);
  if (debugMpRequestEnabled) {
    await logRequest(requestId, request.clone());
  }

  if (options.parseJson) {
    const maxJsonBytes = getMaxJsonBytes();
    assertProxyHeapAvailable(
      endpoint,
      options.method,
      requestId,
      debugMemory,
      'proxy-mp:memory-pressure-before-request'
    );

    const { text, bytes, status } = await readJsonTextWithNativeHttp({
      endpoint,
      method: options.method,
      headers,
      bodyText,
      timeoutMs,
      maxBytes: maxJsonBytes,
      redirect,
      requestId,
      debugMemory,
    });

    try {
      const parsed = JSON.parse(text || '{}');
      if (debugMemory) {
        logMemory('proxy-mp:json-parse-done', {
          endpoint,
          method: options.method,
          requestId,
          bytes,
        });
      }
      return parsed;
    } catch {
      const preview = (text || '').slice(0, 220);
      if (debugMemory) {
        logMemory('proxy-mp:json-parse-failed', {
          endpoint,
          method: options.method,
          requestId,
          bytes,
        });
      }
      throw new Error(`mp response is not json(status=${status}): ${preview}`);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  requestInit.signal = controller.signal;

  let mpResponse: Response;
  try {
    mpResponse = await fetch(new Request(endpoint, requestInit));
  } finally {
    clearTimeout(timer);
  }

  if (debugMemory) {
    logMemory('proxy-mp:response-received', {
      endpoint,
      method: options.method,
      status: mpResponse.status,
      contentLength: Number(mpResponse.headers.get('content-length') || 0),
      contentType: mpResponse.headers.get('content-type') || '',
      requestId,
    });
  }

  if (debugMpRequestEnabled) {
    await logResponse(requestId, mpResponse.clone());
  }

  let setCookies: string[] = [];

  if (options.action === 'start_login') {
    setCookies = mpResponse.headers.getSetCookie().filter(cookieValue => cookieValue.startsWith('uuid='));
  } else if (options.action === 'login') {
    try {
      const authKey = crypto.randomUUID().replace(/-/g, '');
      const { redirect_url } = await mpResponse.clone().json();
      const token = new URL(`http://localhost${redirect_url}`).searchParams.get('token')!;
      const success = await cookieStore.setCookie(authKey, token, mpResponse.headers.getSetCookie());
      if (success) {
        console.log('cookie 鍐欏叆鎴愬姛');
      } else {
        console.log('cookie 鍐欏叆澶辫触');
      }
      const secureAttr = isHttpsRequest(options.event) ? '; Secure' : '';

      setCookies = [
        `auth-key=${authKey}; Path=/; Expires=${dayjs().add(4, 'days').toString()}; HttpOnly; SameSite=Lax${secureAttr}`,
        `uuid=EXPIRED; Path=/; Expires=${dayjs().subtract(1, 'days').toString()}; HttpOnly; SameSite=Lax${secureAttr}`,
      ];
    } catch (error) {
      console.error('action(login) failed:', error);
    }
  } else if (options.action === 'switch_account') {
    const authKey = getAuthKeyFromRequest(options.event);
    if (authKey) {
      setCookies = ['switch_account=1'];
    }
  }

  const responseHeaders = new Headers(mpResponse.headers);
  responseHeaders.delete('set-cookie');
  setCookies.forEach(setCookie => {
    responseHeaders.append('set-cookie', setCookie);
  });
  const finalResponse = new Response(mpResponse.body, {
    status: mpResponse.status,
    statusText: mpResponse.statusText,
    headers: responseHeaders,
  });
  if (debugMemory) {
    logMemory('proxy-mp:response-return', {
      endpoint,
      method: options.method,
      status: finalResponse.status,
      requestId,
    });
  }
  return finalResponse;
}

export function getAuthKeyFromRequest(event: H3Event): string {
  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (!authKey) {
    const cookies = parseCookies(event);
    authKey = cookies['auth-key'];
  }

  return authKey;
}

// function updateCookies(event: H3Event, cookies: string[]): void {
//   const authKey = getAuthKeyFromRequest(event);
//   if (authKey) {
//     cookieStore.updateCookie(authKey, cookies);
//   }
// }
