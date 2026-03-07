import { deleteArticleByLink } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleRemoveBody {
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

  const body = await readBody<ArticleRemoveBody>(event);
  if (!body?.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  await deleteArticleByLink(authKey, body.url);
  return {
    ok: true,
  };
});
