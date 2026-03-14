import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { syncRssFeed } from '~/server/utils/rss';

interface RssSyncBody {
  fakeid?: string;
  url?: string;
  history?: boolean;
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
  const history = Boolean(body?.history);
  if (!fakeid && !url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'fakeid or url is required',
    });
  }

  try {
    return {
      data: await syncRssFeed(authKey, { fakeid, url, history }),
    };
  } catch (error: any) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: String(error?.message || 'RSS sync failed'),
    });
  }
});
