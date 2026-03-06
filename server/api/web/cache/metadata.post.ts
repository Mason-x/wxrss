import { upsertMetadataCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface MetadataBody {
  fakeid?: string;
  url?: string;
  title?: string;
  data?: any;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const body = await readBody<MetadataBody>(event);
  const url = String(body?.url || '').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }

  await upsertMetadataCache(authKey, {
    fakeid: String(body?.fakeid || '').trim(),
    url,
    title: String(body?.title || ''),
    data: body?.data ?? null,
  });

  return { ok: true };
});
