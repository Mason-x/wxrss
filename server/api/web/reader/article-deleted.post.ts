import { updateArticleDeleted } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleDeletedBody {
  url: string;
  is_deleted?: boolean;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ArticleDeletedBody>(event);
  if (!body?.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  await updateArticleDeleted(authKey, body.url, Boolean(body.is_deleted));
  return {
    ok: true,
  };
});
