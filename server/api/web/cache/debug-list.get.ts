import { listDebugCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const query = getQuery<{ limit?: number; includeContent?: number }>(event);
  const limit = Number(query.limit) || 1000;
  const includeContent = Number(query.includeContent) === 1;
  const list = await listDebugCache(authKey, limit);

  return {
    list: list.map(item => ({
      fakeid: item.fakeid,
      url: item.url,
      title: item.title,
      type: item.type,
      mimeType: item.mimeType,
      contentBase64: includeContent ? item.content.toString('base64') : undefined,
    })),
  };
});
