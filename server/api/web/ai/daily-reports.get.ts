import { listAiDailyReports } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface DailyReportsQuery {
  offset?: number;
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

  const query = getQuery<DailyReportsQuery>(event);
  return await listAiDailyReports(authKey, {
    offset: Number(query.offset) || 0,
    limit: Number(query.limit) || 60,
  });
});
