import { getAssetCache } from '~/server/repositories/cache';
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

  const cache = await getAssetCache(authKey, url);
  if (!cache) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  setResponseHeader(event, 'content-type', cache.mimeType || 'application/octet-stream');
  setResponseHeader(event, 'x-cache-fakeid-uri', encodeURIComponent(cache.fakeid || ''));
  setResponseHeader(event, 'x-cache-url-uri', encodeURIComponent(cache.url || ''));
  return cache.content;
});
