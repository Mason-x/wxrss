import { syncRssFeed } from '~/server/utils/rss';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

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

  return {
    data: await syncRssFeed(authKey, { url }),
  };
});
