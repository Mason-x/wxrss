import { getHtmlCacheByFakeid } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const query = getQuery<{ fakeid?: string }>(event);
  const fakeid = String(query.fakeid || '').trim();
  if (!fakeid) {
    throw createError({ statusCode: 400, statusMessage: 'fakeid is required' });
  }

  const cache = await getHtmlCacheByFakeid(authKey, fakeid);
  if (!cache) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  setResponseHeader(event, 'content-type', cache.mimeType || 'text/html; charset=utf-8');
  setResponseHeader(event, 'x-cache-fakeid-uri', encodeURIComponent(cache.fakeid || ''));
  setResponseHeader(event, 'x-cache-url-uri', encodeURIComponent(cache.url || ''));
  setResponseHeader(event, 'x-cache-title-uri', encodeURIComponent(cache.title || ''));
  setResponseHeader(event, 'x-cache-comment-id-uri', encodeURIComponent(cache.commentID || ''));
  return cache.content;
});
