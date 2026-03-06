import { randomUUID } from 'node:crypto';
import { USER_AGENT } from '~/config';
import { getMpCookie } from '~/server/kv/cookie';
import { getAccountByFakeid, type ReaderAccount } from '~/server/repositories/reader';
import { logMemory } from '~/server/utils/memory-debug';
import {
  startReaderBatchSyncInSubprocess,
  type ReaderBatchSyncJobSubprocessAccount,
  type ReaderBatchSyncJobSubprocessController,
  type ReaderBatchSyncJobSubprocessEvent,
} from '~/server/utils/reader-batch-sync-job-subprocess';

type BatchJobStatus = 'running' | 'success' | 'error' | 'canceled';

interface BatchJobOptions {
  fakeids: string[];
  syncTimestamp: number;
  accountSyncSeconds: number;
}

interface BatchJobRuntime {
  authKey: string;
  jobId: string;
  status: BatchJobStatus;
  totalAccounts: number;
  completedAccounts: number;
  successCount: number;
  failedCount: number;
  currentFakeid: string;
  currentNickname: string;
  message: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number;
  cancelRequested: boolean;
  currentController: ReaderBatchSyncJobSubprocessController | null;
  currentAccount: BatchSyncAccountSnapshot | null;
  recentAccounts: BatchSyncAccountSnapshot[];
  failedAccounts: BatchSyncAccountSnapshot[];
  accountStates: Record<string, BatchSyncAccountSnapshot['status']>;
}

export interface BatchSyncAccountSnapshot {
  fakeid: string;
  nickname: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'canceled';
  syncedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  updatedAt: number;
  message?: string;
}

export interface BatchSyncJobSnapshot {
  jobId: string;
  status: BatchJobStatus;
  totalAccounts: number;
  completedAccounts: number;
  successCount: number;
  failedCount: number;
  currentFakeid: string;
  currentNickname: string;
  message: string;
  accounts: BatchSyncAccountSnapshot[];
  startedAt: number;
  updatedAt: number;
  finishedAt: number;
}

export interface BatchSyncJobStatusView {
  jobId: string;
  status: BatchJobStatus;
  totalAccounts: number;
  completedAccounts: number;
  successCount: number;
  failedCount: number;
  currentFakeid: string;
  currentNickname: string;
  message: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number;
  currentAccount: BatchSyncAccountSnapshot | null;
  heapUsedMb: number;
  pollAfterMs: number;
}

const RECENT_ACCOUNT_LIMIT = 20;
const FAILED_ACCOUNT_LIMIT = 50;

declare global {
  // eslint-disable-next-line no-var
  var __wxReaderBatchSyncJobs: Map<string, BatchJobRuntime> | undefined;
}

class BatchSyncCancelledError extends Error {
  constructor() {
    super('batch sync canceled');
    this.name = 'BatchSyncCancelledError';
  }
}

function getJobStore(): Map<string, BatchJobRuntime> {
  if (!globalThis.__wxReaderBatchSyncJobs) {
    globalThis.__wxReaderBatchSyncJobs = new Map<string, BatchJobRuntime>();
  }
  return globalThis.__wxReaderBatchSyncJobs;
}

function nowMs(): number {
  return Date.now();
}

function toMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function isBatchSyncProgressMemoryDebugEnabled(): boolean {
  return process.env.NUXT_DEBUG_MEMORY_BATCH_SYNC_PROGRESS === 'true';
}

function logBatchSyncProgress(stage: string, fields: Record<string, unknown>): void {
  if (!isBatchSyncProgressMemoryDebugEnabled()) {
    return;
  }
  logMemory(stage, fields);
}

function cleanupExpiredJobs(): void {
  const deadline = nowMs() - 60 * 60 * 1000;
  const store = getJobStore();
  for (const [authKey, job] of store.entries()) {
    if (job.status === 'running') {
      continue;
    }
    if (job.updatedAt >= deadline) {
      continue;
    }
    store.delete(authKey);
  }
}

