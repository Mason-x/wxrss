import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const result = await getStoredPreferencesByAuthKey(authKey);
  return {
    data: result.preferences,
    exists: result.exists,
    source: result.source,
    updatedAt: result.updatedAt,
  };
});
