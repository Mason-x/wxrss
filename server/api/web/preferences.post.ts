import { upsertSchedulerState } from '~/server/kv/scheduler';
import { getUpsertedPreferencesResponseByAuthKey, getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { requireMpSession } from '~/server/utils/mp-session';
import type { Preferences } from '~/types/preferences';

export default defineEventHandler(async event => {
  const session = await requireMpSession(event);

  const body = await readBody<Partial<Preferences>>(event);
  const result = await getUpsertedPreferencesResponseByAuthKey(session.authKey, body);
  const effective = await getStoredPreferencesByAuthKey(session.authKey);

  await upsertSchedulerState(session.authKey, {
    config: {
      dailySyncEnabled: Boolean(effective.preferences.dailySyncEnabled),
      dailySyncTime: String(effective.preferences.dailySyncTime || '03:00'),
      accountSyncMinSeconds: Number(effective.preferences.accountSyncMinSeconds || 3),
      accountSyncMaxSeconds: Number(effective.preferences.accountSyncMaxSeconds || 5),
      syncDateRange: effective.preferences.syncDateRange,
      syncDatePoint: Number(effective.preferences.syncDatePoint || 0),
    },
  });

  return result;
});
