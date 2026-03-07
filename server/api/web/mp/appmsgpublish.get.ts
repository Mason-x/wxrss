/**
 * Proxy and compact article list from WeChat MP backend.
 */

import PQueue from 'p-queue';
import {
  type AppmsgPublishSubprocessResult,
  requestAppmsgpublishInSubprocess,
} from '~/server/utils/appmsgpublish-subprocess';
import { getCookieFromStore, getTokenFromStore } from '~/server/utils/CookieStore';
import { logMemory } from '~/server/utils/memory-debug';

interface AppMsgPublishQuery {
  begin?: number;
  size?: number;
  id: string;
  keyword: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __wxAppmsgPublishQueue: PQueue | undefined;
}

function getAppmsgPublishQueue(): PQueue {
  if (!globalThis.__wxAppmsgPublishQueue) {
    const concurrency = Math.max(1, Number(process.env.MP_APPMESSAGE_CONCURRENCY || 1));
    globalThis.__wxAppmsgPublishQueue = new PQueue({ concurrency });
  }
  return globalThis.__wxAppmsgPublishQueue;
}

export default defineEventHandler(async event => {
  const queue = getAppmsgPublishQueue();

  return queue.add(async () => {
    const token = await getTokenFromStore(event);
    const cookie = await getCookieFromStore(event);

    if (!token || !cookie) {
      return {
        base_resp: {
          ret: 200003,
          err_msg: 'session expired',
        },
      };
    }

    const query = getQuery<AppMsgPublishQuery>(event);
    const id = String(query.id || '').trim();
    const keyword = String(query.keyword || '').trim();
    const begin: number = Number(query.begin) || 0;
    const size: number = Number(query.size) || 5;

    if (!id) {
      return {
        base_resp: {
          ret: -1,
          err_msg: 'id is required',
        },
      };
    }

    const isSearching = Boolean(keyword);

    const params: Record<string, string | number> = {
      sub: isSearching ? 'search' : 'list',
      search_field: isSearching ? '7' : 'null',
      begin,
      count: size,
      query: keyword,
      fakeid: id,
      type: '101_1',
      free_publish_type: 1,
      sub_action: 'list_ex',
      token: token || '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    };

    const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
    const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    if (debugMemory) {
      logMemory('appmsgpublish:start', {
        traceId,
        fakeid: id,
        begin,
        size,
        keywordLength: keyword.length,
        queueSize: queue.size,
        queuePending: queue.pending,
      });
    }

    const resp: AppmsgPublishSubprocessResult = await requestAppmsgpublishInSubprocess({
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish',
      query: params,
      cookie,
      timeoutMs: Math.max(1000, Number(process.env.MP_REQUEST_TIMEOUT_MS || 30000)),
    }).catch(error => {
      const message = String((error as Error)?.message || error || 'failed to fetch appmsgpublish');
      console.error(error);
      if (debugMemory) {
        logMemory('appmsgpublish:subprocess-error', {
          traceId,
          fakeid: id,
          begin,
          size,
          message,
        });
      }
      return {
        base_resp: {
          ret: -1,
          err_msg: message,
        },
      } as AppmsgPublishSubprocessResult;
    });

    if (debugMemory) {
      logMemory('appmsgpublish:subprocess-returned', {
        traceId,
        fakeid: id,
        begin,
        size,
        ret: Number(resp?.base_resp?.ret ?? -1),
        totalCount: Number(resp?.total_count || 0),
        pageMessageCount: Number(resp?.page_message_count || 0),
        articleCount: Array.isArray(resp?.articles) ? resp.articles.length : 0,
      });
    }

    return resp;
  });
});
