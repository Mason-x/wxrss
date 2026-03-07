import { listArticleCache } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleListQuery {
  fakeid: string;
  create_time?: number;
  limit?: number;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<ArticleListQuery>(event);
  if (!query.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }

  const list = await listArticleCache(
    authKey,
    query.fakeid,
    Number(query.create_time) || Date.now(),
    Number(query.limit) || 5000
  );
  return {
    list,
  };
});
