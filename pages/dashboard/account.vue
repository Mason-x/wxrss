<script setup lang="ts">
import { formatTimeStamp } from '#shared/utils/helpers';
import { request } from '#shared/utils/request';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';
import {
  bootstrapAccountAi,
  getArticleList,
  hasValidCredential,
  INITIAL_SUBSCRIBE_PAGE_SIZE,
  syncRssFeed,
} from '~/apis';
import CredentialsDialog, { type CredentialState } from '~/components/global/CredentialsDialog.vue';
import GlobalSearchAccountDialog from '~/components/global/SearchAccountDialog.vue';
import EmptyStatePanel from '~/components/mobile/EmptyStatePanel.vue';
import ScrollTopFab from '~/components/mobile/ScrollTopFab.vue';
import ConfirmModal from '~/components/modal/Confirm.vue';
import toastFactory from '~/composables/toast';
import useLoginCheck from '~/composables/useLoginCheck';
import { IMAGE_PROXY, websiteName } from '~/config';
import { deleteAccountData } from '~/store/v2';
import { getArticleCacheSummary } from '~/store/v2/article';
import {
  getAllInfo,
  getInfoCache,
  importMpAccounts,
  isRssAccount,
  type MpAccount,
  updateAccountCategory,
} from '~/store/v2/info';
import type { AccountManifest } from '~/types/account';
import type { Preferences } from '~/types/preferences';
import type { AccountInfo } from '~/types/types';
import { exportAccountJsonFile } from '~/utils/exporter';

defineOptions({
  name: 'dashboard-account',
});

useHead({
  title: `公众号管理 | ${websiteName}`,
});

