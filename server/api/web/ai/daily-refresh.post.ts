import { runAiDailyDigest } from '~/server/utils/ai-daily';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface DailyRefreshBody {
  date?: string;
  force?: boolean;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<DailyRefreshBody>(event).catch(() => ({} as DailyRefreshBody));

  return {
    data: await runAiDailyDigest(authKey, String(body?.date || '').trim() || undefined, {
      forceReport: body?.force === true,
      bypassAutoSummaryToggle: body?.force === true,
    }),
  };
});
