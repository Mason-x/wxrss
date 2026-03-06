import {
  updateAccountCategory,
  updateAccountFocused,
  updateLastUpdateTime,
} from '~/server/repositories/reader';
import { logMemory } from '~/server/utils/memory-debug';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AccountUpdateBody {
  fakeid: string;
  category?: string;
  focused?: boolean;
  touchLastUpdate?: boolean;
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

  const body = await readBody<AccountUpdateBody>(event);
  if (!body?.fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fakeid is required',
    });
  }
  if (debugMemory) {
    logMemory('account-update:start', {
      traceId,
      fakeid: body.fakeid,
      hasCategory: typeof body.category === 'string',
      hasFocused: typeof body.focused === 'boolean',
      touchLastUpdate: Boolean(body.touchLastUpdate),
    });
  }

  if (typeof body.category === 'string') {
    await updateAccountCategory(authKey, body.fakeid, body.category);
  }
  if (typeof body.focused === 'boolean') {
    await updateAccountFocused(authKey, body.fakeid, body.focused);
  }
  if (body.touchLastUpdate) {
    await updateLastUpdateTime(authKey, body.fakeid);
  }
  if (debugMemory) {
    logMemory('account-update:done', {
      traceId,
      fakeid: body.fakeid,
      hasCategory: typeof body.category === 'string',
      hasFocused: typeof body.focused === 'boolean',
      touchLastUpdate: Boolean(body.touchLastUpdate),
      durationMs: Date.now() - startedAt,
    });
  }

  return {
    ok: true,
  };
});
