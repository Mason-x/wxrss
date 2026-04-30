import { getStorageUsageSummary } from '~/server/repositories/storage-usage';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  return {
    data: await getStorageUsageSummary(authKey),
  };
});
