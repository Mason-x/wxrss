import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type ChildStartMessage = {
  type: 'start';
  payload: ReaderBatchSyncJobChildInput;
};

type ChildCancelMessage = {
  type: 'cancel';
};

type ChildInboundMessage = ChildStartMessage | ChildCancelMessage;

type ChildOutboundMessage =
  | { type: 'started'; pid: number; jobId: string }
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
    }
  | {
      type: 'account-error';
      fakeid: string;
      nickname: string;
      message: string;
    }
  | { type: 'success'; message: string }
  | { type: 'canceled'; message: string }
  | { type: 'error'; message: string };

interface ReaderBatchSyncJobChildInput {
  authKey: string;
  jobId: string;
  token: string;
  cookie: string;
  userAgent: string;
  accounts: ReaderBatchAccountRecord[];
  syncTimestamp: number;
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
  requestTimeoutMs: number;
  maxJsonBytes: number;
  accountChildMaxOldSpaceMb: number;
}

interface ReaderBatchAccountRecord {
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

interface ReaderBatchAccountSubprocessInput {
  authKey: string;
  token: string;
  cookie: string;
  userAgent: string;
  timeoutMs: number;
  maxJsonBytes: number;
  syncTimestamp: number;
  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;
  accountChildMaxOldSpaceMb: number;
  account: ReaderBatchAccountRecord;
}

interface ReaderBatchAccountSubprocessResult {
  fakeid: string;
  nickname: string;
  totalInserted: number;
  totalCount: number;
  syncedMessages: number;
  syncedArticles: number;
}

interface ReaderBatchAccountSubprocessController {
  promise: Promise<ReaderBatchAccountSubprocessResult>;
  cancel: () => void;
}

type AccountChildOutboundMessage =
  | { type: 'started'; pid: number; fakeid: string }
  | Extract<ChildOutboundMessage, { type: 'account-start' | 'account-page' | 'account-done' }>
  | ({ type: 'success' } & ReaderBatchAccountSubprocessResult)
  | { type: 'canceled'; fakeid: string; nickname: string; message: string }
  | { type: 'error'; fakeid: string; nickname: string; message: string };

class BatchSyncCancelledError extends Error {
  constructor() {
    super('batch sync canceled');
    this.name = 'BatchSyncCancelledError';
  }
}

let cancelRequested = false;
let started = false;
let currentController: ReaderBatchAccountSubprocessController | null = null;

function getAccountChildScriptPath(): string {
  const sourcePath = path.resolve(process.cwd(), 'server/utils/reader-batch-sync-account-child.ts');
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }

  const currentScriptPath = String(process.argv[1] || '').trim();
  const currentDir = currentScriptPath
    ? path.dirname(path.resolve(currentScriptPath))
    : path.resolve(process.cwd(), 'server', 'runtime-child-scripts');
  return path.join(currentDir, 'reader-batch-sync-account-child.ts');
}

