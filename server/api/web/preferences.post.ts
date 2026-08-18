import { getUpsertedPreferencesResponseByAuthKey } from '~/server/repositories/preferences';
import { requireMpSession } from '~/server/utils/mp-session';
import type { Preferences } from '~/types/preferences';

export default defineEventHandler(async event => {
  const session = await requireMpSession(event);
  const body = await readBody<Partial<Preferences>>(event);
  return getUpsertedPreferencesResponseByAuthKey(session.authKey, body);
});
