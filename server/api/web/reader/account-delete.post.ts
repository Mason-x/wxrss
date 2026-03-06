import { deleteAccounts } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountDeleteBody {
  fakeids: string[];
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<AccountDeleteBody>(event);
  const fakeids = Array.isArray(body?.fakeids) ? body.fakeids : [];
  await deleteAccounts(authKey, fakeids);
  return {
    ok: true,
  };
});

