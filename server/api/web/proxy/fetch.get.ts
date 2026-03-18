import { getQuery } from 'h3';
import { PRIVATE_PROXY_REQUIRED_MESSAGE, sanitizePrivateProxyList } from '~/config/proxy';
import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { requireMpSession } from '~/server/utils/mp-session';

interface ProxyFetchQuery {
  url?: string;
  headers?: string;
  slot?: string;
}

function buildPrivateProxyEndpoint(
  proxy: string,
  targetUrl: string,
  headers: Record<string, string>,
  authorization: string
): string {
  return `${proxy}?url=${encodeURIComponent(targetUrl)}&headers=${encodeURIComponent(
    JSON.stringify(headers)
  )}&authorization=${encodeURIComponent(authorization)}`;
}

function normalizeHeaders(input: string): Record<string, string> {
  if (!input) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(value || '').trim();
        return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue]] : [];
      })
    );
  } catch {
    return {};
  }
}

function createProxyCandidates(proxies: string[], slot: number): string[] {
  if (!proxies.length) {
    return [];
  }

  const normalizedSlot = Number.isFinite(slot) && slot >= 0 ? Math.floor(slot) : 0;
  const pivot = normalizedSlot % proxies.length;
  return [...proxies.slice(pivot), ...proxies.slice(0, pivot)];
}

export default defineEventHandler(async event => {
  const session = await requireMpSession(event);
  const query = getQuery<ProxyFetchQuery>(event);
  const targetUrl = String(query.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  const { preferences } = await getStoredPreferencesByAuthKey(session.authKey);
  const proxies = sanitizePrivateProxyList(preferences.privateProxyList || []);
  if (proxies.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: PRIVATE_PROXY_REQUIRED_MESSAGE,
    });
  }

  const headers = normalizeHeaders(String(query.headers || ''));
  const authorization = String(preferences.privateProxyAuthorization || '').trim();
  const candidates = createProxyCandidates(proxies, Number(query.slot || 0));

  let lastError: Error | null = null;
  for (const proxy of candidates) {
    try {
      const response = await fetch(buildPrivateProxyEndpoint(proxy, targetUrl, headers, authorization), {
        method: 'GET',
        headers: {
          'Accept-Encoding': 'identity',
        },
      });

      if (!response.ok && response.status >= 500 && candidates.length > 1) {
        lastError = new Error(`proxy failed(status=${response.status})`);
        continue;
      }

      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('set-cookie');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw createError({
    statusCode: 502,
    statusMessage: lastError?.message || 'proxy request failed',
  });
});