function sendMessage(message: ChildOutboundMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function sendMessageAsync(message: ChildOutboundMessage): Promise<void> {
  if (typeof process.send !== 'function') {
    return;
  }

  await new Promise<void>(resolve => {
    try {
      (process.send as any)(message, undefined, undefined, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function sendFinalMessageAndExit(message: ChildOutboundMessage, code: number): Promise<never> {
  await sendMessageAsync(message);
  try {
    if (typeof process.disconnect === 'function') {
      process.disconnect();
    }
  } catch {
    // Ignore disconnect errors and exit anyway.
  }
  process.exit(code);
}

function requestCancel(): void {
  cancelRequested = true;
  currentController?.cancel();
}

function ensureNotCanceled(): void {
  if (!cancelRequested) {
    return;
  }
  throw new BatchSyncCancelledError();
}

function syncReaderBatchAccountInSubprocess(
  input: ReaderBatchAccountSubprocessInput,
  onProgress?: (
    progress: Extract<ChildOutboundMessage, { type: 'account-start' | 'account-page' | 'account-done' }>
  ) => void
): ReaderBatchAccountSubprocessController {
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${input.accountChildMaxOldSpaceMb || 256}`,
      '--experimental-strip-types',
      getAccountChildScriptPath(),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );

  let settled = false;
  let lastErrorMessage = '';
  let sawCancel = false;
  let successResult: ReaderBatchAccountSubprocessResult | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;

  const promise = new Promise<ReaderBatchAccountSubprocessResult>((resolve, reject) => {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      reject(new Error(`account subprocess missing stdio(fakeid=${input.account.fakeid})`));
      return;
    }

    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');

    let stderrText = '';
    stderr.on('data', chunk => {
      stderrText += String(chunk || '');
    });

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
      stdout.removeAllListeners();
      stderr.removeAllListeners();
      child.removeAllListeners();
      try {
        stdout.destroy();
      } catch {
        // Ignore cleanup errors.
      }
      try {
        stderr.destroy();
      } catch {
        // Ignore cleanup errors.
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(value as ReaderBatchAccountSubprocessResult);
    };

    child.on('message', raw => {
      const message = raw as AccountChildOutboundMessage;
      if (!message || typeof message !== 'object') {
        return;
      }

      switch (message.type) {
        case 'started':
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
      if (successResult) {
        finish(null, successResult);
        return;
      }

      if (sawCancel) {
        finish(new Error(lastErrorMessage || 'batch sync canceled'));
        return;
      }

      const message = String(
        lastErrorMessage || stderrText.trim() || `account subprocess exited unexpectedly(code=${code ?? -1})`
      );
      finish(new Error(message));
    });

    child.send({
      type: 'start',
      payload: input,
    });

    killTimer = setTimeout(
      () => {
        if (settled) {
          return;
        }
        child.kill();
        finish(new Error(`account subprocess timeout(fakeid=${input.account.fakeid}, timeoutMs=${input.timeoutMs})`));
      },
      Math.max(1000, Number(input.timeoutMs || 30000)) + 5000
    );
  });

  const cancel = () => {
    if (settled) {
      return;
    }
    try {
      child.send({ type: 'cancel' });
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

async function runBatch(payload: ReaderBatchSyncJobChildInput): Promise<void> {
  for (const account of payload.accounts) {
    ensureNotCanceled();
    const fakeid = String(account.fakeid || '');
    const nickname = String(account.nickname || fakeid);
    try {
      const controller = syncReaderBatchAccountInSubprocess(
        {
          authKey: payload.authKey,
          token: payload.token,
          cookie: payload.cookie,
          userAgent: payload.userAgent,
          timeoutMs: payload.requestTimeoutMs,
          maxJsonBytes: payload.maxJsonBytes,
          syncTimestamp: payload.syncTimestamp,
          accountSyncMinSeconds: payload.accountSyncMinSeconds,
          accountSyncMaxSeconds: payload.accountSyncMaxSeconds,
          account,
          accountChildMaxOldSpaceMb: payload.accountChildMaxOldSpaceMb,
        },
        progress => {
          sendMessage(progress);
        }
      );

      currentController = controller;
      await controller.promise;
      currentController = null;
    } catch (error) {
      currentController = null;
      const message = String((error as Error)?.message || error || 'sync failed');
      if (message === 'batch sync canceled') {
        throw new BatchSyncCancelledError();
      }

      sendMessage({
        type: 'account-error',
        fakeid,
        nickname,
        message,
      });

      if (message === 'session expired' || message.includes('200003')) {
        throw new Error(message);
      }
    }
  }
}

function waitForStartPayload(): Promise<ReaderBatchSyncJobChildInput> {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1000, Number(process.env.READER_BATCH_SYNC_JOB_TIMEOUT_MS || 30 * 60 * 1000));
    const timer = setTimeout(() => {
      reject(new Error('batch job child start payload timeout'));
    }, timeoutMs);

    const onMessage = (message: ChildInboundMessage) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'cancel') {
        requestCancel();
        return;
      }
      if (message.type !== 'start' || !message.payload) {
        return;
      }
      clearTimeout(timer);
      process.off('message', onMessage);
      process.on('message', next => {
        if (next && typeof next === 'object' && (next as ChildInboundMessage).type === 'cancel') {
          requestCancel();
        }
      });
      resolve(message.payload);
    };

    process.on('message', onMessage);
  });
}

process.on('SIGTERM', () => {
  requestCancel();
});
process.on('SIGINT', () => {
  requestCancel();
});

try {
  const payload = await waitForStartPayload();
  if (started) {
    throw new Error('batch job child already started');
  }
  started = true;
  sendMessage({
    type: 'started',
    pid: process.pid,
    jobId: payload.jobId,
  });

  await runBatch(payload);
  await sendFinalMessageAndExit(
    {
      type: 'success',
      message: `synced ${payload.accounts.length} accounts`,
    },
    0
  );
} catch (error) {
  if (error instanceof BatchSyncCancelledError) {
    await sendFinalMessageAndExit(
      {
        type: 'canceled',
        message: 'batch sync canceled',
      },
      0
    );
  }

  const message = String((error as Error)?.message || error || 'batch sync failed');
  await sendFinalMessageAndExit(
    {
      type: 'error',
      message,
    },
    1
  );
}
