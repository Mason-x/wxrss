import { type SchedulerAccount, type SchedulerConfig, upsertSchedulerState } from '~/server/kv/scheduler';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface UpsertSchedulerBody {
  config?: Partial<SchedulerConfig>;
  accounts?: SchedulerAccount[];
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<UpsertSchedulerBody>(event);
  const state = await upsertSchedulerState(authKey, {
    config: body?.config || {},
    accounts: Array.isArray(body?.accounts) ? body.accounts : undefined,
  });

  return {
    data: state,
  };
});