interface PromiseInstance {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

interface AccountSyncRuntimeState {
  status: 'running' | 'error';
  syncedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  errorMessage: string;
  updatedAt: number;
  source: 'local' | 'remote';
}

interface AccountRow extends MpAccount {
  _runtimeSync?: AccountSyncRuntimeState | null;
}

interface SyncBannerState {
  tone: 'blue' | 'green' | 'amber' | 'rose';
  title: string;
  detail: string;
  progressPercent: number;
  currentAccountName: string;
  failedCount: number;
  updatedAt: number;
}

interface RemoteBatchSyncAccountSnapshot {
  fakeid: string;
  nickname: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'canceled';
  syncedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  updatedAt: number;
  message?: string;
}

interface RemoteBatchSyncJobSnapshot {
  jobId: string;
  status: 'running' | 'success' | 'error' | 'canceled';
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
  currentAccount: RemoteBatchSyncAccountSnapshot | null;
  failedAccounts: RemoteBatchSyncAccountSnapshot[];
  heapUsedMb: number;
  pollAfterMs: number;
}

const toast = toastFactory();
const modal = useModal();
const { checkLogin } = useLoginCheck();
const route = useRoute();
const { navigateToLogin } = useMpAuth();
const loginAccount = useLoginAccount();

const { getSyncTimestamp } = useSyncDeadline();

const preferences = usePreferences();
const aiAutoSummaryOnSyncEnabled = computed(() => preferences.value.aiAutoSummaryOnSyncEnabled !== false);

// 账号事件总线，用于和 Credentials 面板保持列表同步
const { accountEventBus } = useAccountEventBus();
const stopAccountEventBus = accountEventBus.on(event => {
  if (event === 'account-added' || event === 'account-removed') {
    void refresh();
  }
});

const searchAccountDialogRef = ref<typeof GlobalSearchAccountDialog | null>(null);
const credentialsDialogOpen = ref(false);
const credentialState = ref<CredentialState>('inactive');
const credentialPendingCount = ref(0);

const addBtnLoading = ref(false);
function addAccount() {
  if (!checkLogin()) return;

  searchAccountDialogRef.value!.open();
}
function openCredentialsDialog() {
  credentialsDialogOpen.value = true;
}
async function onSelectAccount(account: MpAccount | AccountInfo) {
  if (!isRssAccount(account) && !hasValidCredential(account.fakeid)) {
    toast.warning('请先导入 Credential', `添加【${account.nickname}】需要先导入该公众号的 Credential`);
    openCredentialsDialog();
    return;
  }

  addBtnLoading.value = true;
  try {
    if (!isRssAccount(account)) {
      await loadAccountArticle(account, false, INITIAL_SUBSCRIBE_PAGE_SIZE);
    }
    await refresh();
    await bootstrapAiAfterAddingAccount(account.fakeid);
    toast.success(
      isRssAccount(account) ? 'RSS 添加成功' : '公众号添加成功',
      isRssAccount(account)
        ? `已成功添加订阅【${account.nickname}】`
        : `已成功添加公众号【${account.nickname}】，并同步了最近 ${INITIAL_SUBSCRIBE_PAGE_SIZE} 篇文章`
    );
    accountEventBus.emit('account-added', { fakeid: account.fakeid });
  } catch (error: any) {
    const message = String(error?.message || '未知错误');
    toast.error(isRssAccount(account) ? '添加 RSS 失败' : '添加公众号失败', message);
    if (message.includes('Credential')) {
      openCredentialsDialog();
    }
  } finally {
    addBtnLoading.value = false;
  }
}

// 表示同步过程中是否执行了取消操作
const isCanceled = ref(false);
const isDeleting = ref(false);
const isSyncing = ref(false);
const remoteBatchSyncPollTimer = ref<number | null>(null);
const remoteBatchSyncRunningFakeid = ref<string | null>(null);
const remoteBatchSyncFailedFakeids = ref<string[]>([]);
const REMOTE_BATCH_SYNC_IDLE_POLL_MS = 5000;
const lastSyncBannerState = ref<SyncBannerState | null>(null);
const lastRemoteBatchTerminalKey = ref('');

// 当前正在同步的公众号id
const syncingRowId = ref<string | null>(null);

const syncTimer = ref<number | null>(null);
const { scrapeUncachedAccountHtml, stop: stopArticleScrape } = useSyncArticleScraper({
  isCanceled: () => isCanceled.value,
});

async function _load(
  account: MpAccount,
  begin: number,
  loadMore: boolean,
  promise: PromiseInstance,
  initialPageSize = 0
) {
  if (isCanceled.value) {
    isCanceled.value = false; // 这里需要将状态复位
    clearAccountRuntimeSyncState(account.fakeid);
    promise.reject(new Error('已取消同步'));
    return;
  }

  setAccountRuntimeSyncRunning(account);
  syncingRowId.value = account.fakeid;
  isSyncing.value = true;

  const [articles, completed, _totalCount, pageMessageCount, inserted] = await getArticleList(
    account,
    begin,
    '',
    begin === 0 && initialPageSize > 0 ? { initialPageSize } : {}
  );
  if (isCanceled.value) {
    isCanceled.value = false;
    clearAccountRuntimeSyncState(account.fakeid);
    promise.reject(new Error('已取消同步'));
    return;
  }
  const noNewOnThisPage = Number(pageMessageCount) > 0 && inserted === 0;
  if (completed || noNewOnThisPage) {
    await updateRow(account.fakeid);
    clearAccountRuntimeSyncState(account.fakeid);
    syncingRowId.value = null;
    isSyncing.value = false;
    promise.resolve(account);
    return;
  }

  const countByItemidx = articles.filter(article => Number(article.itemidx) === 1).length;
  const countByAppmsg = new Set(
    articles.map(article => Number(article.appmsgid)).filter(appmsgid => Number.isFinite(appmsgid) && appmsgid > 0)
  ).size;
  const count = Number(pageMessageCount) > 0 ? Number(pageMessageCount) : countByItemidx || countByAppmsg || 1;
  begin += count;

  // 检查是否可以「快进」，也就是存在比 lastArticle 更早的缓存数据
  // todo: 这里还可以继续优化，防止出现多段不连续的范围
  let cacheBoundaryCreateTime = 0;
  const lastArticle = articles.at(-1);
  if (lastArticle && lastArticle.create_time < account.last_update_time!) {
    const summary = await getArticleCacheSummary(account.fakeid, lastArticle.create_time);
    if (summary.cachedRows > 0) {
      begin += summary.cachedMessageCount;
      cacheBoundaryCreateTime = summary.oldestCreateTime;
    }
  }

  const tailCreateTime =
    cacheBoundaryCreateTime > 0 ? cacheBoundaryCreateTime : Number(articles.at(-1)?.create_time) || 0;
  const effectiveSyncTimestamp = Math.max(getSyncTimestamp(), Number(account.last_update_time) || 0);
  if (tailCreateTime > 0 && tailCreateTime < effectiveSyncTimestamp) {
    // 普通同步只拉取自上次同步边界以来的新内容，不主动回补更早的历史
    loadMore = false;
  }

  const latestAccount = await updateRow(account.fakeid);
  if (latestAccount) {
    setAccountRuntimeSyncRunning(latestAccount, {
      totalMessages: Number(_totalCount) || latestAccount.total_count || account.total_count || 0,
    });
  }
  if (loadMore) {
    syncTimer.value = window.setTimeout(
      () => {
        if (isCanceled.value) {
          console.warn('已取消同步');
          isCanceled.value = false;
          promise.reject(new Error('已取消同步'));
          return;
        }
        _load(account, begin, true, promise, 0);
      },
      pickRandomSyncDelayMs(preferences.value as unknown as Preferences)
    );
  } else {
    syncingRowId.value = null;
    isSyncing.value = false;
    promise.resolve(account);
  }
}

// 同步指定公众号
async function loadAccountArticle(account: MpAccount, loadMore = true, initialPageSize = 0) {
  if (isRssAccount(account)) {
    setAccountRuntimeSyncRunning(account);
    syncingRowId.value = account.fakeid;
    isSyncing.value = true;

    try {
      const result = await syncRssFeed({ fakeid: account.fakeid });
      await updateRow(account.fakeid);
      clearAccountRuntimeSyncState(account.fakeid);
      return result.account;
    } catch (error) {
      setAccountRuntimeSyncError(account.fakeid, String((error as Error)?.message || 'RSS 同步失败'));
      throw error;
    } finally {
      syncingRowId.value = null;
      isSyncing.value = false;
    }
  }

  const syncedAccount = await new Promise<MpAccount>((resolve, reject) => {
    const promise: PromiseInstance = { resolve, reject };

    _load(account, 0, loadMore, promise, initialPageSize).catch(e => {
      if (String(e?.message || '') !== '已取消同步') {
        setAccountRuntimeSyncError(account.fakeid, String(e?.message || '同步失败'));
      }
      syncingRowId.value = null;
      isSyncing.value = false;

      if (e.message === 'session expired') {
        void navigateToLogin(route.fullPath);
      }
      reject(e);
    });
  });

  if (!isCanceled.value) {
    await scrapeUncachedAccountHtml(account.fakeid, account.nickname || account.fakeid);
  }
  return syncedAccount;
}

// 同步所有公众号
async function loadSelectedAccountArticle() {
  if (!checkLogin()) return;

  isCanceled.value = false;
  setLastSyncBannerState(null);
  const rows = getSelectedRows();
  const failures: Array<{ account: MpAccount; message: string }> = [];
  let successCount = 0;

  for (const account of rows) {
    try {
      await loadAccountArticle(account);
      successCount += 1;
    } catch (error) {
      const message = String((error as Error)?.message || '同步失败');
      if (message === '已取消同步') {
        setLastSyncBannerState({
          tone: 'amber',
          title: '同步已取消',
          detail: `已完成 ${successCount} 个账号，剩余账号未继续执行`,
          progressPercent: 0,
          currentAccountName: '',
          failedCount: failures.length,
          updatedAt: Date.now(),
        });
        toast.warning('已停止同步', `已完成 ${successCount} 个订阅源，剩余任务未继续执行`);
        return;
      }

      failures.push({ account, message });
      if (message === 'session expired') {
        setLastSyncBannerState({
          tone: 'rose',
          title: '同步失败',
          detail: '登录状态已失效，请重新登录后重试',
          progressPercent: 0,
          currentAccountName: '',
          failedCount: failures.length,
          updatedAt: Date.now(),
        });
        toast.error('同步失败', '登录状态已失效，请重新登录后重试');
        return;
      }
    }
  }

  if (failures.length === 0) {
    setLastSyncBannerState({
      tone: 'green',
      title: '同步完成',
      detail: `本轮共完成 ${successCount} 个账号，同步全部成功`,
      progressPercent: 100,
      currentAccountName: '',
      failedCount: 0,
      updatedAt: Date.now(),
    });
    toast.success(`已成功同步 ${rows.length} 个订阅源`);
    return;
  }

  setLastSyncBannerState({
    tone: successCount > 0 ? 'amber' : 'rose',
    title: successCount > 0 ? '部分同步失败' : '同步失败',
    detail: `成功 ${successCount} 个，失败 ${failures.length} 个，可按列表中的失败标识单独重试`,
    progressPercent: 0,
    currentAccountName: '',
    failedCount: failures.length,
    updatedAt: Date.now(),
  });
  toast.warning('部分同步失败', `成功 ${successCount} 个，失败 ${failures.length} 个，可按列表中的失败标识单独重试`);
}

const globalRowData = ref<AccountRow[]>([]);
const listLoading = ref(true);
let refreshSeq = 0;

async function refresh() {
  const hadRows = globalRowData.value.length > 0;
  const seq = ++refreshSeq;
  try {
    const list = (await getAllInfo()).map(buildAccountRow);
    if (seq !== refreshSeq) {
      return;
    }
    globalRowData.value = list;
    const rowIdSet = new Set(globalRowData.value.map(row => row.fakeid));
    selectedRowIds.value = selectedRowIds.value.filter(id => rowIdSet.has(id));
  } catch (error: any) {
    if (seq !== refreshSeq) {
      return;
    }
    if (hadRows) {
      listLoading.value = false;
      return;
    }
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode === 401) {
      void navigateToLogin(route.fullPath);
    }
    const rawMessage = String(error?.message || '未知错误');
    const message = rawMessage.includes('Worker terminated due to reaching memory limit')
      ? '服务进程内存不足，请重启开发服务并使用 yarn dev --no-fork'
      : rawMessage.includes('heap pressure') || rawMessage.includes('内存接近上限')
        ? '服务进程内存接近上限，已自动停止同步，请稍后重试或重启开发服务'
        : rawMessage;
    toast.error('加载公众号失败', message);
  } finally {
    listLoading.value = false;
  }
}

