import { spawn } from 'node:child_process';
import { logMemory } from '~/server/utils/memory-debug';
import type { ReaderBatchAccountProgress } from '~/server/utils/reader-batch-sync-account-subprocess';
import { ensureRuntimeChildScript } from '~/server/utils/runtime-child-script';
import {
  READER_BATCH_SYNC_ACCOUNT_CHILD_SOURCE,
  READER_BATCH_SYNC_JOB_CHILD_SOURCE,
} from '~/server/utils/runtime-child-sources.generated';

export interface ReaderBatchSyncJobSubprocessAccount {
  fakeid: string;
  completed: boolean;
  count: number;
  articles: number;
  category?: string;
  focused?: boolean;
  nickname?: string;
  round_head_img?: string;
  total_count: number;
  create_time?: number;
  update_time?: number;
  last_update_time?: number;
}

export interface ReaderBatchSyncJobSubprocessInput {
  authKey: string;
  jobId: string;
  token: string;
  cookie: string;
  userAgent: string;
  accounts: ReaderBatchSyncJobSubprocessAccount[];
  syncTimestamp: number;
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
}

export type ReaderBatchSyncJobSubprocessEvent =
  | ReaderBatchAccountProgress
  | {
      type: 'account-error';
      fakeid: string;
      nickname: string;
      message: string;
    };

export interface ReaderBatchSyncJobSubprocessResult {
  status: 'success' | 'canceled';
}

export interface ReaderBatchSyncJobSubprocessController {
  promise: Promise<ReaderBatchSyncJobSubprocessResult>;
  cancel: () => void;
}

type ChildOutboundMessage =
  | { type: 'started'; pid: number; jobId: string }
  | ReaderBatchSyncJobSubprocessEvent
  | { type: 'success'; message: string }
  | { type: 'canceled'; message: string }
  | { type: 'error'; message: string };

type ChildInboundMessage =
  | {
      type: 'start';
      payload: ReaderBatchSyncJobSubprocessInput & {
        requestTimeoutMs: number;
        maxJsonBytes: number;
        accountChildMaxOldSpaceMb: number;
      };
    }
  | { type: 'cancel' };

function getChildScriptPath(): string {
  ensureRuntimeChildScript('reader-batch-sync-account-child.ts', READER_BATCH_SYNC_ACCOUNT_CHILD_SOURCE);
  return ensureRuntimeChildScript('reader-batch-sync-job-child.ts', READER_BATCH_SYNC_JOB_CHILD_SOURCE);
}

function getChildMaxOldSpaceMb(): number {
  const configured = Number(process.env.READER_BATCH_SYNC_JOB_CHILD_MAX_OLD_SPACE_MB || 3072);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 3072;
  }
  return Math.floor(configured);
}

function getTimeoutMs(): number {
  const configured = Number(process.env.READER_BATCH_SYNC_JOB_TIMEOUT_MS || 30 * 60 * 1000);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 30 * 60 * 1000;
  }
  return Math.floor(configured);
}

function getRequestTimeoutMs(): number {
  const configured = Number(process.env.MP_REQUEST_TIMEOUT_MS || 30000);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 30000;
  }
  return Math.floor(configured);
}

function getMaxJsonBytes(): number {
  const configured = Number(process.env.MP_PROXY_MAX_JSON_BYTES || 8 * 1024 * 1024);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 8 * 1024 * 1024;
  }
  return Math.max(1024 * 1024, Math.floor(configured));
}

function getAccountChildMaxOldSpaceMb(): number {
  const configured = Number(process.env.READER_BATCH_SYNC_ACCOUNT_CHILD_MAX_OLD_SPACE_MB || 256);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 256;
  }
  return Math.floor(configured);
}

export function startReaderBatchSyncInSubprocess(
  input: ReaderBatchSyncJobSubprocessInput,
  onProgress?: (progress: ReaderBatchSyncJobSubprocessEvent) => void
): ReaderBatchSyncJobSubprocessController {
  const timeoutMs = getTimeoutMs();
  const requestTimeoutMs = getRequestTimeoutMs();
  const maxJsonBytes = getMaxJsonBytes();
  const accountChildMaxOldSpaceMb = getAccountChildMaxOldSpaceMb();
  const childMaxOldSpaceMb = getChildMaxOldSpaceMb();
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${childMaxOldSpaceMb}`, '--experimental-strip-types', getChildScriptPath()],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );

  logMemory('reader-batch-sync:job-subprocess-start', {
    jobId: input.jobId,
    timeoutMs,
    childMaxOldSpaceMb,
    totalAccounts: input.accounts.length,
  });

  let settled = false;
  let finalStatus: 'success' | 'canceled' | null = null;
  let finalMessage = '';
  let killTimer: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;

  const promise = new Promise<ReaderBatchSyncJobSubprocessResult>((resolve, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error(`batch subprocess missing stderr(jobId=${input.jobId})`));
      return;
    }

    stderr.setEncoding('utf8');
    let stderrText = '';

    const cleanup = () => {
      stderr.removeAllListeners();
      child.removeAllListeners();
      try {
        stderr.destroy();
      } catch {
        // Ignore cleanup failures.
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
    };

    const finish = (error: Error | null, value?: ReaderBatchSyncJobSubprocessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(value as ReaderBatchSyncJobSubprocessResult);
    };

    stderr.on('data', chunk => {
      stderrText += String(chunk || '');
    });

    child.on('message', raw => {
      const message = raw as ChildOutboundMessage;
      if (!message || typeof message !== 'object') {
        return;
      }

      switch (message.type) {
        case 'started':
          logMemory('reader-batch-sync:job-subprocess-started', {
            jobId: message.jobId,
            childPid: message.pid,
          });
          return;
        case 'account-start':
        case 'account-page':
        case 'account-done':
        case 'account-error':
          onProgress?.(message);
          return;
        case 'success':
          finalStatus = 'success';
          finalMessage = String(message.message || '');
          return;
        case 'canceled':
          finalStatus = 'canceled';
          finalMessage = String(message.message || 'batch sync canceled');
          return;
        case 'error':
          finalMessage = String(message.message || 'batch sync failed');
          return;
      }
    });

    child.on('error', error => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('close', code => {
      logMemory('reader-batch-sync:job-subprocess-close', {
        jobId: input.jobId,
        code: code ?? -1,
        stderrBytes: Buffer.byteLength(stderrText.trim(), 'utf8'),
        finalStatus: finalStatus || '',
      });

      if (finalStatus === 'success') {
        finish(null, { status: 'success' });
        return;
      }

      if (finalStatus === 'canceled') {
        finish(null, { status: 'canceled' });
        return;
      }

      const message = String(
        finalMessage || stderrText.trim() || `batch subprocess exited unexpectedly(code=${code ?? -1})`
      );
      finish(new Error(message));
    });

    const payload: ChildInboundMessage = {
      type: 'start',
      payload: {
        ...input,
        requestTimeoutMs,
        maxJsonBytes,
        accountChildMaxOldSpaceMb,
      },
    };
    child.send(payload);

    killTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill();
      finish(new Error(`batch subprocess timeout(jobId=${input.jobId}, timeoutMs=${timeoutMs})`));
    }, timeoutMs);
  });

  const cancel = () => {
    if (settled) {
      return;
    }
    try {
      const payload: ChildInboundMessage = { type: 'cancel' };
      child.send(payload);
    } catch {
      // Ignore IPC failures and fall back to killing the child.
    }
    if (!closeTimer) {
      closeTimer = setTimeout(() => {
        if (!settled && !child.killed) {
          child.kill();
        }
      }, 1000);
    }
  };

  return {
    promise,
    cancel,
  };
}
