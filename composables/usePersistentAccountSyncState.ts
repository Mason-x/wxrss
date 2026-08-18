export interface PersistentSyncRuntimeState {
  status: 'running' | 'error';
  syncedMessages: number;
  scannedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  errorMessage: string;
  updatedAt: number;
  source: 'local' | 'remote';
}

export interface PersistentSyncBanner {
  tone: 'blue' | 'green' | 'amber' | 'rose';
  title: string;
  detail: string;
  progressPercent: number;
  currentAccountName: string;
  failedCount: number;
  updatedAt: number;
  currentIndex?: number;
  totalAccounts?: number;
  modeLabel?: string;
}

export interface PersistentSyncJob {
  running: boolean;
  canceled: boolean;
  currentFakeid: string;
  currentNickname: string;
  currentIndex: number;
  totalAccounts: number;
  successCount: number;
  failedCount: number;
  modeLabel: string;
}

export const EMPTY_PERSISTENT_SYNC_JOB: PersistentSyncJob = {
  running: false,
  canceled: false,
  currentFakeid: '',
  currentNickname: '',
  currentIndex: 0,
  totalAccounts: 0,
  successCount: 0,
  failedCount: 0,
  modeLabel: '',
};

let persistentSyncLoopToken = 0;
let scrapeStopper: (() => void) | null = null;

export function getPersistentSyncLoopToken() {
  return persistentSyncLoopToken;
}

export function nextPersistentSyncLoopToken() {
  persistentSyncLoopToken += 1;
  return persistentSyncLoopToken;
}

export function registerPersistentSyncScrapeStopper(stopper: (() => void) | null) {
  scrapeStopper = stopper;
}

export function usePersistentAccountSyncState() {
  const job = useState<PersistentSyncJob>('persistent-account-sync:job', () => ({ ...EMPTY_PERSISTENT_SYNC_JOB }));
  const runtimeStates = useState<Record<string, PersistentSyncRuntimeState | undefined>>(
    'persistent-account-sync:runtime',
    () => ({})
  );
  const banner = useState<PersistentSyncBanner | null>('persistent-account-sync:banner', () => null);
  const isSyncing = computed(() => job.value.running);
  const syncingRowId = computed(() => job.value.currentFakeid || null);

  function setRuntime(fakeid: string, next: PersistentSyncRuntimeState | undefined) {
    const copy = { ...runtimeStates.value };
    if (next) {
      copy[fakeid] = next;
    } else {
      delete copy[fakeid];
    }
    runtimeStates.value = copy;
  }

  function setRunning(
    account: { fakeid: string; count?: number; total_count?: number; articles?: number },
    overrides: Partial<PersistentSyncRuntimeState> = {}
  ) {
    setRuntime(account.fakeid, {
      status: 'running',
      syncedMessages: Math.max(0, Number(overrides.syncedMessages ?? account.count) || 0),
      scannedMessages: Math.max(0, Number(overrides.scannedMessages ?? account.count) || 0),
      totalMessages: Math.max(0, Number(overrides.totalMessages ?? 0) || 0),
      syncedArticles: Math.max(0, Number(overrides.syncedArticles ?? account.articles) || 0),
      errorMessage: '',
      updatedAt: Date.now(),
      source: overrides.source || 'local',
    });
  }

  function setError(fakeid: string, message: string, source: PersistentSyncRuntimeState['source'] = 'local') {
    const previous = runtimeStates.value[fakeid];
    setRuntime(fakeid, {
      status: 'error',
      syncedMessages: previous?.syncedMessages || 0,
      scannedMessages: previous?.scannedMessages || 0,
      totalMessages: previous?.totalMessages || 0,
      syncedArticles: previous?.syncedArticles || 0,
      errorMessage: String(message || '同步失败').trim(),
      updatedAt: Date.now(),
      source,
    });
  }

  function clearRuntime(fakeid: string) {
    if (!(fakeid in runtimeStates.value)) {
      return;
    }
    setRuntime(fakeid, undefined);
  }

  function setBanner(next: PersistentSyncBanner | null) {
    banner.value = next ? { ...next, updatedAt: Date.now() } : null;
  }

  function dismissBanner() {
    banner.value = null;
  }

  function cancelSync() {
    const activeFakeid = job.value.currentFakeid;
    job.value = {
      ...job.value,
      canceled: true,
      running: false,
    };
    scrapeStopper?.();
    if (activeFakeid) {
      clearRuntime(activeFakeid);
    }
    nextPersistentSyncLoopToken();
  }

  return {
    job,
    runtimeStates,
    banner,
    isSyncing,
    syncingRowId,
    setRuntime,
    setRunning,
    setError,
    clearRuntime,
    setBanner,
    dismissBanner,
    cancelSync,
  };
}

export default usePersistentAccountSyncState;