async function updateRow(fakeid: string): Promise<AccountRow | null> {
  const info = await getInfoCache(fakeid);
  const nextRow = info ? buildAccountRow(info) : null;
  const index = globalRowData.value.findIndex(item => item.fakeid === fakeid);
  if (index >= 0 && nextRow) {
    globalRowData.value = globalRowData.value.map(item => (item.fakeid === fakeid ? nextRow : item));
  }
  return nextRow;
}

const selectedRowIds = ref<string[]>([]);
const hasSelectedRows = computed(() => selectedRowIds.value.length > 0);
const selectedCount = computed(() => selectedRowIds.value.length);
const mobileListRef = ref<HTMLElement | null>(null);
const showScrollTop = ref(false);
function getSelectedRows() {
  const selectedIdSet = new Set(selectedRowIds.value);
  return globalRowData.value.filter(row => selectedIdSet.has(row.fakeid));
}

function isRowSelected(account: MpAccount) {
  return selectedRowIds.value.includes(account.fakeid);
}

function toggleRowSelection(account: MpAccount, checked: boolean) {
  if (checked) {
    if (!selectedRowIds.value.includes(account.fakeid)) {
      selectedRowIds.value = [...selectedRowIds.value, account.fakeid];
    }
    return;
  }
  selectedRowIds.value = selectedRowIds.value.filter(id => id !== account.fakeid);
}

function toggleRowSelectionByClick(account: MpAccount) {
  toggleRowSelection(account, !isRowSelected(account));
}

function toggleRowSelectionFromInput(account: MpAccount) {
  toggleRowSelection(account, !isRowSelected(account));
}

function getLoadPercent(account: MpAccount) {
  if (!account.total_count) return 0;
  return Math.min(100, Math.max(0, Math.round((account.count / account.total_count) * 100)));
}

function buildAccountRow(account: MpAccount): AccountRow {
  return {
    ...account,
    _runtimeSync: accountRuntimeSyncStates[account.fakeid] ? { ...accountRuntimeSyncStates[account.fakeid] } : null,
  };
}

