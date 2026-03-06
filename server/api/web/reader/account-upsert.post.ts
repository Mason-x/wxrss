import { upsertAccountDelta } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountUpsertBody {
  account: {
    fakeid: string;
    completed?: boolean;
    count?: number;
    articles?: number;
    category?: string;
    focused?: boolean;
    nickname?: string;
    round_head_img?: string;
    total_count?: number;
    last_update_time?: number;
  };
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<AccountUpsertBody>(event);
  if (!body?.account?.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }

  const data = await upsertAccountDelta(authKey, body.account);
  return {
    data,
  };
});

