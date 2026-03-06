import { cancelReaderBatchSyncJobStatus } from '~/server/utils/reader-batch-sync';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  return {
    data: cancelReaderBatchSyncJobStatus(authKey),
  };
});