const accountRuntimeSyncStates = reactive<Record<string, AccountSyncRuntimeState | undefined>>({});

function syncAccountRuntimeStateToRow(fakeid: string) {
  const runtimeState = accountRuntimeSyncStates[fakeid];
  const index = globalRowData.value.findIndex(item => item.fakeid === fakeid);
  if (index >= 0) {
    const current = globalRowData.value[index];
    globalRowData.value = globalRowData.value.map(item =>
      item.fakeid === fakeid
        ? {
            ...current,
            _runtimeSync: runtimeState ? { ...runtimeState } : null,
          }
        : item
    );
  }
}

function setAccountRuntimeSyncRunning(
  account: Pick<MpAccount, 'fakeid' | 'count' | 'total_count' | 'articles'>,
  overrides: Partial<Pick<AccountSyncRuntimeState, 'syncedMessages' | 'totalMessages' | 'syncedArticles'>> = {},
  source: AccountSyncRuntimeState['source'] = 'local'
) {
  accountRuntimeSyncStates[account.fakeid] = {
    status: 'running',
    syncedMessages: Math.max(0, Number(overrides.syncedMessages ?? account.count) || 0),
    totalMessages: Math.max(0, Number(overrides.totalMessages ?? account.total_count) || 0),
    syncedArticles: Math.max(0, Number(overrides.syncedArticles ?? account.articles) || 0),
    errorMessage: '',
    updatedAt: Date.now(),
    source,
  };
  syncAccountRuntimeStateToRow(account.fakeid);
}

function setAccountRuntimeSyncError(
  fakeid: string,
  message: string,
  source: AccountSyncRuntimeState['source'] = 'local'
) {
  const current = globalRowData.value.find(item => item.fakeid === fakeid);
  const previous = accountRuntimeSyncStates[fakeid];
  accountRuntimeSyncStates[fakeid] = {
    status: 'error',
    syncedMessages: previous?.syncedMessages ?? current?.count ?? 0,
    totalMessages: previous?.totalMessages ?? current?.total_count ?? 0,
    syncedArticles: previous?.syncedArticles ?? current?.articles ?? 0,
    errorMessage: String(message || '同步失败').trim(),
    updatedAt: Date.now(),
    source,
  };
  syncAccountRuntimeStateToRow(fakeid);
}

function clearAccountRuntimeSyncState(fakeid: string) {
  if (!(fakeid in accountRuntimeSyncStates)) {
    return;
  }
  delete accountRuntimeSyncStates[fakeid];
  syncAccountRuntimeStateToRow(fakeid);
}

function getAccountRuntimeSyncState(account: AccountRow): AccountSyncRuntimeState | null {
  return account._runtimeSync || null;
}

function getAccountRuntimeSyncPercent(account: AccountRow): number {
  const state = getAccountRuntimeSyncState(account);
  if (!state || state.status !== 'running' || state.totalMessages <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((state.syncedMessages / state.totalMessages) * 100)));
}

function setLastSyncBannerState(next: SyncBannerState | null) {
  lastSyncBannerState.value = next ? { ...next, updatedAt: Date.now() } : null;
}

const runtimeRunningAccount = computed(
  () => globalRowData.value.find(account => getAccountRuntimeSyncState(account)?.status === 'running') || null
);
const runtimeFailedAccounts = computed(() =>
  globalRowData.value.filter(account => getAccountRuntimeSyncState(account)?.status === 'error')
);
const syncBannerState = computed<SyncBannerState | null>(() => {
  const runningAccount = runtimeRunningAccount.value;
  if (runningAccount) {
    const runtimeState = getAccountRuntimeSyncState(runningAccount);
    if (!runtimeState) {
      return null;
    }
    const total = runtimeState.totalMessages > 0 ? runtimeState.totalMessages : 0;
    const failedCount = runtimeFailedAccounts.value.length;
    return {
      tone: 'blue',
      title: '正在同步',
      detail:
        total > 0
          ? `${runtimeState.syncedMessages}/${total} 条消息，文章 ${runtimeState.syncedArticles}`
          : `已同步消息 ${runtimeState.syncedMessages} 条，文章 ${runtimeState.syncedArticles}`,
      progressPercent: getAccountRuntimeSyncPercent(runningAccount),
      currentAccountName: runningAccount.nickname || runningAccount.fakeid,
      failedCount,
      updatedAt: runtimeState.updatedAt,
    };
  }

  if (lastSyncBannerState.value) {
    return lastSyncBannerState.value;
  }

  const failedCount = runtimeFailedAccounts.value.length;
  if (failedCount <= 0) {
    return null;
  }
  return {
    tone: 'rose',
    title: '同步失败',
    detail: `有 ${failedCount} 个账号失败，可在列表中按失败标识单独重试`,
    progressPercent: 0,
    currentAccountName: '',
    failedCount,
    updatedAt: Date.now(),
  };
});

function clearRemoteAccountRuntimeSyncState(fakeid: string) {
  if (accountRuntimeSyncStates[fakeid]?.source !== 'remote') {
    return;
  }
  clearAccountRuntimeSyncState(fakeid);
}

function applyRemoteRunningAccount(snapshot: RemoteBatchSyncAccountSnapshot) {
  const current = globalRowData.value.find(item => item.fakeid === snapshot.fakeid);
  setAccountRuntimeSyncRunning(
    {
      fakeid: snapshot.fakeid,
      count: current?.count ?? snapshot.syncedMessages,
      total_count: current?.total_count ?? snapshot.totalMessages,
      articles: current?.articles ?? snapshot.syncedArticles,
    },
    {
      syncedMessages: Number(snapshot.syncedMessages) || 0,
      totalMessages: Number(snapshot.totalMessages) || 0,
      syncedArticles: Number(snapshot.syncedArticles) || 0,
    },
    'remote'
  );
}

