import { getSchedulerState } from '~/server/kv/scheduler';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const state = await getSchedulerState(authKey);
  return {
    data: state,
  };
});
