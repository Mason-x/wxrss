import { getArticleCacheSummary } from '~/server/repositories/reader';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleCacheSummaryQuery {
  fakeid: string;
  create_time?: number;
}

export default defineEventHandler(async event => {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<ArticleCacheSummaryQuery>(event);
  if (!query.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }

  const createTime = Number(query.create_time) || Date.now();
  if (debugMemory) {
    logMemory('article-cache-summary:start', {
      traceId,
      fakeid: query.fakeid,
      createTime,
    });
  }

  const summary = await getArticleCacheSummary(authKey, query.fakeid, createTime);
  if (debugMemory) {
    logMemory('article-cache-summary:done', {
      traceId,
      fakeid: query.fakeid,
      createTime,
      cachedRows: Number(summary.cachedRows) || 0,
      cachedMessageCount: Number(summary.cachedMessageCount) || 0,
      cachedAppmsgCount: Number(summary.cachedAppmsgCount) || 0,
      durationMs: Date.now() - startedAt,
    });
  }
  return {
    summary,
  };
});
