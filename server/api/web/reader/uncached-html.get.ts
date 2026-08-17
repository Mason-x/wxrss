import { listUncachedArticleUrls } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface UncachedHtmlQuery {
  fakeid?: string;
  limit?: string | number;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<UncachedHtmlQuery>(event);
  const fakeid = String(query.fakeid || '').trim();
  if (!fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }

  const urls = await listUncachedArticleUrls(authKey, fakeid, Number(query.limit) || 200);
  return {
    urls,
  };
});
