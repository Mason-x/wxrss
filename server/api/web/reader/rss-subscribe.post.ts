import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { syncRssFeed } from '~/server/utils/rss';

interface RssSubscribeBody {
  url?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<RssSubscribeBody>(event);
  const url = String(body?.url || '').trim();
  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url is required',
    });
  }

  try {
    return {
      data: await syncRssFeed(authKey, { url }),
    };
  } catch (error: any) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: String(error?.message || 'RSS subscribe failed'),
    });
  }
});
