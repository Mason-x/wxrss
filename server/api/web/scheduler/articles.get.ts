import { getSchedulerArticlesMap, getSchedulerState } from '~/server/kv/scheduler';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<{ fakeid?: string }>(event);
  const targetFakeid = String(query.fakeid || '').trim();
  if (debugMemory) {
    logMemory('scheduler-articles:start', {
      traceId,
      targetFakeid,
    });
  }

  const state = await getSchedulerState(authKey);
  if (!state) {
    if (debugMemory) {
      logMemory('scheduler-articles:no-state', {
        traceId,
        targetFakeid,
      });
    }
    return {
      data: {},
    };
  }

  const fakeids = targetFakeid
    ? state.accounts.filter(account => account.fakeid === targetFakeid).map(account => account.fakeid)
    : state.accounts.map(account => account.fakeid);
  const map = await getSchedulerArticlesMap(authKey, fakeids);
  if (debugMemory) {
    const accountCount = Object.keys(map).length;
    const articleCount = Object.values(map).reduce((sum, item) => sum + (Array.isArray(item.articles) ? item.articles.length : 0), 0);
    logMemory('scheduler-articles:done', {
      traceId,
      requestedAccountCount: fakeids.length,
      accountCount,
      articleCount,
    });
  }

  return {
    data: map,
  };
});
