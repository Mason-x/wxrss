import { upsertStoredAccountStateByAuthKey } from '~/server/repositories/account-state';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountStateBody {
  key?: string;
  data?: unknown;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<AccountStateBody>(event);
  const stateKey = String(body?.key || '').trim();
  if (!stateKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'key is required',
    });
  }

  const result = await upsertStoredAccountStateByAuthKey(authKey, stateKey, body?.data ?? null);
  return {
    data: result.data,
    exists: result.exists,
    updatedAt: result.updatedAt,
  };
});
