import { updateArticleStatus } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleStatusBody {
  url: string;
  status: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ArticleStatusBody>(event);
  if (!body?.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  await updateArticleStatus(authKey, body.url, body.status || '');
  return {
    ok: true,
  };
});

