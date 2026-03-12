import { upsertAssetCache } from '~/server/repositories/cache';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

function getTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string {
  const part = parts?.find(item => item.name === name);
  if (!part?.data) return '';
  return Buffer.from(part.data).toString('utf8');
}

export default defineEventHandler(async event => {
  const debugMemory = process.env.NUXT_DEBUG_MEMORY === 'true';
  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const parts = await readMultipartFormData(event);
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'multipart form data is required' });
  }

  const filePart = parts.find(item => item.name === 'file');
  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: 'file is required' });
  }

  const url = getTextField(parts, 'url').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }
  if (debugMemory) {
    logMemory('cache-asset:upsert-start', {
      traceId,
      urlLength: url.length,
      fakeid: getTextField(parts, 'fakeid').trim(),
      fileBytes: Number(filePart.data?.byteLength) || 0,
      mimeType: filePart.type || 'application/octet-stream',
    });
  }

  await upsertAssetCache(authKey, {
    fakeid: getTextField(parts, 'fakeid').trim(),
    url,
    mimeType: filePart.type || 'application/octet-stream',
    content: Buffer.from(filePart.data),
  });
  if (debugMemory) {
    logMemory('cache-asset:upsert-done', {
      traceId,
      urlLength: url.length,
      durationMs: Date.now() - startedAt,
    });
  }

  return { ok: true };
});
