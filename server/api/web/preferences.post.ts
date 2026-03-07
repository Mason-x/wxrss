import { upsertStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import type { Preferences } from '~/types/preferences';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<Partial<Preferences>>(event);
  const result = await upsertStoredPreferencesByAuthKey(authKey, body);

  return {
    data: result.preferences,
    exists: result.exists,
    source: result.source,
    updatedAt: result.updatedAt,
  };
});
