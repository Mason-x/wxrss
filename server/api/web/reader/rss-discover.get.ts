import { discoverRsshubCatalog } from '~/server/utils/rsshub';

export default defineEventHandler(async event => {
  const query = getQuery<{ keyword?: string; category?: string; limit?: string | number }>(event);
  const keyword = String(query.keyword || '').trim();
  const category = String(query.category || '').trim();
  const limit = Number(query.limit) || 20;

  return {
    ...(await discoverRsshubCatalog({
      keyword,
      category,
      limit,
    })),
  };
});
