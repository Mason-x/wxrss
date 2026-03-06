import { listArticlesPage } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticlePageQuery {
  offset?: number;
  limit?: number;
  fakeid?: string;
  category?: string;
  focused?: string | number | boolean;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<ArticlePageQuery>(event);
  const focusedRaw = query.focused;
  const focused =
    focusedRaw === true ||
    focusedRaw === 'true' ||
    focusedRaw === '1' ||
    focusedRaw === 1;

  return await listArticlesPage(authKey, {
    offset: Number(query.offset) || 0,
    limit: Number(query.limit) || 80,
    fakeid: query.fakeid ? String(query.fakeid) : undefined,
    category: query.category ? String(query.category) : undefined,
    focused: focusedRaw === undefined ? undefined : focused,
  });
});

