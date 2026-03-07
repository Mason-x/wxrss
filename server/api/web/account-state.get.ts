import { getStoredAccountStateByAuthKey } from '~/server/repositories/account-state';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountStateQuery {
  key?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<AccountStateQuery>(event);
  const stateKey = String(query.key || '').trim();
  if (!stateKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'key is required',
    });
  }

  const result = await getStoredAccountStateByAuthKey(authKey, stateKey);
  return {
    data: result.data,
    exists: result.exists,
    updatedAt: result.updatedAt,
  };
});