function applyRemoteErrorAccount(snapshot: RemoteBatchSyncAccountSnapshot) {
  const current = globalRowData.value.find(item => item.fakeid === snapshot.fakeid);
  accountRuntimeSyncStates[snapshot.fakeid] = {
    status: 'error',
    syncedMessages: Number(snapshot.syncedMessages) || current?.count || 0,
    totalMessages: Number(snapshot.totalMessages) || current?.total_count || 0,
    syncedArticles: Number(snapshot.syncedArticles) || current?.articles || 0,
    errorMessage: String(snapshot.message || '同步失败').trim(),
    updatedAt: Number(snapshot.updatedAt) || Date.now(),
    source: 'remote',
  };
  syncAccountRuntimeStateToRow(snapshot.fakeid);
}

function clearRemoteBatchSyncPollTimer() {
  if (remoteBatchSyncPollTimer.value !== null) {
    window.clearTimeout(remoteBatchSyncPollTimer.value);
    remoteBatchSyncPollTimer.value = null;
  }
}

function scheduleRemoteBatchSyncPoll(delayMs: number) {
  if (!import.meta.client) {
    return;
  }
  clearRemoteBatchSyncPollTimer();
  remoteBatchSyncPollTimer.value = window.setTimeout(
    () => {
      remoteBatchSyncPollTimer.value = null;
      void syncRemoteBatchSyncStatus();
    },
    Math.max(1000, delayMs || 3000)
  );
}

function applyRemoteBatchSyncSnapshot(snapshot: RemoteBatchSyncJobSnapshot | null) {
  const previousRunningFakeid = remoteBatchSyncRunningFakeid.value;
  const nextRunningFakeid =
    snapshot?.status === 'running' && snapshot.currentAccount?.status === 'running'
      ? String(snapshot.currentAccount.fakeid || '')
      : '';
  const nextFailedFakeids = new Set(
    (Array.isArray(snapshot?.failedAccounts) ? snapshot.failedAccounts : []).map(account =>
      String(account.fakeid || '')
    )
  );

  if (
    previousRunningFakeid &&
    previousRunningFakeid !== nextRunningFakeid &&
    !nextFailedFakeids.has(previousRunningFakeid)
  ) {
    clearRemoteAccountRuntimeSyncState(previousRunningFakeid);
  }

  for (const fakeid of remoteBatchSyncFailedFakeids.value) {
    if (!nextFailedFakeids.has(fakeid)) {
      clearRemoteAccountRuntimeSyncState(fakeid);
    }
  }

  if (snapshot?.currentAccount?.status === 'running') {
    applyRemoteRunningAccount(snapshot.currentAccount);
  } else if (nextRunningFakeid) {
    clearRemoteAccountRuntimeSyncState(nextRunningFakeid);
  }

  for (const failedAccount of Array.isArray(snapshot?.failedAccounts) ? snapshot.failedAccounts : []) {
    applyRemoteErrorAccount(failedAccount);
  }

  remoteBatchSyncRunningFakeid.value = nextRunningFakeid || null;
  remoteBatchSyncFailedFakeids.value = Array.from(nextFailedFakeids);

  if (!snapshot || snapshot.status !== 'running') {
    if (!nextFailedFakeids.size && previousRunningFakeid) {
      clearRemoteAccountRuntimeSyncState(previousRunningFakeid);
    }
  }
}

async function getRemoteBatchSyncStatus(): Promise<RemoteBatchSyncJobSnapshot | null> {
  const resp = await request<{ data: RemoteBatchSyncJobSnapshot | null }>('/api/web/reader/batch-sync-status');
  return resp.data || null;
}

async function syncRemoteBatchSyncStatus() {
  clearRemoteBatchSyncPollTimer();

  try {
    const snapshot = await getRemoteBatchSyncStatus();
    applyRemoteBatchSyncSnapshot(snapshot);

    if (snapshot?.status === 'running') {
      lastRemoteBatchTerminalKey.value = '';
      setLastSyncBannerState(null);
      scheduleRemoteBatchSyncPoll(Math.max(1000, Number(snapshot.pollAfterMs) || 3000));
      return;
    }

    if (snapshot) {
      const terminalKey = `${snapshot.jobId}:${snapshot.status}:${snapshot.updatedAt}`;
      if (lastRemoteBatchTerminalKey.value !== terminalKey) {
        lastRemoteBatchTerminalKey.value = terminalKey;
        if (snapshot.status === 'success') {
          setLastSyncBannerState({
            tone: snapshot.failedCount > 0 ? 'amber' : 'green',
            title: snapshot.failedCount > 0 ? '部分同步失败' : '同步完成',
            detail:
              snapshot.failedCount > 0
                ? `本轮完成 ${snapshot.successCount} 个账号，失败 ${snapshot.failedCount} 个`
                : `本轮共完成 ${snapshot.successCount} 个账号，同步全部成功`,
            progressPercent: 100,
            currentAccountName: '',
            failedCount: snapshot.failedCount,
            updatedAt: snapshot.updatedAt,
          });
        } else if (snapshot.status === 'canceled') {
          setLastSyncBannerState({
            tone: 'amber',
            title: '同步已取消',
            detail: `已完成 ${snapshot.completedAccounts}/${snapshot.totalAccounts} 个账号`,
            progressPercent: 0,
            currentAccountName: '',
            failedCount: snapshot.failedCount,
            updatedAt: snapshot.updatedAt,
          });
        } else if (snapshot.status === 'error') {
          setLastSyncBannerState({
            tone: 'rose',
            title: '同步失败',
            detail:
              snapshot.failedCount > 0
                ? `失败 ${snapshot.failedCount} 个账号${snapshot.message ? `：${snapshot.message}` : ''}`
                : snapshot.message || '本轮同步失败',
            progressPercent: 0,
            currentAccountName: '',
            failedCount: snapshot.failedCount || 1,
            updatedAt: snapshot.updatedAt,
          });
        }
      }
    }

    scheduleRemoteBatchSyncPoll(REMOTE_BATCH_SYNC_IDLE_POLL_MS);
  } catch (error) {
    const statusCode =
      Number((error as { statusCode?: number; response?: { status?: number } })?.statusCode || 0) ||
      Number((error as { response?: { status?: number } })?.response?.status || 0);
    if (statusCode === 401) {
      applyRemoteBatchSyncSnapshot(null);
      return;
    }
    console.warn('load remote batch sync status failed:', error);
    scheduleRemoteBatchSyncPoll(5000);
  }
}

