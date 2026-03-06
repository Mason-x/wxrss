import { upsertResourceMapCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ResourceMapBody {
  fakeid?: string;
  url?: string;
  resources?: string[];
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const body = await readBody<ResourceMapBody>(event);
  const url = String(body?.url || '').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }

  await upsertResourceMapCache(authKey, {
    fakeid: String(body?.fakeid || '').trim(),
    url,
    resources: Array.isArray(body?.resources) ? body.resources : [],
  });

  return { ok: true };
});
