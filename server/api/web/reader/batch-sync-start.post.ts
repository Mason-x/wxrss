import { startReaderBatchSyncJobStatus } from '~/server/utils/reader-batch-sync';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';

interface BatchSyncStartBody {
  fakeids?: string[];
  syncTimestamp?: number;
  accountSyncMinSeconds?: number;
  accountSyncMaxSeconds?: number;
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
  const syncDelayRange = normalizeSyncDelayRange(body);
  const snapshot = startReaderBatchSyncJobStatus(authKey, {
    fakeids: Array.isArray(body?.fakeids) ? body.fakeids : [],
    syncTimestamp: Number.isFinite(body?.syncTimestamp) ? Number(body?.syncTimestamp) : 0,
    accountSyncMinSeconds: syncDelayRange.accountSyncMinSeconds,
    accountSyncMaxSeconds: syncDelayRange.accountSyncMaxSeconds,
  });

  return {
    data: snapshot,
  };
});
