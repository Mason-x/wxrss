import { getAccountByFakeid, listAccounts } from '~/server/repositories/reader';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountsQuery {
  offset?: number;
  limit?: number;
  keyword?: string;
  fakeid?: string;
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

  const query = getQuery<AccountsQuery>(event);
  if (debugMemory) {
    logMemory('reader-accounts:start', {
      traceId,
      fakeid: String(query.fakeid || ''),
      offset: Number(query.offset) || 0,
      limit: Number(query.limit) || 200,
      keywordLength: String(query.keyword || '').length,
    });
  }

  if (query.fakeid) {
    const account = await getAccountByFakeid(authKey, String(query.fakeid));
    if (debugMemory) {
      logMemory('reader-accounts:done', {
        traceId,
        mode: 'single',
        fakeid: String(query.fakeid || ''),
        hasAccount: Boolean(account),
        durationMs: Date.now() - startedAt,
      });
    }
    return {
      list: account ? [account] : [],
      total: account ? 1 : 0,
      offset: 0,
      limit: 1,
    };
  }

  const result = await listAccounts(authKey, {
    offset: Number(query.offset) || 0,
    limit: Number(query.limit) || 200,
    keyword: String(query.keyword || ''),
  });
  if (debugMemory) {
    logMemory('reader-accounts:done', {
      traceId,
      mode: 'list',
      offset: Number(result.offset) || 0,
      limit: Number(result.limit) || 0,
      total: Number(result.total) || 0,
      listCount: Array.isArray(result.list) ? result.list.length : 0,
      durationMs: Date.now() - startedAt,
    });
  }
  return result;
});
