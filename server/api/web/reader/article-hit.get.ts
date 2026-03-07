import { hitArticleCache } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleHitQuery {
  fakeid: string;
  create_time?: number;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<ArticleHitQuery>(event);
  if (!query.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }

  const hit = await hitArticleCache(authKey, query.fakeid, Number(query.create_time) || 0);
  return {
    hit,
  };
});
