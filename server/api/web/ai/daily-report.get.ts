import { getAiDailyReport } from '~/server/repositories/reader';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface DailyReportQuery {
  date?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const query = getQuery<DailyReportQuery>(event);
  const reportDate = String(query.date || '').trim();
  if (!reportDate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'date is required',
    });
  }

  return {
    data: await getAiDailyReport(authKey, reportDate),
  };
});
