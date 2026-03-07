import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { startReaderBatchSyncJobStatus } from '~/server/utils/reader-batch-sync';
import type { ReaderBatchSyncJobSubprocessAccount } from '~/server/utils/reader-batch-sync-job-subprocess';

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
  const accounts: ReaderBatchSyncJobSubprocessAccount[] = Array.isArray(body?.accounts)
    ? body.accounts
        .filter(account => String(account?.fakeid || '').trim().length > 0)
        .map(account => ({
          fakeid: String(account.fakeid),
          completed: Boolean(account.completed),
          count: Number(account.count) || 0,
          articles: Number(account.articles) || 0,
          category: String(account.category || ''),
          focused: Boolean(account.focused),
          nickname: String(account.nickname || ''),
          round_head_img: String(account.round_head_img || ''),
          total_count: Number(account.total_count) || 0,
          create_time: Number(account.create_time) || 0,
          update_time: Number(account.update_time) || 0,
          last_update_time: Number(account.last_update_time) || 0,
        }))
    : [];
  const snapshot = startReaderBatchSyncJobStatus(authKey, {
    fakeids: Array.isArray(body?.fakeids) ? body.fakeids : [],
    accounts,
    syncTimestamp: Number.isFinite(body?.syncTimestamp) ? Number(body?.syncTimestamp) : 0,
    accountSyncMinSeconds: syncDelayRange.accountSyncMinSeconds,
    accountSyncMaxSeconds: syncDelayRange.accountSyncMaxSeconds,
  });

  return {
    data: snapshot,
  };
});
