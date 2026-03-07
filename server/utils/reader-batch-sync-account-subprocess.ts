import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { USER_AGENT } from '~/config';
import { logMemory } from '~/server/utils/memory-debug';

export interface ReaderBatchAccountRecord {
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

export interface ReaderBatchAccountSubprocessInput {
  authKey: string;
  token: string;
  cookie: string;
  syncTimestamp: number;
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
  account: ReaderBatchAccountRecord;
}

export type ReaderBatchAccountProgress =
  | {
      type: 'account-start';
      fakeid: string;
      nickname: string;
      syncedMessages: number;
      totalMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'account-page';
      fakeid: string;
      nickname: string;
      begin: number;
      size: number;
      page: number;
      pageMessageCount: number;
      articleCount: number;
      inserted: number;
      totalInserted: number;
      totalCount: number;
      completed: boolean;
      syncedMessages: number;
      syncedArticles: number;
    }
  | {
      type: 'account-done';
      fakeid: string;
      nickname: string;
      totalInserted: number;
      totalCount: number;
      syncedMessages: number;
      syncedArticles: number;
    };

export interface ReaderBatchAccountSubprocessResult {
  fakeid: string;
  nickname: string;
  totalInserted: number;
  totalCount: number;
  syncedMessages: number;
  syncedArticles: number;
}

export interface ReaderBatchAccountSubprocessController {
  promise: Promise<ReaderBatchAccountSubprocessResult>;
  cancel: () => void;
}

type ChildOutboundMessage =
  | { type: 'started'; pid: number; fakeid: string }
  | ReaderBatchAccountProgress
  | ({ type: 'success' } & ReaderBatchAccountSubprocessResult)
  | { type: 'canceled'; fakeid: string; nickname: string; message: string }
  | { type: 'error'; fakeid: string; nickname: string; message: string };

type ChildInboundMessage =
  | {
      type: 'start';
      payload: ReaderBatchAccountSubprocessInput & {
        userAgent: string;
        timeoutMs: number;
        maxJsonBytes: number;
      };
    }
  | { type: 'cancel' };

function getChildScriptPath(): string {
  const sourcePath = path.resolve(process.cwd(), 'server/utils/reader-batch-sync-account-child.ts');
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }
  return fileURLToPath(new URL('./reader-batch-sync-account-child.ts', import.meta.url));
}

function getChildMaxOldSpaceMb(): number {
  const configured = Number(process.env.READER_BATCH_SYNC_ACCOUNT_CHILD_MAX_OLD_SPACE_MB || 256);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 256;
  }
  return Math.floor(configured);
}

function getTimeoutMs(): number {
  return Math.max(1000, Number(process.env.MP_REQUEST_TIMEOUT_MS || 30000));
}

function getMaxJsonBytes(): number {
  return Math.max(1024 * 1024, Number(process.env.MP_PROXY_MAX_JSON_BYTES || 8 * 1024 * 1024));
}

export function syncReaderBatchAccountInSubprocess(
  input: ReaderBatchAccountSubprocessInput,
  onProgress?: (progress: ReaderBatchAccountProgress) => void
): ReaderBatchAccountSubprocessController {
  const timeoutMs = getTimeoutMs();
  const maxJsonBytes = getMaxJsonBytes();
  const childMaxOldSpaceMb = getChildMaxOldSpaceMb();
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${childMaxOldSpaceMb}`, '--experimental-strip-types', getChildScriptPath()],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );

  logMemory('reader-batch-sync:account-subprocess-start', {
    fakeid: input.account.fakeid,
    timeoutMs,
    childMaxOldSpaceMb,
  });

  let settled = false;
  let lastErrorMessage = '';
  let sawCancel = false;
  let successResult: ReaderBatchAccountSubprocessResult | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;

  const promise = new Promise<ReaderBatchAccountSubprocessResult>((resolve, reject) => {
    const finish = (error: Error | null, value?: ReaderBatchAccountSubprocessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(value as ReaderBatchAccountSubprocessResult);
    };

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      finish(new Error(`account subprocess missing stdio(fakeid=${input.account.fakeid})`));
      return;
    }

    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');

    let stderrText = '';
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
          logMemory('reader-batch-sync:account-subprocess-started', {
            fakeid: message.fakeid,
            childPid: message.pid,
          });
          return;
        case 'account-start':
        case 'account-page':
        case 'account-done':
          onProgress?.(message);
          return;
        case 'success':
          successResult = {
            fakeid: message.fakeid,
            nickname: message.nickname,
            totalInserted: message.totalInserted,
            totalCount: message.totalCount,
            syncedMessages: message.syncedMessages,
            syncedArticles: message.syncedArticles,
          };
          return;
        case 'canceled':
          sawCancel = true;
          lastErrorMessage = String(message.message || 'batch sync canceled');
          return;
        case 'error':
          lastErrorMessage = String(message.message || 'sync failed');
          return;
      }
    });

    child.on('error', error => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('close', code => {
      logMemory('reader-batch-sync:account-subprocess-close', {
        fakeid: input.account.fakeid,
        code: code ?? -1,
        stderrBytes: Buffer.byteLength(stderrText.trim(), 'utf8'),
      });

      if (successResult) {
        finish(null, successResult);
        return;
      }

      if (sawCancel) {
        finish(new Error(lastErrorMessage || 'batch sync canceled'));
        return;
      }

      const message = String(lastErrorMessage || stderrText.trim() || `account subprocess exited unexpectedly(code=${code ?? -1})`);
      finish(new Error(message));
    });

    const payload: ChildInboundMessage = {
      type: 'start',
      payload: {
        ...input,
        userAgent: USER_AGENT,
        timeoutMs,
        maxJsonBytes,
      },
    };
    child.send(payload);

    killTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill();
      finish(new Error(`account subprocess timeout(fakeid=${input.account.fakeid}, timeoutMs=${timeoutMs})`));
    }, timeoutMs + 5000);
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