function getSnapshotAccounts(job: BatchJobRuntime): BatchSyncAccountSnapshot[] {
  const ordered = [job.currentAccount, ...job.failedAccounts, ...job.recentAccounts].filter(
    (account): account is BatchSyncAccountSnapshot => Boolean(account)
  );
  const deduped = new Map<string, BatchSyncAccountSnapshot>();
  for (const account of ordered) {
    if (!deduped.has(account.fakeid)) {
      deduped.set(account.fakeid, { ...account });
    }
  }
  return Array.from(deduped.values());
}

function cloneJobSnapshot(job: BatchJobRuntime): BatchSyncJobSnapshot {
  return {
    jobId: job.jobId,
    status: job.status,
    totalAccounts: job.totalAccounts,
    completedAccounts: job.completedAccounts,
    successCount: job.successCount,
    failedCount: job.failedCount,
    currentFakeid: job.currentFakeid,
    currentNickname: job.currentNickname,
    message: job.message,
    accounts: getSnapshotAccounts(job),
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

function buildJobStatusView(job: BatchJobRuntime): BatchSyncJobStatusView {
  const currentAccount = job.currentAccount ? { ...job.currentAccount } : null;
  const heapUsedMb = toMb(process.memoryUsage().heapUsed);
  const pollAfterMs = job.status !== 'running'
    ? 0
    : heapUsedMb >= 2500
      ? 5000
      : 3000;

  return {
    jobId: job.jobId,
    status: job.status,
    totalAccounts: job.totalAccounts,
    completedAccounts: job.completedAccounts,
    successCount: job.successCount,
    failedCount: job.failedCount,
    currentFakeid: job.currentFakeid,
    currentNickname: job.currentNickname,
    message: job.message,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    currentAccount: currentAccount ? { ...currentAccount } : null,
    heapUsedMb,
    pollAfterMs,
  };
}

function ensureJobNotCanceled(job: BatchJobRuntime): void {
  if (job.cancelRequested) {
    throw new BatchSyncCancelledError();
  }
}

function updateJob(job: BatchJobRuntime, patch: Partial<BatchJobRuntime>): void {
  Object.assign(job, patch);
  job.updatedAt = nowMs();
}

function getStoredAccountSnapshot(job: BatchJobRuntime, fakeid: string): BatchSyncAccountSnapshot | null {
  if (job.currentAccount?.fakeid === fakeid) {
    return job.currentAccount;
  }
  return job.failedAccounts.find(account => account.fakeid === fakeid)
    || job.recentAccounts.find(account => account.fakeid === fakeid)
    || null;
}

function createAccountSnapshot(
  previous: BatchSyncAccountSnapshot | null,
  fakeid: string,
  patch: Partial<BatchSyncAccountSnapshot>
): BatchSyncAccountSnapshot {
  const nextStatus = (patch.status || previous?.status || 'pending') as BatchSyncAccountSnapshot['status'];
  const nextNickname = String(patch.nickname || previous?.nickname || fakeid);
  return {
    fakeid,
    nickname: nextNickname || fakeid,
    status: nextStatus,
    syncedMessages: Number(patch.syncedMessages ?? previous?.syncedMessages ?? 0) || 0,
    totalMessages: Number(patch.totalMessages ?? previous?.totalMessages ?? 0) || 0,
    syncedArticles: Number(patch.syncedArticles ?? previous?.syncedArticles ?? 0) || 0,
    updatedAt: nowMs(),
    message: String(patch.message ?? previous?.message ?? ''),
  };
}

function rememberRecentAccount(job: BatchJobRuntime, snapshot: BatchSyncAccountSnapshot): void {
  job.recentAccounts = [snapshot, ...job.recentAccounts.filter(account => account.fakeid !== snapshot.fakeid)].slice(
    0,
    RECENT_ACCOUNT_LIMIT
  );
}

function rememberFailedAccount(job: BatchJobRuntime, snapshot: BatchSyncAccountSnapshot): void {
  if (snapshot.status !== 'error') {
    return;
  }
  job.failedAccounts = [snapshot, ...job.failedAccounts.filter(account => account.fakeid !== snapshot.fakeid)].slice(
    0,
    FAILED_ACCOUNT_LIMIT
  );
}

function updateAccountProgress(
  job: BatchJobRuntime,
  fakeid: string,
  patch: Partial<BatchSyncAccountSnapshot>
): BatchSyncAccountSnapshot | null {
  const previous = getStoredAccountSnapshot(job, fakeid);
  const next = createAccountSnapshot(previous, fakeid, patch);
  if (job.currentFakeid === fakeid || next.status === 'running' || job.currentAccount?.fakeid === fakeid) {
    job.currentAccount = next;
  }
  rememberRecentAccount(job, next);
  rememberFailedAccount(job, next);
  job.updatedAt = nowMs();
  return next;
}

function getAccountSnapshot(job: BatchJobRuntime, fakeid: string): BatchSyncAccountSnapshot | null {
  return getStoredAccountSnapshot(job, fakeid);
}

function getAccountStatus(job: BatchJobRuntime, fakeid: string): BatchSyncAccountSnapshot['status'] | undefined {
  return job.accountStates[fakeid];
}

function setAccountStatus(job: BatchJobRuntime, fakeid: string, status: BatchSyncAccountSnapshot['status']): void {
  job.accountStates[fakeid] = status;
}

function markAccountSuccess(
  job: BatchJobRuntime,
  fakeid: string,
  patch: Partial<BatchSyncAccountSnapshot>
): void {
  const currentStatus = getAccountStatus(job, fakeid);
  updateAccountProgress(job, fakeid, {
    status: 'success',
    ...patch,
  });
  setAccountStatus(job, fakeid, 'success');
  if (currentStatus === 'success' || currentStatus === 'error' || currentStatus === 'canceled') {
    return;
  }
  job.successCount += 1;
  job.completedAccounts += 1;
}

function markAccountError(job: BatchJobRuntime, fakeid: string, nickname: string, message: string): void {
  const current = getAccountSnapshot(job, fakeid);
  const currentStatus = getAccountStatus(job, fakeid);
  updateJob(job, {
    currentFakeid: fakeid,
    currentNickname: nickname || fakeid,
    message,
  });
  updateAccountProgress(job, fakeid, {
    status: 'error',
    nickname: nickname || current?.nickname || fakeid,
    message,
  });
  setAccountStatus(job, fakeid, 'error');
  if (currentStatus !== 'error' && currentStatus !== 'success' && currentStatus !== 'canceled') {
    job.failedCount += 1;
    job.completedAccounts += 1;
  }
  logMemory('reader-batch-sync:account-error', {
    jobId: job.jobId,
    fakeid,
    message,
  });
}

function buildCookieString(auth: NonNullable<Awaited<ReturnType<typeof getMpCookie>>>): string {
  return auth.cookies
    .filter(item => item && item.value && item.value !== 'EXPIRED')
    .map(item => `${item.name}=${item.value}`)
    .join('; ');
}

function applyChildProgress(job: BatchJobRuntime, progress: ReaderBatchSyncJobSubprocessEvent): void {
  switch (progress.type) {
    case 'account-start':
      updateJob(job, {
        currentFakeid: progress.fakeid,
        currentNickname: progress.nickname,
        message: `syncing ${progress.nickname}`,
      });
      updateAccountProgress(job, progress.fakeid, {
        status: 'running',
        nickname: progress.nickname,
        syncedMessages: progress.syncedMessages,
        totalMessages: progress.totalMessages,
        syncedArticles: progress.syncedArticles,
        message: '',
      });
      logBatchSyncProgress('reader-batch-sync:account-start', {
        jobId: job.jobId,
        fakeid: progress.fakeid,
        nickname: progress.nickname,
      });
      return;
    case 'account-page':
      updateAccountProgress(job, progress.fakeid, {
        nickname: progress.nickname,
        syncedMessages: progress.syncedMessages,
        totalMessages: progress.totalCount,
        syncedArticles: progress.syncedArticles,
      });
      logBatchSyncProgress('reader-batch-sync:account-page', {
        jobId: job.jobId,
        fakeid: progress.fakeid,
        begin: progress.begin,
        size: progress.size,
        page: progress.page,
        pageMessageCount: progress.pageMessageCount,
        articleCount: progress.articleCount,
        inserted: progress.inserted,
        totalInserted: progress.totalInserted,
        totalCount: progress.totalCount,
        completed: progress.completed,
      });
      return;
    case 'account-done':
      markAccountSuccess(job, progress.fakeid, {
        nickname: progress.nickname,
        syncedMessages: progress.syncedMessages,
        totalMessages: progress.totalCount,
        syncedArticles: progress.syncedArticles,
        message: '',
      });
      logBatchSyncProgress('reader-batch-sync:account-done', {
        jobId: job.jobId,
        fakeid: progress.fakeid,
        nickname: progress.nickname,
        totalInserted: progress.totalInserted,
        totalCount: progress.totalCount,
      });
      return;
    case 'account-error':
      markAccountError(job, progress.fakeid, progress.nickname, progress.message);
      return;
  }
}

async function runBatchJob(job: BatchJobRuntime, options: BatchJobOptions): Promise<void> {
  ensureJobNotCanceled(job);
  const auth = await getMpCookie(job.authKey);
  if (!auth?.token || !Array.isArray(auth.cookies) || auth.cookies.length === 0) {
    throw new Error('session expired');
  }

  const cookie = buildCookieString(auth);
  if (!cookie) {
    throw new Error('session expired');
  }

  const accounts: ReaderBatchSyncJobSubprocessAccount[] = [];
  for (const fakeid of options.fakeids) {
    const account = await getAccountByFakeid(job.authKey, fakeid);
    if (!account) {
      markAccountError(job, fakeid, fakeid, 'account not found');
      continue;
    }
    accounts.push(account as ReaderAccount);
  }

  if (accounts.length === 0) {
    return;
  }

  const controller = startReaderBatchSyncInSubprocess(
    {
      authKey: job.authKey,
      jobId: job.jobId,
      token: auth.token,
      cookie,
      userAgent: USER_AGENT,
      accounts,
      syncTimestamp: options.syncTimestamp,
      accountSyncSeconds: options.accountSyncSeconds,
    },
    progress => {
      applyChildProgress(job, progress);
    }
  );

  job.currentController = controller;
  const result = await controller.promise;
  job.currentController = null;
  if (result.status === 'canceled') {
    throw new BatchSyncCancelledError();
  }
}

function requestJobCancel(job: BatchJobRuntime): void {
  job.cancelRequested = true;
  updateJob(job, {
    message: 'cancel requested',
  });
  job.currentController?.cancel();
}

export function getReaderBatchSyncJob(authKey: string): BatchSyncJobSnapshot | null {
  cleanupExpiredJobs();
  const job = getJobStore().get(authKey);
  return job ? cloneJobSnapshot(job) : null;
}

export function getReaderBatchSyncJobStatus(authKey: string): BatchSyncJobStatusView | null {
  cleanupExpiredJobs();
  const job = getJobStore().get(authKey);
  return job ? buildJobStatusView(job) : null;
}

export function cancelReaderBatchSyncJob(authKey: string): BatchSyncJobSnapshot | null {
  cleanupExpiredJobs();
  const job = getJobStore().get(authKey);
  if (!job) {
    return null;
  }
  requestJobCancel(job);
  return cloneJobSnapshot(job);
}

export function cancelReaderBatchSyncJobStatus(authKey: string): BatchSyncJobStatusView | null {
  cleanupExpiredJobs();
  const job = getJobStore().get(authKey);
  if (!job) {
    return null;
  }
  requestJobCancel(job);
  return buildJobStatusView(job);
}

export function startReaderBatchSyncJob(authKey: string, options: BatchJobOptions): BatchSyncJobSnapshot {
  cleanupExpiredJobs();
  const store = getJobStore();
  const existing = store.get(authKey);
  if (existing && existing.status === 'running') {
    return cloneJobSnapshot(existing);
  }

  const fakeids = Array.from(new Set((options.fakeids || []).filter(Boolean)));
  const startedAt = nowMs();
  const job: BatchJobRuntime = {
    authKey,
    jobId: randomUUID().replace(/-/g, ''),
    status: 'running',
    totalAccounts: fakeids.length,
    completedAccounts: 0,
    successCount: 0,
    failedCount: 0,
    currentFakeid: '',
    currentNickname: '',
    message: 'starting',
    startedAt,
    updatedAt: startedAt,
    finishedAt: 0,
    cancelRequested: false,
    currentController: null,
    currentAccount: null,
    recentAccounts: [],
    failedAccounts: [],
    accountStates: Object.fromEntries(fakeids.map(fakeid => [fakeid, 'pending'])) as Record<
      string,
      BatchSyncAccountSnapshot['status']
    >,
  };
  store.set(authKey, job);

  logMemory('reader-batch-sync:job-start', {
    jobId: job.jobId,
    totalAccounts: job.totalAccounts,
  });

  void (async () => {
    try {
      await runBatchJob(job, options);
      if (job.cancelRequested) {
        throw new BatchSyncCancelledError();
      }
      updateJob(job, {
        status: 'success',
        currentFakeid: '',
        currentNickname: '',
        currentController: null,
        message: `synced ${job.successCount} accounts`,
        finishedAt: nowMs(),
      });
      logMemory('reader-batch-sync:job-done', {
        jobId: job.jobId,
        totalAccounts: job.totalAccounts,
        successCount: job.successCount,
        failedCount: job.failedCount,
      });
    } catch (error) {
      job.currentController = null;
      if (error instanceof BatchSyncCancelledError) {
        if (job.currentAccount && (job.currentAccount.status === 'pending' || job.currentAccount.status === 'running')) {
          const canceledAccount = createAccountSnapshot(job.currentAccount, job.currentAccount.fakeid, {
            status: 'canceled',
            message: job.currentAccount.message || 'canceled',
          });
          job.currentAccount = canceledAccount;
          rememberRecentAccount(job, canceledAccount);
          setAccountStatus(job, canceledAccount.fakeid, 'canceled');
        }
        updateJob(job, {
          status: 'canceled',
          currentFakeid: '',
          currentNickname: '',
          message: 'batch sync canceled',
          finishedAt: nowMs(),
        });
        logMemory('reader-batch-sync:job-canceled', {
          jobId: job.jobId,
          completedAccounts: job.completedAccounts,
          totalAccounts: job.totalAccounts,
        });
        return;
      }

      const message = String((error as Error)?.message || error || 'batch sync failed');
      updateJob(job, {
        status: 'error',
        currentFakeid: '',
        currentNickname: '',
        currentController: null,
        message,
        finishedAt: nowMs(),
      });
      logMemory('reader-batch-sync:job-error', {
        jobId: job.jobId,
        message,
        completedAccounts: job.completedAccounts,
        totalAccounts: job.totalAccounts,
      });
    }
  })();

  return cloneJobSnapshot(job);
}

export function startReaderBatchSyncJobStatus(authKey: string, options: BatchJobOptions): BatchSyncJobStatusView {
  startReaderBatchSyncJob(authKey, options);
  return getReaderBatchSyncJobStatus(authKey) as BatchSyncJobStatusView;
}
