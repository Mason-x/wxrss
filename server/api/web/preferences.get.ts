import { getPreferencesResponseByAuthKey } from '~/server/repositories/preferences';
import { requireMpSession } from '~/server/utils/mp-session';

export default defineEventHandler(async event => {
  const session = await requireMpSession(event);
  return await getPreferencesResponseByAuthKey(session.authKey);
});
