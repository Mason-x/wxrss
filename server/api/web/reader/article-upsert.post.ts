import { upsertArticles } from '~/server/repositories/reader';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleUpsertBody {
  account: {
    fakeid: string;
    nickname?: string;
    round_head_img?: string;
    category?: string;
    focused?: boolean;
    total_count?: number;
  };
  articles: any[];
  totalCount?: number;
  completed?: boolean;
  messageCountDelta?: number;
}

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

  const body = await readBody<ArticleUpsertBody>(event);
  if (!body?.account?.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'account.fakeid is required',
    });
  }

  const sourceArticles = Array.isArray(body.articles) ? body.articles : [];
  if (debugMemory) {
    logMemory('article-upsert:start', {
      traceId,
      fakeid: body?.account?.fakeid || '',
      articleCount: sourceArticles.length,
      totalCount: Number.isFinite(body.totalCount) ? Number(body.totalCount) : null,
      completed: Boolean(body.completed),
      hasMessageCountDelta: Number.isFinite(body.messageCountDelta),
    });
  }
  const totalCount = Number.isFinite(body.totalCount) ? Number(body.totalCount) : undefined;
  const completed = Boolean(body.completed);
  const hasExplicitMessageDelta = Number.isFinite(body.messageCountDelta);
  const explicitMessageDelta = hasExplicitMessageDelta ? Number(body.messageCountDelta) : undefined;
  const MAX_ARTICLES_PER_REQUEST = 400;
  if (sourceArticles.length > MAX_ARTICLES_PER_REQUEST) {
    throw createError({
      statusCode: 400,
      statusMessage: `articles size exceeds limit(${MAX_ARTICLES_PER_REQUEST})`,
    });
  }

  const UPSERT_CHUNK_SIZE = 30;
  let inserted = 0;
  let latestTotalCount = Number(totalCount) || 0;

  try {
    if (sourceArticles.length === 0) {
      const data = await upsertArticles(authKey, {
        account: body.account,
        articles: [],
        totalCount,
        completed,
        messageCountDelta: explicitMessageDelta,
      });
      inserted = Number(data.inserted) || 0;
      latestTotalCount = Number(data.totalCount) || latestTotalCount;
    } else {
      for (let offset = 0; offset < sourceArticles.length; offset += UPSERT_CHUNK_SIZE) {
        const chunk = sourceArticles.slice(offset, offset + UPSERT_CHUNK_SIZE);
        const isLastChunk = offset + chunk.length >= sourceArticles.length;
        if (debugMemory) {
          logMemory('article-upsert:chunk-start', {
            traceId,
            fakeid: body.account.fakeid,
            offset,
            chunkSize: chunk.length,
            isLastChunk,
          });
        }
        const data = await upsertArticles(authKey, {
          account: body.account,
          articles: chunk,
          totalCount,
          completed: isLastChunk ? completed : false,
          messageCountDelta: hasExplicitMessageDelta ? (offset === 0 ? explicitMessageDelta : 0) : undefined,
        });
        inserted += Number(data.inserted) || 0;
        latestTotalCount = Number(data.totalCount) || latestTotalCount;
        if (debugMemory) {
          logMemory('article-upsert:chunk-done', {
            traceId,
            fakeid: body.account.fakeid,
            offset,
            chunkSize: chunk.length,
            isLastChunk,
            insertedSoFar: inserted,
          });
        }

        // Yield to event loop between chunks to reduce worker memory pressure.
        if (!isLastChunk) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
  } catch (error) {
    if (debugMemory) {
      logMemory('article-upsert:error', {
        traceId,
        fakeid: body?.account?.fakeid || '',
        articleCount: sourceArticles.length,
        message: String((error as Error)?.message || error),
      });
    }
    throw error;
  }
  if (debugMemory) {
    logMemory('article-upsert:done', {
      traceId,
      fakeid: body.account.fakeid,
      articleCount: sourceArticles.length,
      inserted,
      latestTotalCount,
    });
  }

  return {
    data: {
      inserted,
      totalCount: latestTotalCount,
    },
  };
});
