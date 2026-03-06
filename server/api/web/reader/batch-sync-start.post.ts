import { startReaderBatchSyncJobStatus } from '~/server/utils/reader-batch-sync';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface BatchSyncStartBody {
  fakeids?: string[];
  syncTimestamp?: number;
  accountSyncSeconds?: number;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<BatchSyncStartBody>(event);
  const snapshot = startReaderBatchSyncJobStatus(authKey, {
    fakeids: Array.isArray(body?.fakeids) ? body.fakeids : [],
    syncTimestamp: Number.isFinite(body?.syncTimestamp) ? Number(body?.syncTimestamp) : 0,
    accountSyncSeconds: 0,
  });

  return {
    data: snapshot,
  };
});
