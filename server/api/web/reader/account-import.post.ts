import { importAccounts } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountImportBody {
  accounts: Array<{
    fakeid: string;
    category?: string;
    focused?: boolean;
    nickname?: string;
    round_head_img?: string;
  }>;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<AccountImportBody>(event);
  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  await importAccounts(authKey, accounts as any);
  return {
    ok: true,
    total: accounts.length,
  };
});
