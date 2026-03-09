import { syncRssFeed } from '~/server/utils/rss';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface RssSyncBody {
  fakeid?: string;
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

  const body = await readBody<RssSyncBody>(event);
  const fakeid = String(body?.fakeid || '').trim();
  const url = String(body?.url || '').trim();
  if (!fakeid && !url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid or url is required',
    });
  }

  return {
    data: await syncRssFeed(authKey, { fakeid, url }),
  };
});
