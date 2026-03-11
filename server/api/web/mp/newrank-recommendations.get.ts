import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { getNewrankMpRecommendations } from '~/server/utils/newrank';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<{ category?: string; limit?: string | number }>(event);
  const { preferences } = await getStoredPreferencesByAuthKey(authKey);

  return await getNewrankMpRecommendations({
    cookie: preferences.newrankCookie,
    category: String(query.category || '').trim(),
    limit: Number(query.limit) || 30,
  });
});