function onMobileListScroll() {
  showScrollTop.value = (mobileListRef.value?.scrollTop || 0) > 320;
}

function scrollMobileListToTop() {
  mobileListRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function syncSingleAccount(account: MpAccount) {
  if (!checkLogin()) return;

  isCanceled.value = false;
  setLastSyncBannerState(null);
  try {
    await loadAccountArticle(account);
    setLastSyncBannerState({
      tone: 'green',
      title: '同步完成',
      detail: `账号【${account.nickname || account.fakeid}】已同步完成`,
      progressPercent: 100,
      currentAccountName: account.nickname || account.fakeid,
      failedCount: 0,
      updatedAt: Date.now(),
    });
    toast.success('同步完成', `公众号【${account.nickname}】的文章已同步完毕`);
  } catch (e: any) {
    const message = String(e?.message || '未知错误');
    setLastSyncBannerState({
      tone: message === '已取消同步' ? 'amber' : 'rose',
      title: message === '已取消同步' ? '同步已取消' : '同步失败',
      detail: `账号【${account.nickname || account.fakeid}】${message === '已取消同步' ? '已取消同步' : `同步失败：${message}`}`,
      progressPercent: 0,
      currentAccountName: account.nickname || account.fakeid,
      failedCount: message === '已取消同步' ? 0 : 1,
      updatedAt: Date.now(),
    });
    if (message === '已取消同步') {
      toast.warning('同步已取消', `公众号【${account.nickname || account.fakeid}】已取消同步`);
      return;
    }
    toast.error('同步失败', message);
  }
}

async function bootstrapAiAfterAddingAccount(fakeid: string) {
  const normalizedFakeid = String(fakeid || '').trim();
  if (!normalizedFakeid || !aiAutoSummaryOnSyncEnabled.value) {
    return;
  }

  try {
    await bootstrapAccountAi(normalizedFakeid, 10);
  } catch (error) {
    console.error('AI bootstrap after add failed:', error);
  }
}

function stopSync() {
  const activeFakeid = syncingRowId.value;
  isCanceled.value = true;
  stopArticleScrape();
  if (syncTimer.value) {
    window.clearTimeout(syncTimer.value);
    syncTimer.value = null;
  }

  if (activeFakeid) {
    clearAccountRuntimeSyncState(activeFakeid);
  }

  syncingRowId.value = null;
  isSyncing.value = false;
}

async function updateCategoryFromCard(account: MpAccount, value: string) {
  const category = String(value || '').trim();
  if ((account.category || '') === category) {
    return;
  }
  account.category = category;
  await updateAccountCategory(account.fakeid, category);
  await updateRow(account.fakeid);
}

watch(
  () => Boolean(loginAccount.value),
  loggedIn => {
    if (loggedIn) {
      void refresh();
    }
  },
  { immediate: true }
);

onMounted(() => {
  void refresh();
  void syncRemoteBatchSyncStatus();
});

onActivated(() => {
  void refresh();
});

onUnmounted(() => {
  stopAccountEventBus();
  clearRemoteBatchSyncPollTimer();
});

// 删除所选的公众号数据
function deleteSelectedAccounts() {
  const rows = getSelectedRows();
  const ids = rows.map(info => info.fakeid);
  modal.open(ConfirmModal, {
    title: '确定要删除所选公众号的数据吗？',
    description: '删除之后，该公众号的所有数据(包括已下载的文章和留言等)都将被清空。',
    async onConfirm() {
      try {
        isDeleting.value = true;
        await deleteAccountData(ids);
        // 通知 Credentials 面板这些公众号已被移除
        ids.forEach(fakeid => accountEventBus.emit('account-removed', { fakeid: fakeid }));
      } finally {
        isDeleting.value = false;
        await refresh();
      }
    },
  });
}

// 导入公众号
const fileRef = ref<HTMLInputElement | null>(null);
const importBtnLoading = ref(false);
function importAccount() {
  fileRef.value!.click();
}
async function handleFileChange(evt: Event) {
  const files = (evt.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    const file = files[0];

    try {
      importBtnLoading.value = true;

      // 解析 JSON
      const jsonData = JSON.parse(await file.text());
      if (jsonData.usefor !== 'wechat-article-exporter') {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }
      const infos = jsonData.accounts;
      if (!infos || infos.length <= 0) {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }

      await importMpAccounts(infos);
      await refresh();
    } catch (error) {
      console.error('导入公众号时 JSON 解析失败:', error);
      toast.error('导入公众号', (error as Error).message);
    } finally {
      importBtnLoading.value = false;
    }
  }
}

// 导出公众号
const exportBtnLoading = ref(false);
function exportAccount() {
  exportBtnLoading.value = true;
  try {
    const rows = getSelectedRows();
    const data: AccountManifest = {
      version: '1.0',
      usefor: 'wechat-article-exporter',
      accounts: rows,
    };
    exportAccountJsonFile(data, '公众号');
    toast.success('导出订阅源', `成功导出了 ${rows.length} 个订阅源`);
  } finally {
    exportBtnLoading.value = false;
  }
}

const { getActualDateRange } = useSyncDeadline();
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">公众号管理</h1>
    </Teleport>

    <div class="flex h-full flex-col divide-y divide-gray-200 dark:divide-slate-800">
      <header class="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-slate-50/92 px-3 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/88 md:static md:border-b-0 md:bg-transparent md:backdrop-blur-0 md:dark:bg-transparent">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              size="sm"
              icon="i-lucide:user-plus"
              color="blue"
              :disabled="isDeleting || addBtnLoading"
              @click="addAccount"
            >
              {{ addBtnLoading ? '添加中...' : '添加账号' }}
            </UButton>
            <UButton
              size="sm"
              icon="i-lucide:key-round"
              color="gray"
              variant="soft"
              @click="openCredentialsDialog"
            >
              导入 Credential<span v-if="credentialPendingCount > 0">（{{ credentialPendingCount }}）</span>
            </UButton>
            <UButton
              class="hidden md:inline-flex"
              size="sm"
              icon="i-lucide:arrow-down-to-line"
              color="gray"
              variant="soft"
              :loading="importBtnLoading"
              @click="importAccount"
            >
              导入
              <input ref="fileRef" type="file" accept=".json" class="hidden" @change="handleFileChange" />
            </UButton>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              size="sm"
              icon="i-lucide:arrow-up-from-line"
              color="gray"
              variant="soft"
              :loading="exportBtnLoading"
              :disabled="!hasSelectedRows"
              @click="exportAccount"
            >
              导出
            </UButton>
            <UButton
              size="sm"
              color="rose"
              variant="soft"
              icon="i-lucide:user-minus"
              class="disabled:opacity-35"
              :loading="isDeleting"
              :disabled="!hasSelectedRows"
              @click="deleteSelectedAccounts"
            >
              删除
            </UButton>
            <UButton
              size="sm"
              color="black"
              icon="i-heroicons:arrow-path-rounded-square-20-solid"
              class="disabled:opacity-35"
              :loading="isSyncing"
              :disabled="isDeleting || !hasSelectedRows"
              @click="loadSelectedAccountArticle"
            >
              同步选中
            </UButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-900 dark:text-slate-300">账号总数 {{ globalRowData.length }}</span>
          <span class="rounded-full bg-blue-50 px-3 py-1 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">已选择 {{ selectedCount }} 个</span>
          <span class="rounded-full bg-amber-50 px-3 py-1 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">同步范围 {{ getActualDateRange() }}</span>
        </div>

        <div
          v-if="syncBannerState"
          class="rounded-[22px] border px-4 py-3 shadow-[0_14px_28px_rgba(15,23,42,0.06)] backdrop-blur"
          :class="
            syncBannerState.tone === 'blue'
              ? 'border-blue-200 bg-blue-50/90 text-blue-900 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100'
              : syncBannerState.tone === 'green'
                ? 'border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100'
                : syncBannerState.tone === 'amber'
                  ? 'border-amber-200 bg-amber-50/90 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100'
                  : 'border-rose-200 bg-rose-50/90 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100'
          "
        >
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  :class="
                    syncBannerState.tone === 'blue'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
                      : syncBannerState.tone === 'green'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                        : syncBannerState.tone === 'amber'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                  "
                >
                  {{ syncBannerState.title }}
                </span>
                <span v-if="syncBannerState.currentAccountName" class="truncate text-sm font-semibold">
                  {{ syncBannerState.currentAccountName }}
                </span>
              </div>
              <p class="text-sm leading-6 opacity-90">
                {{ syncBannerState.detail }}
              </p>
              <div class="flex flex-wrap items-center gap-2 text-[11px] opacity-75">
                <span v-if="syncBannerState.failedCount > 0">失败 {{ syncBannerState.failedCount }} 个</span>
                <span>更新于 {{ formatTimeStamp(Math.floor(syncBannerState.updatedAt / 1000)) }}</span>
              </div>
            </div>

            <div v-if="syncBannerState.progressPercent > 0" class="md:w-56">
              <div class="mb-1 flex items-center justify-between text-[11px] font-medium opacity-80">
                <span>整体进度</span>
                <span>{{ syncBannerState.progressPercent }}%</span>
              </div>
              <div class="h-2 rounded-full bg-white/60 dark:bg-white/10">
                <div
                  class="h-2 rounded-full transition-all"
                  :class="
                    syncBannerState.tone === 'blue'
                      ? 'bg-blue-500'
                      : syncBannerState.tone === 'green'
                        ? 'bg-emerald-500'
                        : syncBannerState.tone === 'amber'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                  "
                  :style="{ width: `${syncBannerState.progressPercent}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1">
        <div
          v-if="listLoading && globalRowData.length === 0"
          class="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400"
        >
          正在加载公众号列表...
        </div>

        <div v-else-if="globalRowData.length === 0">
          <EmptyStatePanel
            icon="i-lucide-users"
            title="还没有公众号账号"
            description="先添加或导入订阅源，之后就可以在这里批量同步和管理分类。"
          />
        </div>

        <div v-else class="h-full">
          <div
            ref="mobileListRef"
            class="h-full overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+6.5rem)]"
            @scroll.passive="onMobileListScroll"
          >
            <div class="space-y-3">
              <article
                v-for="account in globalRowData"
                :key="account.fakeid"
                class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900"
                :class="isRowSelected(account) ? 'border-blue-300 ring-2 ring-blue-100' : ''"
                role="button"
                tabindex="0"
                @click="toggleRowSelectionByClick(account)"
                @keydown.enter.prevent="toggleRowSelectionByClick(account)"
                @keydown.space.prevent="toggleRowSelectionByClick(account)"
              >
                <div class="flex items-start gap-3">
                  <input
                    :checked="isRowSelected(account)"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    @click.stop
                    @change="toggleRowSelectionFromInput(account)"
                  />

                  <div class="min-w-0 flex-1 space-y-3">
                    <div class="flex items-start gap-3">
                      <img
                        v-if="account.round_head_img"
                        :src="IMAGE_PROXY + account.round_head_img"
                        alt=""
                        class="h-11 w-11 rounded-full border border-slate-200 object-cover"
                      />
                      <div
                        v-else
                        class="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                      >
                        <UIcon name="i-lucide-user-round" />
                      </div>

                      <div class="min-w-0 flex-1 space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <h2 class="truncate text-sm font-semibold text-slate-800">
                            {{ account.nickname || account.fakeid }}
                          </h2>
                          <span
                            class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                            :class="
                              account.completed
                                ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                            "
                          >
                            {{ account.completed ? '已完成' : '未完成' }}
                          </span>
                          <span
                            v-if="getAccountRuntimeSyncState(account)?.status === 'running'"
                            class="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                          >
                            同步中
                          </span>
                          <span
                            v-else-if="getAccountRuntimeSyncState(account)?.status === 'error'"
                            class="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          >
                            同步失败
                          </span>
                        </div>

                        <div class="space-y-1 text-xs text-slate-500">
                          <p class="font-mono text-[11px] text-slate-400">{{ account.fakeid }}</p>
                          <p>同步 {{ account.count || 0 }} / {{ account.total_count || 0 }}，文章 {{ account.articles || 0 }}</p>
                          <p>最后同步：{{ account.update_time ? formatTimeStamp(account.update_time) : '--' }}</p>
                        </div>
                      </div>
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between text-[11px] text-slate-500">
                        <span>同步进度</span>
                        <span>{{ getLoadPercent(account) }}%</span>
                      </div>
                      <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          class="h-2 rounded-full bg-blue-500 transition-all"
                          :style="{ width: `${getLoadPercent(account)}%` }"
                        />
                      </div>
                    </div>

                    <div
                      v-if="getAccountRuntimeSyncState(account)?.status === 'running'"
                      class="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-3 dark:border-blue-500/20 dark:bg-blue-500/10"
                    >
                      <div class="flex items-center justify-between text-[11px] text-blue-700 dark:text-blue-300">
                        <span>本次同步</span>
                        <span>{{ getAccountRuntimeSyncPercent(account) }}%</span>
                      </div>
                      <div class="h-2 rounded-full bg-blue-100 dark:bg-blue-500/20">
                        <div
                          class="h-2 rounded-full bg-blue-500 transition-all"
                          :style="{ width: `${getAccountRuntimeSyncPercent(account)}%` }"
                        />
                      </div>
                      <p class="text-[11px] text-blue-700 dark:text-blue-300">
                        {{
                          `${getAccountRuntimeSyncState(account)?.syncedMessages || 0} / ${getAccountRuntimeSyncState(account)?.totalMessages || 0}`
                        }}
                        ，文章 {{ getAccountRuntimeSyncState(account)?.syncedArticles || 0 }}
                      </p>
                    </div>

                    <div
                      v-else-if="getAccountRuntimeSyncState(account)?.status === 'error'"
                      class="rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-3 text-[11px] leading-5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"
                    >
                      {{ getAccountRuntimeSyncState(account)?.errorMessage || '同步失败，请稍后重试' }}
                    </div>

                    <UInput
                      :model-value="account.category || ''"
                      size="sm"
                      placeholder="分类"
                      @click.stop
                      @update:model-value="value => (account.category = String(value || ''))"
                      @keyup.enter="updateCategoryFromCard(account, account.category || '')"
                      @blur="updateCategoryFromCard(account, account.category || '')"
                    />

                    <div class="flex flex-wrap gap-2">
                      <UButton
                        v-if="isSyncing && syncingRowId === account.fakeid"
                        size="sm"
                        color="green"
                        @click.stop="stopSync"
                      >
                        停止
                      </UButton>
                      <UButton
                        v-else
                        size="sm"
                        color="blue"
                        :disabled="isDeleting || isSyncing"
                        @click.stop="syncSingleAccount(account)"
                      >
                        同步
                      </UButton>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>

        </div>
      </div>
    </div>

    <ScrollTopFab :visible="showScrollTop" @click="scrollMobileListToTop" />
    <CredentialsDialog
      v-model:open="credentialsDialogOpen"
      v-model:state="credentialState"
      @update:pending-count="credentialPendingCount = $event"
    />
    <GlobalSearchAccountDialog
      ref="searchAccountDialogRef"
      @select:account="onSelectAccount"
      @request:credentials="openCredentialsDialog"
    />
  </div>
</template>

