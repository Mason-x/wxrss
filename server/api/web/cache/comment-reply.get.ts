import { getCommentReplyCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const query = getQuery<{ url?: string; contentID?: string }>(event);
  const url = String(query.url || '').trim();
  const contentID = String(query.contentID || '').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }
  if (!contentID) {
    throw createError({ statusCode: 400, statusMessage: 'contentID is required' });
  }

  const item = await getCommentReplyCache(authKey, url, contentID);
  return { item };
});
