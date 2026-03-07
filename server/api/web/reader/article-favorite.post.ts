import { updateArticleFavorite } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleFavoriteBody {
  url: string;
  favorite?: boolean;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ArticleFavoriteBody>(event);
  if (!body?.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  await updateArticleFavorite(authKey, body.url, Boolean(body.favorite));
  return {
    ok: true,
  };
});
