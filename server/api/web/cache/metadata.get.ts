import { getMetadataCache } from '~/server/repositories/cache';
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

  const item = await getMetadataCache(authKey, url);
  return { item };
});
