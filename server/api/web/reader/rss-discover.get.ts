import { searchRsshubRoutes } from '~/server/utils/rsshub';

export default defineEventHandler(async event => {
  const query = getQuery<{ keyword?: string; limit?: string | number }>(event);
  const keyword = String(query.keyword || '').trim();
  const limit = Number(query.limit) || 20;

  return {
    data: await searchRsshubRoutes(keyword, limit),
  };
});
