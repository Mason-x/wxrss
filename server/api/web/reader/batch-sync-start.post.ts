import { startReaderBatchSyncJobStatus } from '~/server/utils/reader-batch-sync';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';

interface BatchSyncStartBody {
  fakeids?: string[];
  accounts?: Array<{
    fakeid: string;
    completed?: boolean;
    count?: number;
    articles?: number;
    category?: string;
    focused?: boolean;
    nickname?: string;
    round_head_img?: string;
    total_count?: number;
    create_time?: number;
    update_time?: number;
    last_update_time?: number;
  }>;
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
    accounts: Array.isArray(body?.accounts) ? body.accounts : [],
    syncTimestamp: Number.isFinite(body?.syncTimestamp) ? Number(body?.syncTimestamp) : 0,
    accountSyncMinSeconds: syncDelayRange.accountSyncMinSeconds,
    accountSyncMaxSeconds: syncDelayRange.accountSyncMaxSeconds,
  });

  return {
    data: snapshot,
  };
});
