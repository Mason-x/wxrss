import { upsertCommentReplyCache } from '~/server/repositories/cache';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface CommentReplyBody {
  fakeid?: string;
  url?: string;
  title?: string;
  contentID?: string;
  data?: any;
}

export default defineEventHandler(async event => {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const body = await readBody<CommentReplyBody>(event);
  const url = String(body?.url || '').trim();
  const contentID = String(body?.contentID || '').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }
  if (!contentID) {
    throw createError({ statusCode: 400, statusMessage: 'contentID is required' });
  }

  let dataBytes = 0;
  if (debugMemory) {
    try {
      dataBytes = Buffer.byteLength(JSON.stringify(body?.data ?? null));
    } catch {
      dataBytes = 0;
    }
    logMemory('cache-comment-reply:upsert-start', {
      traceId,
      fakeid: String(body?.fakeid || '').trim(),
      urlLength: url.length,
      contentIDLength: contentID.length,
      dataBytes,
    });
  }

  await upsertCommentReplyCache(authKey, {
    fakeid: String(body?.fakeid || '').trim(),
    url,
    title: String(body?.title || ''),
    contentID,
    data: body?.data ?? null,
  });
  if (debugMemory) {
    logMemory('cache-comment-reply:upsert-done', {
      traceId,
      urlLength: url.length,
      contentIDLength: contentID.length,
      dataBytes,
      durationMs: Date.now() - startedAt,
    });
  }

  return { ok: true };
});
