import { getDebugCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const query = getQuery<{ url?: string }>(event);
  const url = String(query.url || '').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }

  const cache = await getDebugCache(authKey, url);
  if (!cache) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  setResponseHeader(event, 'content-type', cache.mimeType || 'text/html; charset=utf-8');
  setResponseHeader(event, 'x-cache-fakeid-uri', encodeURIComponent(cache.fakeid || ''));
  setResponseHeader(event, 'x-cache-url-uri', encodeURIComponent(cache.url || ''));
  setResponseHeader(event, 'x-cache-title-uri', encodeURIComponent(cache.title || ''));
  setResponseHeader(event, 'x-cache-type-uri', encodeURIComponent(cache.type || ''));
  return cache.content;
});
