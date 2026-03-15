import { upsertSchedulerState } from '~/server/kv/scheduler';
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
  await upsertSchedulerState(authKey, {
    config: {
      dailySyncEnabled: Boolean(result.preferences.dailySyncEnabled),
      dailySyncTime: String(result.preferences.dailySyncTime || '03:00'),
      accountSyncMinSeconds: Number(result.preferences.accountSyncMinSeconds || 3),
      accountSyncMaxSeconds: Number(result.preferences.accountSyncMaxSeconds || 5),
      syncDateRange: result.preferences.syncDateRange,
      syncDatePoint: Number(result.preferences.syncDatePoint || 0),
    },
  });

  return {
    data: result.preferences,
    exists: result.exists,
    source: result.source,
    updatedAt: result.updatedAt,
  };
});
