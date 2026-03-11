import { runAiAccountBootstrap, runAiDailyDigest } from '~/server/utils/ai-daily';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface BootstrapAccountBody {
  fakeid?: string;
  limit?: number;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<BootstrapAccountBody>(event);
  const fakeid = String(body?.fakeid || '').trim();
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body?.limit) || 10)));

  if (!fakeid) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少订阅源 fakeid',
    });
  }

  const bootstrap = await runAiAccountBootstrap(authKey, fakeid, limit);
  const daily = await runAiDailyDigest(authKey);

  return {
    data: {
      ...bootstrap,
      daily,
    },
  };
});
