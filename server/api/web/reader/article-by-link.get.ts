import { getArticleByLink } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleByLinkQuery {
  url: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<ArticleByLinkQuery>(event);
  if (!query.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  const article = await getArticleByLink(authKey, query.url);
  return {
    article,
  };
});
