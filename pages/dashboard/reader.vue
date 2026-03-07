<script setup lang="ts">
import { format } from 'date-fns';
import { formatTimeStamp } from '#shared/utils/helpers';
import { normalizeHtml } from '#shared/utils/html';
import { request } from '#shared/utils/request';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';
import { getArticleList } from '~/apis';
import ButtonGroup from '~/components/ButtonGroup.vue';
import GlobalSearchAccountDialog from '~/components/global/SearchAccountDialog.vue';
import EmptyStatePanel from '~/components/mobile/EmptyStatePanel.vue';
import LoadingCards from '~/components/mobile/LoadingCards.vue';
import ScrollTopFab from '~/components/mobile/ScrollTopFab.vue';
import ConfirmModal from '~/components/modal/Confirm.vue';
import LoginModal from '~/components/modal/Login.vue';
import IframeHtmlRenderer from '~/components/preview/IframeHtmlRenderer.vue';
import toastFactory from '~/composables/toast';
import useLoginCheck from '~/composables/useLoginCheck';
import { IMAGE_PROXY, websiteName } from '~/config';
import ApiPage from '~/pages/dashboard/api.vue';
import SettingsPage from '~/pages/dashboard/settings.vue';
import { deleteAccountData } from '~/store/v2';
import {
  articleDeleted,
  buildArticleStorageKey,
  getArticleCacheSummary,
  updateArticleFavorite,
  updateArticleStatus,
  upsertArticlesFromRemote,
} from '~/store/v2/article';
import { getHtmlCache } from '~/store/v2/html';
import {
  getAllInfo,
  getInfoCache,
  importMpAccounts,
  type MpAccount,
  updateAccountCategory,
  updateAccountFocused,
} from '~/store/v2/info';
import { migrateLegacyIndexedDbToServer, migrateLegacyLargeCacheToServer } from '~/store/v2/legacy-migration';
import type { AccountManifest } from '~/types/account';
import type { Preferences } from '~/types/preferences';
import type { AccountInfo, AppMsgExWithFakeID, LogoutResponse } from '~/types/types';
import { exportAccountJsonFile } from '~/utils/exporter';

useHead({
  title: `聚合阅读 | ${websiteName}`,
});

interface ReaderCategory {
  id: string;
  label: string;
  count: number;
}

interface ReaderArticle extends AppMsgExWithFakeID {
  accountName: string;
  category: string;
  round_head_img?: string;
  contentDownload?: boolean;
  commentDownload?: boolean;
  favorite?: boolean;
}

interface PromiseInstance {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

type SystemMenuId = 'api' | 'settings';

interface SystemMenuItem {
  id: SystemMenuId;
  label: string;
  icon: string;
}

interface ReaderRuntimeState {
  knownArticleKeys: string[];
  unreadArticleKeys: string[];
  accountNewArticleFakeids: string[];
}

interface MobileHistoryState {
  categoryId: string;
  accountId: string | null;
  articleKey: string | null;
}

type MobileSwipeContext = 'articles' | 'article' | 'drawer';
type MobileSwipeEdge = 'left' | 'right' | 'none';

interface MobileSwipeState {
  context: MobileSwipeContext | null;
  tracking: boolean;
  interactive: boolean;
  axis: 'x' | 'y' | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  edge: MobileSwipeEdge;
}

function normalizeReaderRuntimeState(input?: Partial<ReaderRuntimeState> | null): ReaderRuntimeState {
  return {
    knownArticleKeys: Array.isArray(input?.knownArticleKeys)
      ? input.knownArticleKeys.map(key => String(key || '')).filter(Boolean)
      : [],
    unreadArticleKeys: Array.isArray(input?.unreadArticleKeys)
      ? input.unreadArticleKeys.map(key => String(key || '')).filter(Boolean)
      : [],
    accountNewArticleFakeids: Array.isArray(input?.accountNewArticleFakeids)
      ? input.accountNewArticleFakeids.map(fakeid => String(fakeid || '')).filter(Boolean)
      : [],
  };
}

interface AccountSyncProgress {
  fakeid: string;
  running: boolean;
  syncedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  updatedAt: number;
}

interface BatchSyncProgress {
  running: boolean;
  completedAccounts: number;
  totalAccounts: number;
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
  heapUsedMb: number;
  pollAfterMs: number;
}

interface SchedulerArticleEntry {
  fakeid: string;
  articles: any[];
  totalCount: number;
  updatedAt: number;
}

type SchedulerArticleMap = Record<string, SchedulerArticleEntry>;

const toast = toastFactory();
const modal = useModal();
const { checkLogin } = useLoginCheck();
const loginAccount = useLoginAccount();
const preferences = usePreferences();
const { getSyncTimestamp } = useSyncDeadline();
const FOCUS_CATEGORY_ID = '__focus__';
const FOCUS_CATEGORY_LABEL = '重点关注';

const loading = ref(false);
const contentLoading = ref(false);
const addBtnLoading = ref(false);
const importBtnLoading = ref(false);
const exportBtnLoading = ref(false);
const isDeleting = ref(false);
const isSyncing = ref(false);
const isCanceled = ref(false);
const syncingRowId = ref<string | null>(null);
const syncTimer = ref<number | null>(null);
const logoutBtnLoading = ref(false);
const nowTick = ref(Date.now());
const schedulerSyncTimer = ref<number | null>(null);
const schedulerHydrationStarted = ref(false);
const schedulerHydrationRunning = ref(false);
const syncProgressByFakeid = ref<Record<string, AccountSyncProgress>>({});
const batchSyncProgress = ref<BatchSyncProgress>({
  running: false,
  completedAccounts: 0,
  totalAccounts: 0,
});

const accounts = ref<MpAccount[]>([]);
const articleRows = ref<ReaderArticle[]>([]);
const articleTotalCount = ref(0);
const articlePageOffset = ref(0);
const articlePageLimit = 80;
const articlePageLoading = ref(false);
const articlePageHasMore = ref(true);
let articleLoadSeq = 0;
const runtimeStateSync = useAccountSyncedState<ReaderRuntimeState>({
  storageKey: 'reader-runtime-state',
  remoteKey: 'reader-runtime-state',
  defaultValue: normalizeReaderRuntimeState(),
  normalize: value => normalizeReaderRuntimeState(value as Partial<ReaderRuntimeState> | null),
});
const runtimeState = runtimeStateSync.state;
const legacyMigrationDone = useLocalStorage<boolean>('reader-legacy-migration-v2', false);
const legacyLargeCacheMigrationDone = useLocalStorage<boolean>('reader-legacy-large-cache-migration-v1', false);
const schedulerHydrationDone = useLocalStorage<boolean>('reader-scheduler-hydration-v1', false);
const knownArticleMap = ref<Record<string, true>>({});
const unreadArticleMap = ref<Record<string, true>>({});
const accountNewArticleMap = ref<Record<string, true>>({});

const selectedCategory = ref('__all__');
const selectedAccount = ref<string | null>(null);
const selectedArticle = ref<ReaderArticle | null>(null);
const selectedArticleHtml = ref('');
const selectedArticleKeys = ref<Set<string>>(new Set());
const selectionMode = ref(false);
const favoriteOnlySync = useAccountSyncedState<boolean>({
  storageKey: 'reader-article-favorite-filter-v1',
  remoteKey: 'reader-article-favorite-filter-v1',
  defaultValue: false,
  normalize: value => Boolean(value),
});
const favoriteOnly = favoriteOnlySync.state;
const accountKeyword = ref('');
const categoryEditorOpen = ref(false);
const categoryEditorAccount = ref<MpAccount | null>(null);
const categoryEditorValue = ref('未分类');
const categoryEditorNewValue = ref('');
const categoryEditorSaving = ref(false);
const categoryEditorAdding = ref(false);
const categoryDeleting = ref<string | null>(null);
const systemMenuOpen = ref(false);
const systemMenuActive = ref<SystemMenuId>('settings');

const fileRef = ref<HTMLInputElement | null>(null);
const searchAccountDialogRef = ref<typeof GlobalSearchAccountDialog | null>(null);

const systemMenuItems: SystemMenuItem[] = [
  { id: 'api', label: 'API 说明', icon: 'i-lucide:file-code-2' },
  { id: 'settings', label: '设置', icon: 'i-lucide:settings-2' },
];

const { accountEventBus } = useAccountEventBus();
accountEventBus.on(event => {
  if (event === 'account-added' || event === 'account-removed') {
    refreshData();
  }
});

function normalizeCategory(account: MpAccount): string {
  const raw = account.category || '';
  const value = raw.trim();
  return value.length > 0 ? value : '未分类';
}

function articleKey(article: ReaderArticle) {
  return buildArticleStorageKey(article.fakeid, article);
}

function normalizeDisplayTitle(title?: string, digest?: string): string {
  const normalizedLines = (title || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let candidate = normalizedLines[0] || (digest || '').trim();
  if (!candidate) {
    return '无标题';
  }

  candidate = candidate.replace(/\s+/g, ' ');
  const maxLength = 110;
  if (candidate.length > maxLength) {
    return `${candidate.slice(0, maxLength)}...`;
  }

  return candidate;
}

function articleDisplayTitle(article: ReaderArticle): string {
  return normalizeDisplayTitle(article.title, article.digest);
}

function normalizeRuntimeErrorMessage(rawMessage: string): string {
  if (rawMessage.includes('Worker terminated due to reaching memory limit')) {
    return '服务进程内存不足，请重启开发服务并使用 yarn dev --no-fork';
  }
  if (rawMessage.includes('heap pressure') || rawMessage.includes('内存接近上限')) {
    return '服务进程内存接近上限，已自动停止同步，请稍后重试或重启开发服务';
  }
  return rawMessage;
}

function isMemoryPressureSyncMessage(message: string): boolean {
  return message.includes('heap pressure') || message.includes('内存接近上限');
}

function findAccount(fakeid: string | null) {
  if (!fakeid) return undefined;
  return accounts.value.find(account => account.fakeid === fakeid);
}

function upsertSyncProgress(fakeid: string, patch: Partial<AccountSyncProgress>) {
  const previous = syncProgressByFakeid.value[fakeid];
  syncProgressByFakeid.value = {
    ...syncProgressByFakeid.value,
    [fakeid]: {
      fakeid,
      running: patch.running ?? previous?.running ?? false,
      syncedMessages: Number(patch.syncedMessages ?? previous?.syncedMessages ?? 0),
      totalMessages: Number(patch.totalMessages ?? previous?.totalMessages ?? 0),
      syncedArticles: Number(patch.syncedArticles ?? previous?.syncedArticles ?? 0),
      updatedAt: Date.now(),
    },
  };
}

async function refreshAccountSnapshot(fakeid: string, running = true) {
  const latest = await getInfoCache(fakeid);
  if (!latest) {
    return;
  }

  const target = accounts.value.find(account => account.fakeid === fakeid);
  if (target) {
    Object.assign(target, latest);
  } else {
    accounts.value = [latest, ...accounts.value];
  }

  upsertSyncProgress(fakeid, {
    running,
    syncedMessages: Number(latest.count) || 0,
    totalMessages: Number(latest.total_count) || 0,
    syncedArticles: Number(latest.articles) || 0,
  });
}

function isAccountVisibleInCurrentScope(account: MpAccount): boolean {
  if (selectedAccount.value) {
    return selectedAccount.value === account.fakeid;
  }
  if (selectedCategory.value === FOCUS_CATEGORY_ID) {
    return isFocusedAccount(account);
  }
  if (selectedCategory.value === '__all__') {
    return true;
  }
  return normalizeCategory(account) === selectedCategory.value;
}

function normalizeSyncArticle(account: MpAccount, article: any): ReaderArticle {
  return {
    ...(article || {}),
    fakeid: account.fakeid,
    accountName: account.nickname || account.fakeid,
    category: normalizeCategory(account),
    round_head_img: account.round_head_img || '',
    _status: String(article?._status || ''),
    is_deleted: Boolean(article?.is_deleted),
    contentDownload: false,
    commentDownload: false,
  } as ReaderArticle;
}

function mergeSyncedArticlesIntoView(account: MpAccount, incoming: any[]) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return;
  }
  if (!isAccountVisibleInCurrentScope(account)) {
    return;
  }

  const nextRows = [...articleRows.value];
  const indexByKey = new Map<string, number>();
  nextRows.forEach((article, index) => {
    indexByKey.set(articleKey(article), index);
  });

  let inserted = 0;
  incoming.forEach(rawArticle => {
    const normalized = normalizeSyncArticle(account, rawArticle);
    const key = articleKey(normalized);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, nextRows.length);
      nextRows.push(normalized);
      inserted += 1;
      return;
    }

    const previous = nextRows[index];
    nextRows[index] = {
      ...previous,
      ...normalized,
      contentDownload: previous.contentDownload,
      commentDownload: previous.commentDownload,
    };
  });

  nextRows.sort((a, b) => {
    const aTime = Number(a.update_time || a.create_time || 0);
    const bTime = Number(b.update_time || b.create_time || 0);
    return bTime - aTime;
  });

  articleRows.value = nextRows;
  if (inserted > 0) {
    articleTotalCount.value = Math.max(articleTotalCount.value + inserted, nextRows.length);
    articlePageOffset.value = nextRows.length;
    articlePageHasMore.value = articlePageOffset.value < articleTotalCount.value;
  }

  const latestArticleKeys = new Set(nextRows.map(article => articleKey(article)));
  syncUnreadStateByLatest(latestArticleKeys, false);
}

function persistRuntimeState() {
  runtimeState.value = {
    knownArticleKeys: Object.keys(knownArticleMap.value),
    unreadArticleKeys: Object.keys(unreadArticleMap.value),
    accountNewArticleFakeids: Object.keys(accountNewArticleMap.value),
  };
}

function initializeRuntimeState() {
  const knownMap: Record<string, true> = {};
  const unreadMap: Record<string, true> = {};
  const accountMap: Record<string, true> = {};

  (runtimeState.value.knownArticleKeys || []).forEach(key => {
    knownMap[key] = true;
  });
  (runtimeState.value.unreadArticleKeys || []).forEach(key => {
    unreadMap[key] = true;
  });
  (runtimeState.value.accountNewArticleFakeids || []).forEach(fakeid => {
    accountMap[fakeid] = true;
  });

  knownArticleMap.value = knownMap;
  unreadArticleMap.value = unreadMap;
  accountNewArticleMap.value = accountMap;
}

watch(
  runtimeState,
  () => {
    initializeRuntimeState();
  },
  { deep: true }
);

function markAccountHasNewArticles(fakeid: string) {
  if (!fakeid || accountNewArticleMap.value[fakeid]) {
    return;
  }
  accountNewArticleMap.value = {
    ...accountNewArticleMap.value,
    [fakeid]: true,
  };
  persistRuntimeState();
}

function clearAccountNewArticles(fakeid: string | null) {
  if (!fakeid || !accountNewArticleMap.value[fakeid]) {
    return;
  }
  const next = { ...accountNewArticleMap.value };
  delete next[fakeid];
  accountNewArticleMap.value = next;
  persistRuntimeState();
}

function hasAccountNewArticles(account: MpAccount): boolean {
  return Boolean(accountNewArticleMap.value[account.fakeid]);
}

const categories = computed<ReaderCategory[]>(() => {
  const focusedCount = accounts.value.filter(account => isFocusedAccount(account)).length;
  const map = new Map<string, number>();
  accounts.value.forEach(account => {
    const category = normalizeCategory(account);
    if (category === FOCUS_CATEGORY_LABEL) {
      return;
    }
    map.set(category, (map.get(category) || 0) + 1);
  });

  const items = Array.from(map.entries())
    .map(([label, count]) => ({ id: label, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));

  return [
    { id: '__all__', label: '全部分类', count: accounts.value.length },
    { id: FOCUS_CATEGORY_ID, label: FOCUS_CATEGORY_LABEL, count: focusedCount },
    ...items,
  ];
});

const editableCategoryNames = computed(() =>
  categories.value.filter(item => item.id !== '__all__' && item.id !== FOCUS_CATEGORY_ID).map(item => item.label)
);

const activeSystemMenuItem = computed(
  () => systemMenuItems.find(item => item.id === systemMenuActive.value) || systemMenuItems[0]
);
const activeSystemMenuComponent = computed(() => {
  if (systemMenuActive.value === 'api') return ApiPage;
  return SettingsPage;
});

const selectedAccountInfo = computed(() => findAccount(selectedAccount.value));
const activeAccountSyncProgress = computed(() => {
  const fakeid = selectedAccount.value;
  if (!fakeid) {
    return null;
  }
  return syncProgressByFakeid.value[fakeid] || null;
});
const activeAccountSyncStatus = computed(() => {
  const progress = activeAccountSyncProgress.value;
  if (!progress || !progress.running) {
    return '';
  }
  const total = progress.totalMessages > 0 ? String(progress.totalMessages) : '--';
  return `同步中 ${progress.syncedMessages}/${total} · 文章 ${progress.syncedArticles}`;
});
const headerBatchSyncProgressText = computed(() => {
  if (selectedAccount.value || selectedCategory.value !== '__all__') {
    return '';
  }
  const progress = batchSyncProgress.value;
  if (!progress.running || progress.totalAccounts <= 0) {
    return '';
  }
  return `已完成 ${progress.completedAccounts}/${progress.totalAccounts} 个公众号`;
});

const accountsInSelectedCategory = computed(() => {
  let targets: MpAccount[] = [];
  if (selectedCategory.value === '__all__') {
    targets = accounts.value;
  } else if (selectedCategory.value === FOCUS_CATEGORY_ID) {
    targets = accounts.value.filter(account => isFocusedAccount(account));
  } else {
    targets = accounts.value.filter(account => normalizeCategory(account) === selectedCategory.value);
  }

  return targets.sort((a, b) => (b.articles || 0) - (a.articles || 0));
});

const accountsInCategory = computed(() => {
  const keyword = accountKeyword.value.trim().toLowerCase();
  if (!keyword) {
    return accountsInSelectedCategory.value;
  }

  return accountsInSelectedCategory.value.filter(account => {
    const name = (account.nickname || '').toLowerCase();
    return name.includes(keyword);
  });
});

const displayedArticles = computed<ReaderArticle[]>(() => articleRows.value);

const {
  list: virtualDisplayedArticles,
  containerProps: articleContainerProps,
  wrapperProps: articleWrapperProps,
} = useVirtualList(displayedArticles, {
  itemHeight: 84,
  overscan: 10,
});

const articleListTitle = computed(() => {
  const selected = findAccount(selectedAccount.value);
  if (selected) {
    return selected.nickname || selected.fakeid;
  }
  if (selectedCategory.value === '__all__') {
    return '全部文章';
  }
  if (selectedCategory.value === FOCUS_CATEGORY_ID) {
    return `分类：${FOCUS_CATEGORY_LABEL}`;
  }
  return `分类：${selectedCategory.value}`;
});

const articleListEmptyState = computed(() => {
  if (favoriteOnly.value) {
    return {
      icon: 'i-heroicons:star',
      title: '暂无收藏文章',
      description: '点亮发布时间右侧的星标后，这里会只显示已收藏文章。',
    };
  }

  if (!selectedAccount.value && accounts.value.length === 0) {
    return {
      icon: 'i-lucide:book-marked',
      title: '还没有公众号',
      description: '先添加公众号，再同步文章列表。',
    };
  }

  return {
    icon: 'i-lucide:file-text',
    title: '暂无文章',
    description: '当前范围内还没有文章，可先执行同步。',
  };
});

const canSyncFromHeader = computed(() => {
  if (selectedAccount.value) {
    return true;
  }
  return selectedCategory.value === '__all__' && accounts.value.length > 0;
});

const syncHeaderTooltip = computed(() => {
  if (selectedAccount.value) {
    return '同步当前公众号';
  }
  if (selectedCategory.value === '__all__') {
    return '同步全部公众号';
  }
  return '请选择公众号后同步';
});

const selectedArticleDisplayTitle = computed(() => {
  if (!selectedArticle.value) return '';
  return articleDisplayTitle(selectedArticle.value);
});

const selectedArticleIndex = computed(() => {
  if (!selectedArticle.value) {
    return -1;
  }
  const currentKey = articleKey(selectedArticle.value);
  return displayedArticles.value.findIndex(article => articleKey(article) === currentKey);
});

const selectedArticleUrls = computed(() => {
  if (selectedArticleKeys.value.size === 0) {
    return [] as string[];
  }
  return displayedArticles.value
    .filter(article => selectedArticleKeys.value.has(articleKey(article)))
    .map(article => article.link);
});

const effectiveArticleUrls = computed(() => {
  if (selectedArticleUrls.value.length > 0) {
    return selectedArticleUrls.value;
  }
  return displayedArticles.value.map(article => article.link);
});

const visibleArticleKeys = computed(() => displayedArticles.value.map(article => articleKey(article)));
const allVisibleArticlesSelected = computed(() => {
  if (!selectionMode.value || visibleArticleKeys.value.length === 0) {
    return false;
  }
  return selectedArticleKeys.value.size === visibleArticleKeys.value.length;
});

const selectionBtnIcon = computed(() => {
  if (!selectionMode.value) return 'i-lucide:list-checks';
  return allVisibleArticlesSelected.value ? 'i-lucide:x' : 'i-lucide:check';
});

const selectionBtnTooltip = computed(() => {
  if (!selectionMode.value) return '开启选择';
  return allVisibleArticlesSelected.value ? '取消全选并退出选择' : '全选';
});

const mobileView = computed<'articles' | 'article'>(() => {
  if (selectedArticle.value) return 'article';
  return 'articles';
});

const mobileCanGoBack = computed(() => Boolean(selectedArticle.value || selectedAccount.value));
const mobileAccountsListRef = ref<HTMLElement | null>(null);
const mobileArticlesListRef = ref<HTMLElement | null>(null);
const mobileArticleContentRef = ref<HTMLElement | null>(null);
const mobileScrollTopVisible = ref(false);
const mobileAccountsPanelOpen = ref(false);
const isDesktopViewport = ref(false);
const mobileHistory = ref<MobileHistoryState[]>([]);
const mobileHistoryIndex = ref(-1);
const mobileHistoryApplying = ref(false);
const mobileSwipeState = reactive<MobileSwipeState>({
  context: null,
  tracking: false,
  interactive: false,
  axis: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  edge: 'none',
});

const MOBILE_SWIPE_EDGE_GUTTER = 28;
const MOBILE_SWIPE_AXIS_LOCK_THRESHOLD = 14;
const MOBILE_SWIPE_TRIGGER_THRESHOLD = 72;

const mobileHeaderTitle = computed(() => {
  if (mobileView.value === 'article') {
    return selectedArticle.value?.accountName || selectedAccountInfo.value?.nickname || '文章阅读';
  }
  if (selectedAccount.value) {
    return selectedAccountInfo.value?.nickname || '文章列表';
  }
  return '全部文章';
});

const mobileHeaderMeta = computed(() => {
  if (mobileView.value === 'article' && selectedArticle.value) {
    return formatTimeStamp(selectedArticle.value.update_time || selectedArticle.value.create_time);
  }
  if (selectedAccount.value) {
    return activeAccountSyncStatus.value || `${articleTotalCount.value} 篇文章`;
  }
  if (headerBatchSyncProgressText.value) {
    return headerBatchSyncProgressText.value;
  }
  return `${articleTotalCount.value} 篇文章 · ${accountsInCategory.value.length} 个公众号`;
});

watch(mobileView, () => {
  mobileScrollTopVisible.value = false;
});

const cookieRemainText = computed(() => {
  if (!loginAccount.value?.expires) {
    return '未登录';
  }

  const remain = new Date(loginAccount.value.expires).getTime() - nowTick.value;
  if (remain <= 0) {
    return '已过期';
  }

  const totalSeconds = Math.floor(remain / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}天 ${hours}小时`;
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟 ${seconds}秒`;
  }
  return `${seconds}秒`;
});

const cookieExpireAt = computed(() => {
  if (!loginAccount.value?.expires) {
    return '--';
  }
  return format(new Date(loginAccount.value.expires), 'yyyy-MM-dd HH:mm:ss');
});

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader({
  onContent(url: string) {
    patchArticleByUrl(url, article => {
      article.contentDownload = true;
      article._status = '正常';
      article.is_deleted = false;
    });
    updateArticleStatus(url, '正常');
    articleDeleted(url, false);
  },
  onStatusChange(url: string, status: string) {
    patchArticleByUrl(url, article => {
      article._status = status;
    });
    updateArticleStatus(url, status);
  },
  onDelete(url: string) {
    patchArticleByUrl(url, article => {
      article.is_deleted = true;
      article._status = '已删除';
    });
    updateArticleStatus(url, '已删除');
    articleDeleted(url, true);
  },
  onComment(url: string) {
    patchArticleByUrl(url, article => {
      article.commentDownload = true;
    });
  },
});

const {
  loading: exportFileLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

function patchArticleByUrl(url: string, updater: (article: ReaderArticle) => void) {
  const target = articleRows.value.find(item => item.link === url);
  if (target) {
    updater(target);
    if (selectedArticle.value && selectedArticle.value.link === url) {
      selectedArticle.value = { ...target };
    }
  }
}

function syncUnreadStateByLatest(latestArticleKeys: Set<string>, fullSnapshot = true) {
  const known = { ...knownArticleMap.value };
  const unread = { ...unreadArticleMap.value };
  let changed = false;

  const knownCount = Object.keys(known).length;
  const unreadCount = Object.keys(unread).length;

  if (knownCount === 0 && unreadCount === 0) {
    latestArticleKeys.forEach(key => {
      known[key] = true;
    });
    changed = latestArticleKeys.size > 0;
  } else {
    latestArticleKeys.forEach(key => {
      if (!known[key]) {
        known[key] = true;
        unread[key] = true;
        changed = true;
      }
    });
  }

  if (fullSnapshot) {
    Object.keys(known).forEach(key => {
      if (!latestArticleKeys.has(key)) {
        delete known[key];
        changed = true;
      }
    });

    Object.keys(unread).forEach(key => {
      if (!latestArticleKeys.has(key)) {
        delete unread[key];
        changed = true;
      }
    });
  }

  if (changed) {
    knownArticleMap.value = known;
    unreadArticleMap.value = unread;
    persistRuntimeState();
  }
}

async function loadArticlePage(reset = false) {
  if (articlePageLoading.value) {
    return;
  }

  if (reset) {
    articleRows.value = [];
    articleTotalCount.value = 0;
    articlePageOffset.value = 0;
    articlePageHasMore.value = true;
  } else if (!articlePageHasMore.value) {
    return;
  }

  const seq = ++articleLoadSeq;
  articlePageLoading.value = true;
  try {
    const query: Record<string, string | number> = {
      offset: articlePageOffset.value,
      limit: articlePageLimit,
    };
    if (selectedAccount.value) {
      query.fakeid = selectedAccount.value;
    } else if (selectedCategory.value === FOCUS_CATEGORY_ID) {
      query.focused = 1;
    } else if (selectedCategory.value !== '__all__') {
      query.category = selectedCategory.value;
    }
    if (favoriteOnly.value) {
      query.favorite = 1;
    }

    const resp = await request<{
      list: ReaderArticle[];
      total: number;
      offset: number;
      limit: number;
    }>('/api/web/reader/articles-page', { query });

    if (seq !== articleLoadSeq) {
      return;
    }

    const incoming = Array.isArray(resp.list) ? resp.list : [];
    const normalized = incoming.map(item => ({
      ...item,
      accountName: item.accountName || findAccount(item.fakeid)?.nickname || item.fakeid,
      category: item.category || normalizeCategory(findAccount(item.fakeid) || ({ category: '' } as MpAccount)),
      round_head_img: item.round_head_img || findAccount(item.fakeid)?.round_head_img || '',
      contentDownload: false,
      commentDownload: false,
    }));

    if (reset) {
      articleRows.value = normalized;
    } else {
      const next = [...articleRows.value];
      const keySet = new Set(next.map(article => articleKey(article)));
      normalized.forEach(article => {
        const key = articleKey(article);
        if (!keySet.has(key)) {
          keySet.add(key);
          next.push(article);
        }
      });
      articleRows.value = next;
    }

    articleTotalCount.value = Number(resp.total) || articleRows.value.length;
    articlePageOffset.value = articleRows.value.length;
    articlePageHasMore.value = articleRows.value.length < articleTotalCount.value && normalized.length > 0;

    const latestArticleKeys = new Set(articleRows.value.map(article => articleKey(article)));
    syncUnreadStateByLatest(latestArticleKeys, false);
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode === 401) {
      articleRows.value = [];
      articleTotalCount.value = 0;
      articlePageOffset.value = 0;
      articlePageHasMore.value = false;
      return;
    }
    throw error;
  } finally {
    if (seq === articleLoadSeq) {
      articlePageLoading.value = false;
    }
  }
}

function isArticleUnread(article: ReaderArticle) {
  return Boolean(unreadArticleMap.value[articleKey(article)]);
}

function isArticleFavorite(article: ReaderArticle) {
  return Boolean(article.favorite);
}

function markArticleAsRead(article: ReaderArticle) {
  const key = articleKey(article);
  if (!unreadArticleMap.value[key]) {
    return;
  }

  const unread = { ...unreadArticleMap.value };
  delete unread[key];
  unreadArticleMap.value = unread;
  persistRuntimeState();
}

async function syncSchedulerState(accountList: MpAccount[]) {
  try {
    await request('/api/web/scheduler/upsert', {
      method: 'POST',
      body: {
        config: {
          dailySyncEnabled: Boolean((preferences.value as unknown as Preferences).dailySyncEnabled),
          dailySyncTime: String((preferences.value as unknown as Preferences).dailySyncTime || '06:00'),
          accountSyncMinSeconds: Number((preferences.value as unknown as Preferences).accountSyncMinSeconds || 3),
          accountSyncMaxSeconds: Number((preferences.value as unknown as Preferences).accountSyncMaxSeconds || 5),
          syncDateRange: (preferences.value as unknown as Preferences).syncDateRange,
          syncDatePoint: Number((preferences.value as unknown as Preferences).syncDatePoint || 0),
        },
        accounts: accountList.map(account => ({
          fakeid: account.fakeid,
          nickname: account.nickname || '',
          round_head_img: account.round_head_img || '',
          category: account.category || '',
          focused: Boolean(account.focused),
        })),
      },
    });
  } catch {
    // Ignore when user has not logged in or auth-key is unavailable.
  }
}

async function pullSchedulerArticles(accountList: MpAccount[]) {
  if (accountList.length === 0) {
    return;
  }
  if (isSyncing.value) {
    return;
  }

  try {
    for (const account of accountList) {
      if (isSyncing.value) {
        break;
      }
      const resp = await request<{ data: SchedulerArticleMap }>('/api/web/scheduler/articles', {
        query: {
          fakeid: account.fakeid,
        },
        timeout: 20000,
      });
      const map = (resp?.data || {}) as SchedulerArticleMap;
      const entry = map[account.fakeid];
      if (!entry || !Array.isArray(entry.articles) || entry.articles.length === 0) {
        continue;
      }

      const totalCount = Number(entry.totalCount || 0);
      const source = entry.articles as any[];
      const batchSize = 30;
      for (let offset = 0; offset < source.length; offset += batchSize) {
        if (isSyncing.value) {
          return;
        }
        const chunk = source.slice(offset, offset + batchSize);
        await upsertArticlesFromRemote(account, chunk, totalCount);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch {
    // Ignore when user has not logged in or no scheduler data is available.
  }
}

async function hydrateSchedulerArticlesInBackground(accountList: MpAccount[]) {
  if (
    accountList.length === 0 ||
    schedulerHydrationDone.value ||
    schedulerHydrationStarted.value ||
    schedulerHydrationRunning.value
  ) {
    return;
  }

  // Scheduler backfill is a one-off bootstrap task and should not run on every startup.
  schedulerHydrationDone.value = true;
  schedulerHydrationStarted.value = true;
  schedulerHydrationRunning.value = true;
  try {
    await pullSchedulerArticles(accountList);

    const refreshed = await getAllInfo();
    accounts.value = refreshed;
    await loadArticlePage(true);
    clearSelectionOutOfScope();
  } catch {
    // Ignore when user has not logged in or scheduler payload is unavailable.
  } finally {
    schedulerHydrationRunning.value = false;
  }
}

function scheduleSyncSchedulerState() {
  if (schedulerSyncTimer.value) {
    window.clearTimeout(schedulerSyncTimer.value);
  }

  schedulerSyncTimer.value = window.setTimeout(() => {
    syncSchedulerState(accounts.value);
  }, 300);
}

function clearSelectionOutOfScope() {
  if (!selectionMode.value) {
    if (selectedArticleKeys.value.size > 0) {
      selectedArticleKeys.value.clear();
    }
  }

  if (selectedArticleKeys.value.size > 0) {
    const visibleKeys = new Set(visibleArticleKeys.value);
    const staleKeys: string[] = [];
    selectedArticleKeys.value.forEach(key => {
      if (!visibleKeys.has(key)) {
        staleKeys.push(key);
      }
    });
    staleKeys.forEach(key => selectedArticleKeys.value.delete(key));
  }

  if (selectedArticle.value) {
    const currentKey = articleKey(selectedArticle.value);
    const exists = displayedArticles.value.some(item => articleKey(item) === currentKey);
    if (!exists) {
      selectedArticle.value = null;
      selectedArticleHtml.value = '';
    }
  }
}

watch(displayedArticles, () => {
  clearSelectionOutOfScope();
});

watch(selectionMode, enabled => {
  if (!enabled) {
    selectedArticleKeys.value.clear();
  }
});

watch(accountsInSelectedCategory, list => {
  if (selectedAccount.value && !list.some(account => account.fakeid === selectedAccount.value)) {
    selectedAccount.value = null;
  }
});

watch(
  () => [selectedCategory.value, selectedAccount.value, Boolean(favoriteOnly.value)],
  async () => {
    await loadArticlePage(true);
    clearSelectionOutOfScope();
  }
);

watch(
  () => [
    Number((preferences.value as unknown as Preferences).accountSyncMinSeconds || 3),
    Number((preferences.value as unknown as Preferences).accountSyncMaxSeconds || 5),
    Boolean((preferences.value as unknown as Preferences).dailySyncEnabled),
    String((preferences.value as unknown as Preferences).dailySyncTime || '06:00'),
    String((preferences.value as unknown as Preferences).syncDateRange || 'all'),
    Number((preferences.value as unknown as Preferences).syncDatePoint || 0),
  ],
  () => {
    scheduleSyncSchedulerState();
  }
);

watch(
  () => Boolean(loginAccount.value),
  async loggedIn => {
    if (!loggedIn) {
      schedulerHydrationStarted.value = false;
      schedulerHydrationRunning.value = false;
      syncProgressByFakeid.value = {};
      await runtimeStateSync.hydrate();
      await favoriteOnlySync.hydrate();
      return;
    }
    await runtimeStateSync.hydrate();
    await favoriteOnlySync.hydrate();
    await refreshData();
  }
);

async function refreshData() {
  loading.value = true;
  try {
    await migrateLegacyDataIfNeeded();
    await migrateLegacyLargeCacheIfNeeded();

    const accountList = await getAllInfo();
    accounts.value = accountList;
    await loadArticlePage(true);
    clearSelectionOutOfScope();

    void syncSchedulerState(accountList);
    if (articleTotalCount.value === 0 && !schedulerHydrationDone.value) {
      void hydrateSchedulerArticlesInBackground(accountList);
    }
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode === 401) {
      modal.open(LoginModal);
    }
    const message = normalizeRuntimeErrorMessage(String(error?.message || '未知错误'));
    toast.error('加载数据失败', message);
  } finally {
    loading.value = false;
  }
}

async function migrateLegacyDataIfNeeded() {
  if (legacyMigrationDone.value) {
    return;
  }
  if (!loginAccount.value) {
    return;
  }

  try {
    const result = await migrateLegacyIndexedDbToServer();
    if (result.markDone) {
      legacyMigrationDone.value = true;
    }
    if (result.reason === 'migrated' && result.accountCount > 0) {
      toast.success('历史数据迁移完成', `已迁移 ${result.accountCount} 个公众号，${result.articleCount} 篇文章`);
    }
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode !== 401) {
      console.error('legacy data migration failed:', error);
    }
  }
}

async function migrateLegacyLargeCacheIfNeeded() {
  if (legacyLargeCacheMigrationDone.value) {
    return;
  }
  if (!loginAccount.value) {
    return;
  }

  try {
    const result = await migrateLegacyLargeCacheToServer();
    if (result.markDone) {
      legacyLargeCacheMigrationDone.value = true;
    }
    if (result.reason === 'migrated' && result.assetCount + result.commentReplyCount + result.debugCount > 0) {
      toast.success(
        '大缓存迁移完成',
        `asset ${result.assetCount} 条，comment_reply ${result.commentReplyCount} 条，debug ${result.debugCount} 条`
      );
    }
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode !== 401) {
      console.error('legacy large cache migration failed:', error);
    }
  }
}

function buildMobileHistoryState(overrides: Partial<MobileHistoryState> = {}): MobileHistoryState {
  return {
    categoryId: selectedCategory.value,
    accountId: selectedAccount.value,
    articleKey: selectedArticle.value ? articleKey(selectedArticle.value) : null,
    ...overrides,
  };
}

function sameMobileHistoryState(a: MobileHistoryState | null | undefined, b: MobileHistoryState | null | undefined) {
  if (!a || !b) {
    return false;
  }
  return a.categoryId === b.categoryId && a.accountId === b.accountId && a.articleKey === b.articleKey;
}

function resetMobileHistory(state = buildMobileHistoryState()) {
  mobileHistory.value = [state];
  mobileHistoryIndex.value = 0;
}

function ensureMobileHistorySeeded() {
  if (isDesktopViewport.value || mobileHistoryApplying.value) {
    return;
  }
  if (mobileHistoryIndex.value >= 0 && mobileHistory.value.length > 0) {
    return;
  }
  resetMobileHistory();
}

function pushMobileHistoryState(state: MobileHistoryState) {
  if (isDesktopViewport.value || mobileHistoryApplying.value) {
    return;
  }

  ensureMobileHistorySeeded();
  const current = mobileHistory.value[mobileHistoryIndex.value] || null;
  if (sameMobileHistoryState(current, state)) {
    return;
  }

  const nextHistory = mobileHistory.value.slice(0, mobileHistoryIndex.value + 1);
  nextHistory.push(state);
  mobileHistory.value = nextHistory;
  mobileHistoryIndex.value = nextHistory.length - 1;
}

function findDisplayedArticleByKey(key: string | null) {
  if (!key) {
    return null;
  }
  return displayedArticles.value.find(article => articleKey(article) === key) || null;
}

async function applyMobileHistoryState(state: MobileHistoryState) {
  mobileHistoryApplying.value = true;
  try {
    selectedCategory.value = state.categoryId;
    selectedAccount.value = state.accountId;

    if (!state.articleKey) {
      selectedArticle.value = null;
      selectedArticleHtml.value = '';
      selectedArticleKeys.value.clear();
      selectionMode.value = false;
      return true;
    }

    let target = findDisplayedArticleByKey(state.articleKey);
    if (!target) {
      await loadArticlePage(true);
      target = findDisplayedArticleByKey(state.articleKey);
    }

    if (!target) {
      selectedArticle.value = null;
      selectedArticleHtml.value = '';
      return false;
    }

    await openArticle(target, { trackHistory: false });
    return true;
  } finally {
    mobileHistoryApplying.value = false;
  }
}

async function navigateMobileHistory(delta: number) {
  if (isDesktopViewport.value) {
    return false;
  }

  const nextIndex = mobileHistoryIndex.value + delta;
  if (nextIndex < 0 || nextIndex >= mobileHistory.value.length) {
    return false;
  }

  const target = mobileHistory.value[nextIndex];
  const applied = await applyMobileHistoryState(target);
  if (applied) {
    mobileHistoryIndex.value = nextIndex;
  }
  return applied;
}

function resetMobileSwipeState() {
  mobileSwipeState.context = null;
  mobileSwipeState.tracking = false;
  mobileSwipeState.interactive = false;
  mobileSwipeState.axis = null;
  mobileSwipeState.startX = 0;
  mobileSwipeState.startY = 0;
  mobileSwipeState.lastX = 0;
  mobileSwipeState.lastY = 0;
  mobileSwipeState.edge = 'none';
}

function isMobileSwipeInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [data-swipe-ignore="true"]'
    )
  );
}

function onMobileSwipeStart(context: MobileSwipeContext, event: TouchEvent) {
  if (isDesktopViewport.value || event.touches.length !== 1) {
    resetMobileSwipeState();
    return;
  }

  const touch = event.touches[0];
  const container = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const bounds = container?.getBoundingClientRect();
  const width = bounds?.width || window.innerWidth;
  const localX = touch.clientX - (bounds?.left || 0);

  mobileSwipeState.context = context;
  mobileSwipeState.tracking = true;
  mobileSwipeState.interactive = isMobileSwipeInteractiveTarget(event.target);
  mobileSwipeState.axis = null;
  mobileSwipeState.startX = touch.clientX;
  mobileSwipeState.startY = touch.clientY;
  mobileSwipeState.lastX = touch.clientX;
  mobileSwipeState.lastY = touch.clientY;
  mobileSwipeState.edge =
    localX <= MOBILE_SWIPE_EDGE_GUTTER ? 'left' : width - localX <= MOBILE_SWIPE_EDGE_GUTTER ? 'right' : 'none';
}

function onMobileSwipeMove(context: MobileSwipeContext, event: TouchEvent) {
  if (!mobileSwipeState.tracking || mobileSwipeState.context !== context || event.touches.length !== 1) {
    return;
  }

  const touch = event.touches[0];
  mobileSwipeState.lastX = touch.clientX;
  mobileSwipeState.lastY = touch.clientY;

  if (mobileSwipeState.axis) {
    return;
  }

  const deltaX = touch.clientX - mobileSwipeState.startX;
  const deltaY = touch.clientY - mobileSwipeState.startY;
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < MOBILE_SWIPE_AXIS_LOCK_THRESHOLD) {
    return;
  }

  mobileSwipeState.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15 ? 'x' : 'y';
}

async function openAdjacentArticle(step: number) {
  const currentIndex = selectedArticleIndex.value;
  if (currentIndex < 0) {
    return false;
  }

  const target = displayedArticles.value[currentIndex + step];
  if (!target) {
    return false;
  }

  await openArticle(target);
  return true;
}

async function handleMobileSwipeGesture(context: MobileSwipeContext, deltaX: number, edge: MobileSwipeEdge) {
  if (context === 'articles') {
    if (deltaX > 0) {
      if (!mobileAccountsPanelOpen.value && (edge === 'left' || !selectedAccount.value)) {
        showMobileAccounts();
      }
      return;
    }

    if (mobileAccountsPanelOpen.value) {
      mobileAccountsPanelOpen.value = false;
      return;
    }

    if (selectedAccount.value) {
      await backFromMobileView();
    }
    return;
  }

  if (context === 'drawer') {
    if (deltaX < 0) {
      mobileAccountsPanelOpen.value = false;
    }
    return;
  }

  if (deltaX > 0) {
    if (edge === 'left') {
      if (!(await navigateMobileHistory(-1))) {
        await backFromMobileView();
      }
      return;
    }
    await openAdjacentArticle(-1);
    return;
  }

  if (edge === 'right' && (await navigateMobileHistory(1))) {
    return;
  }

  await openAdjacentArticle(1);
}

async function onMobileSwipeEnd(context: MobileSwipeContext, event: TouchEvent) {
  if (!mobileSwipeState.tracking || mobileSwipeState.context !== context) {
    return;
  }

  if (event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    mobileSwipeState.lastX = touch.clientX;
    mobileSwipeState.lastY = touch.clientY;
  }

  const deltaX = mobileSwipeState.lastX - mobileSwipeState.startX;
  const deltaY = mobileSwipeState.lastY - mobileSwipeState.startY;
  const isHorizontalSwipe =
    Math.abs(deltaX) >= MOBILE_SWIPE_TRIGGER_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

  if (!mobileSwipeState.interactive && mobileSwipeState.axis !== 'y' && isHorizontalSwipe) {
    await handleMobileSwipeGesture(context, deltaX, mobileSwipeState.edge);
  }

  resetMobileSwipeState();
}

function onMobileSwipeCancel() {
  resetMobileSwipeState();
}

async function openArticle(article: ReaderArticle, options: { trackHistory?: boolean } = {}) {
  if (options.trackHistory !== false) {
    pushMobileHistoryState(buildMobileHistoryState({ articleKey: articleKey(article) }));
  }
  selectedArticle.value = article;
  markArticleAsRead(article);
  selectedArticleHtml.value = '';
  contentLoading.value = true;

  try {
    const html = await request<string>('/api/public/v1/download', {
      query: {
        url: article.link,
        format: 'html',
      },
    });
    selectedArticleHtml.value = stripWechatHeader(html);
  } catch {
    try {
      const htmlCache = await getHtmlCache(article.link);
      if (htmlCache) {
        const rawHtml = await htmlCache.file.text();
        selectedArticleHtml.value = stripWechatHeader(normalizeHtml(rawHtml, 'html'));
      } else {
        selectedArticleHtml.value =
          '<div style="padding: 24px; color: #64748b;">内容加载失败，请先在“文章列表”的抓取菜单中下载文章内容后再阅读。</div>';
      }
    } catch {
      selectedArticleHtml.value = '<div style="padding: 24px; color: #64748b;">内容加载失败，请稍后重试。</div>';
    }
  } finally {
    contentLoading.value = false;
  }
}

async function toggleArticleFavorite(article: ReaderArticle) {
  const url = String(article.link || '');
  if (!url) {
    toast.error('操作失败', '当前文章缺少链接，无法更新收藏状态');
    return;
  }

  const nextFavorite = !Boolean(article.favorite);
  patchArticleByUrl(url, target => {
    target.favorite = nextFavorite;
  });

  try {
    await updateArticleFavorite(url, nextFavorite);
    if (favoriteOnly.value) {
      await loadArticlePage(true);
      clearSelectionOutOfScope();
    }
  } catch (error: any) {
    patchArticleByUrl(url, target => {
      target.favorite = !nextFavorite;
    });
    const message = normalizeRuntimeErrorMessage(String(error?.message || '未知错误'));
    toast.error(nextFavorite ? '收藏失败' : '取消收藏失败', message);
  }
}

function stripWechatHeader(html: string) {
  try {
    if (typeof window === 'undefined') {
      return html;
    }
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const selectors = [
      '#js_row_immersive_cover_img',
      '#js_cover',
      '.rich_media_cover',
      '#activity-name',
      '.rich_media_title',
      '.dynamic-fallback-title',
      '#meta_content',
      '.rich_media_meta_list',
      '#js_top_profile',
      '#js_profile_card',
      '#js_author_name',
      '#js_name',
      '#publish_time',
    ];

    selectors.forEach(selector => {
      doc.querySelectorAll(selector).forEach(node => node.remove());
    });

    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}

function openOriginalArticle(link: string) {
  window.open(link, '_blank');
}

function isArticleSelected(article: ReaderArticle) {
  return selectedArticleKeys.value.has(articleKey(article));
}

function toggleArticleSelection(article: ReaderArticle, checked: boolean) {
  if (!selectionMode.value) {
    return;
  }
  const key = articleKey(article);
  if (checked) {
    selectedArticleKeys.value.add(key);
  } else {
    selectedArticleKeys.value.delete(key);
  }
}

function onSelectionAction() {
  if (!selectionMode.value) {
    selectionMode.value = true;
    selectedArticleKeys.value.clear();
    return;
  }

  if (!allVisibleArticlesSelected.value) {
    selectedArticleKeys.value = new Set(visibleArticleKeys.value);
    return;
  }

  selectedArticleKeys.value.clear();
  selectionMode.value = false;
}

async function loadMoreArticles() {
  await loadArticlePage(false);
}

function onClickCategory(categoryId: string) {
  selectedCategory.value = categoryId;
  selectedAccount.value = null;
  pushMobileHistoryState({
    categoryId,
    accountId: null,
    articleKey: null,
  });
}

function onClickAccount(account: MpAccount) {
  clearAccountNewArticles(account.fakeid);
  selectedAccount.value = account.fakeid;
  selectedArticle.value = null;
  mobileAccountsPanelOpen.value = false;
  pushMobileHistoryState(buildMobileHistoryState({ accountId: account.fakeid, articleKey: null }));
}

async function backFromMobileView() {
  if (await navigateMobileHistory(-1)) {
    return;
  }
  if (selectedArticle.value) {
    selectedArticle.value = null;
    return;
  }
  if (selectedAccount.value) {
    selectedArticleKeys.value.clear();
    selectionMode.value = false;
    selectedAccount.value = null;
    return;
  }
}

function showMobileAccounts() {
  mobileAccountsPanelOpen.value = true;
}

function showMobileAggregateArticles() {
  selectedArticle.value = null;
  selectedArticleKeys.value.clear();
  selectionMode.value = false;
  selectedCategory.value = '__all__';
  selectedAccount.value = null;
  mobileAccountsPanelOpen.value = false;
  pushMobileHistoryState({
    categoryId: '__all__',
    accountId: null,
    articleKey: null,
  });
}

function onMobileReaderScroll() {
  const currentContainer =
    mobileView.value === 'articles' ? mobileArticlesListRef.value : mobileArticleContentRef.value;
  mobileScrollTopVisible.value = (currentContainer?.scrollTop || 0) > 320;
}

function scrollMobileReaderToTop() {
  const currentContainer =
    mobileView.value === 'articles' ? mobileArticlesListRef.value : mobileArticleContentRef.value;
  currentContainer?.scrollTo({ top: 0, behavior: 'smooth' });
}

function isFocusedAccount(account: MpAccount) {
  return Boolean(account.focused);
}

async function markAccountAsFocused(account: MpAccount) {
  const focused = isFocusedAccount(account);
  const nextFocused = !focused;

  try {
    await updateAccountFocused(account.fakeid, nextFocused);
    account.focused = nextFocused;
    toast.success(focused ? '已取消重点关注' : '已加入重点关注', account.nickname || account.fakeid);
  } catch (error) {
    toast.error(focused ? '取消重点关注失败' : '设置重点关注失败', (error as Error).message);
  }
}

function editSelectedAccountCategory() {
  if (!selectedAccountInfo.value) return;
  editAccountCategory(selectedAccountInfo.value);
}

function openSystemMenu(menu?: SystemMenuId) {
  if (menu) {
    systemMenuActive.value = menu;
  }
  systemMenuOpen.value = true;
}

function openLogin() {
  modal.open(LoginModal);
}

async function logoutMp() {
  logoutBtnLoading.value = true;
  try {
    const result = await request<LogoutResponse>('/api/web/mp/logout');
    if (result.statusCode === 200) {
      loginAccount.value = null;
      toast.success('已退出登录');
    }
  } catch (error) {
    toast.error('退出失败', (error as Error).message);
  } finally {
    logoutBtnLoading.value = false;
  }
}

function addAccount() {
  if (!checkLogin()) return;
  searchAccountDialogRef.value?.open();
}

async function onSelectAccount(account: AccountInfo | MpAccount) {
  addBtnLoading.value = true;
  try {
    await loadAccountArticle(
      {
        fakeid: account.fakeid,
        nickname: account.nickname,
        round_head_img: account.round_head_img,
        completed: false,
        count: 0,
        articles: 0,
        total_count: 0,
      },
      false
    );
    await refreshData();
    selectedAccount.value = account.fakeid;
    toast.success('公众号添加成功', `已成功添加公众号【${account.nickname}】并完成首页同步`);
    accountEventBus.emit('account-added', { fakeid: account.fakeid });
  } catch (error) {
    toast.error('添加公众号失败', (error as Error).message);
  } finally {
    addBtnLoading.value = false;
  }
}

function deleteCurrentAccount() {
  const fakeid = selectedAccount.value;
  if (!fakeid) return;

  const account = findAccount(fakeid);
  modal.open(ConfirmModal, {
    title: '确定删除当前公众号吗？',
    description: `将删除【${account?.nickname || fakeid}】的全部缓存数据（文章、留言和资源）。`,
    async onConfirm() {
      try {
        isDeleting.value = true;
        await deleteAccountData([fakeid]);
        accountEventBus.emit('account-removed', { fakeid });
        selectedAccount.value = null;
        selectedArticle.value = null;
        selectedArticleHtml.value = '';
      } finally {
        isDeleting.value = false;
        await refreshData();
      }
    },
  });
}

async function editAccountCategory(account: MpAccount) {
  categoryEditorAccount.value = account;
  categoryEditorValue.value = normalizeCategory(account);
  categoryEditorNewValue.value = '';
  categoryEditorOpen.value = true;
}

async function saveCategoryEditor() {
  const account = categoryEditorAccount.value;
  if (!account) return;
  const value = categoryEditorValue.value.trim();
  const category = value === '未分类' ? '' : value;
  categoryEditorSaving.value = true;
  try {
    await updateAccountCategory(account.fakeid, category);
    account.category = category;
    await refreshData();
    categoryEditorOpen.value = false;
    toast.success('分类已更新');
  } catch (error) {
    toast.error('更新分类失败', (error as Error).message);
  } finally {
    categoryEditorSaving.value = false;
  }
}

async function addCategoryForEditor() {
  const account = categoryEditorAccount.value;
  if (!account) return;

  const value = categoryEditorNewValue.value.trim();
  if (!value) {
    toast.warning('提示', '请输入分类名称');
    return;
  }

  if (value === '全部分类') {
    toast.warning('提示', '分类名称不能为“全部分类”');
    return;
  }
  if (value === FOCUS_CATEGORY_LABEL) {
    toast.warning('提示', '分类名称不能为“重点关注”');
    return;
  }

  if (editableCategoryNames.value.includes(value)) {
    categoryEditorValue.value = value;
    categoryEditorNewValue.value = '';
    toast.success('已选择已有分类');
    return;
  }

  categoryEditorAdding.value = true;
  try {
    await updateAccountCategory(account.fakeid, value);
    account.category = value;
    categoryEditorValue.value = value;
    categoryEditorNewValue.value = '';
    await refreshData();
    toast.success('分类已新增');
  } catch (error) {
    toast.error('新增分类失败', (error as Error).message);
  } finally {
    categoryEditorAdding.value = false;
  }
}

function deleteCategoryFromEditor(category: string) {
  if (category === '未分类') {
    toast.warning('提示', '未分类不能删除');
    return;
  }

  const affected = accounts.value.filter(account => normalizeCategory(account) === category);
  modal.open(ConfirmModal, {
    title: `删除分类【${category}】？`,
    description: `将把 ${affected.length} 个公众号移动到未分类。`,
    async onConfirm() {
      categoryDeleting.value = category;
      try {
        await Promise.all(affected.map(account => updateAccountCategory(account.fakeid, '')));
        affected.forEach(account => {
          account.category = '';
        });

        if (selectedCategory.value === category) {
          selectedCategory.value = '__all__';
        }
        if (categoryEditorValue.value === category) {
          categoryEditorValue.value = '未分类';
        }

        await refreshData();
        toast.success('分类已删除');
      } catch (error) {
        toast.error('删除分类失败', (error as Error).message);
      } finally {
        categoryDeleting.value = null;
      }
    },
  });
}

async function _load(account: MpAccount, begin: number, loadMore: boolean, promise: PromiseInstance) {
  if (isCanceled.value) {
    isCanceled.value = false;
    upsertSyncProgress(account.fakeid, { running: false });
    promise.reject(new Error('已取消同步'));
    return;
  }

  syncingRowId.value = account.fakeid;
  isSyncing.value = true;
  upsertSyncProgress(account.fakeid, {
    running: true,
    syncedMessages: Number(account.count) || 0,
    totalMessages: Number(account.total_count) || 0,
    syncedArticles: Number(account.articles) || 0,
  });

  const [articles, completed, totalCount, pageMessageCount, inserted] = await getArticleList(account, begin);
  const fetchedArticles = Array.isArray(articles) ? [...articles] : [];
  if (inserted > 0) {
    markAccountHasNewArticles(account.fakeid);
  }
  mergeSyncedArticlesIntoView(account, fetchedArticles);
  upsertSyncProgress(account.fakeid, {
    running: true,
    totalMessages: Number(totalCount) || Number(account.total_count) || 0,
  });

  if (isCanceled.value) {
    isCanceled.value = false;
    upsertSyncProgress(account.fakeid, { running: false });
    promise.reject(new Error('已取消同步'));
    return;
  }

  const noNewOnThisPage = Number(pageMessageCount) > 0 && inserted === 0;
  if (completed || noNewOnThisPage) {
    upsertSyncProgress(account.fakeid, {
      running: false,
      totalMessages: Number(totalCount) || Number(account.total_count) || 0,
    });
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
  upsertSyncProgress(account.fakeid, {
    running: true,
    syncedMessages: begin,
    totalMessages: Number(totalCount) || Number(account.total_count) || 0,
  });

  let cacheBoundaryCreateTime = 0;
  const lastArticle = articles.at(-1);
  if (lastArticle && account.last_update_time && lastArticle.create_time < account.last_update_time) {
    const summary = await getArticleCacheSummary(account.fakeid, lastArticle.create_time);
    if (summary.cachedRows > 0) {
      begin += summary.cachedMessageCount;
      cacheBoundaryCreateTime = summary.oldestCreateTime;
    }
  }

  const tailCreateTime =
    cacheBoundaryCreateTime > 0 ? cacheBoundaryCreateTime : Number(articles.at(-1)?.create_time) || 0;
  const syncToTimestamp = getSyncTimestamp();
  if (tailCreateTime > 0 && tailCreateTime < syncToTimestamp) {
    loadMore = false;
  }

  if (loadMore) {
    syncTimer.value = window.setTimeout(
      () => {
        if (isCanceled.value) {
          isCanceled.value = false;
          upsertSyncProgress(account.fakeid, { running: false });
          promise.reject(new Error('已取消同步'));
          return;
        }
        _load(account, begin, true, promise);
      },
      pickRandomSyncDelayMs(preferences.value as unknown as Preferences)
    );
  } else {
    upsertSyncProgress(account.fakeid, {
      running: false,
      totalMessages: Number(totalCount) || Number(account.total_count) || 0,
    });
    syncingRowId.value = null;
    isSyncing.value = false;
    promise.resolve(account);
  }
}

async function loadAccountArticle(account: MpAccount, loadMore = true) {
  return new Promise((resolve, reject) => {
    const promise: PromiseInstance = { resolve, reject };
    _load(account, 0, loadMore, promise).catch(e => {
      syncingRowId.value = null;
      isSyncing.value = false;
      upsertSyncProgress(account.fakeid, { running: false });
      if (e.message === 'session expired') {
        modal.open(LoginModal);
      }
      reject(e);
    });
  });
}

function applyRemoteBatchSyncSnapshot(snapshot: RemoteBatchSyncJobSnapshot | null) {
  if (!snapshot) {
    return;
  }

  if (snapshot.currentAccount) {
    const account = snapshot.currentAccount;
    const previousSyncedArticles =
      Number(
        syncProgressByFakeid.value[account.fakeid]?.syncedArticles ?? findAccount(account.fakeid)?.articles ?? 0
      ) || 0;
    if ((Number(account.syncedArticles) || 0) > previousSyncedArticles) {
      markAccountHasNewArticles(account.fakeid);
    }
    syncProgressByFakeid.value = {
      ...syncProgressByFakeid.value,
      [account.fakeid]: {
        fakeid: account.fakeid,
        running: account.status === 'running',
        syncedMessages: Number(account.syncedMessages) || 0,
        totalMessages: Number(account.totalMessages) || 0,
        syncedArticles: Number(account.syncedArticles) || 0,
        updatedAt: Number(account.updatedAt) || Date.now(),
      },
    };
  }
  batchSyncProgress.value = {
    running: snapshot.status === 'running',
    completedAccounts: Number(snapshot.completedAccounts) || 0,
    totalAccounts: Number(snapshot.totalAccounts) || 0,
  };
  syncingRowId.value = snapshot.status === 'running' ? snapshot.currentFakeid || null : null;
  isSyncing.value = snapshot.status === 'running';
}

async function startRemoteBatchSync(targets: MpAccount[]): Promise<RemoteBatchSyncJobSnapshot> {
  const resp = await request<{ data: RemoteBatchSyncJobSnapshot }>('/api/web/reader/batch-sync-start', {
    method: 'POST',
    body: {
      fakeids: targets.map(account => account.fakeid),
      syncTimestamp: getSyncTimestamp(),
      accountSyncMinSeconds: Number((preferences.value as unknown as Preferences).accountSyncMinSeconds || 3),
      accountSyncMaxSeconds: Number((preferences.value as unknown as Preferences).accountSyncMaxSeconds || 5),
    },
  });
  return resp.data;
}

async function getRemoteBatchSyncStatus(): Promise<RemoteBatchSyncJobSnapshot | null> {
  const resp = await request<{ data: RemoteBatchSyncJobSnapshot | null }>('/api/web/reader/batch-sync-status');
  return resp.data || null;
}

async function cancelRemoteBatchSync(): Promise<void> {
  await request('/api/web/reader/batch-sync-cancel', {
    method: 'POST',
  });
}

async function syncCurrentAccount() {
  if (!checkLogin()) return;
  if (!selectedAccount.value) return;

  const account = findAccount(selectedAccount.value);
  if (!account) return;

  try {
    isCanceled.value = false;
    await loadAccountArticle(account, true);
    toast.success('同步完成', `公众号【${account.nickname || account.fakeid}】文章已同步`);
  } catch (error) {
    toast.error('同步失败', (error as Error).message);
  } finally {
    await refreshAccountSnapshot(account.fakeid, false);
    await loadArticlePage(true);
    clearSelectionOutOfScope();
  }
}

async function syncAllAccountsInCurrentScope() {
  if (!checkLogin()) return;
  if (selectedCategory.value !== '__all__') return;

  const targets = [...accounts.value];
  if (targets.length === 0) {
    toast.warning('提示', '当前没有可同步公众号');
    return;
  }

  batchSyncProgress.value = {
    running: true,
    completedAccounts: 0,
    totalAccounts: targets.length,
  };
  isCanceled.value = false;
  isSyncing.value = true;
  let finalSnapshot: RemoteBatchSyncJobSnapshot | null = null;

  try {
    let snapshot = await startRemoteBatchSync(targets);
    applyRemoteBatchSyncSnapshot(snapshot);

    for (;;) {
      if (snapshot.status !== 'running') {
        break;
      }

      if (isCanceled.value) {
        isCanceled.value = false;
        await cancelRemoteBatchSync();
      }

      await new Promise(resolve => setTimeout(resolve, Math.max(1000, Number(snapshot.pollAfterMs) || 3000)));
      snapshot = (await getRemoteBatchSyncStatus()) as RemoteBatchSyncJobSnapshot;
      if (!snapshot) {
        throw new Error('batch sync status missing');
      }
      applyRemoteBatchSyncSnapshot(snapshot);
    }
    finalSnapshot = snapshot;

    if (snapshot.status === 'success') {
      toast.success('同步完成', `已同步 ${snapshot.successCount} 个公众号`);
    } else if (snapshot.status === 'canceled') {
      toast.warning('同步已取消', `已完成 ${snapshot.completedAccounts}/${snapshot.totalAccounts} 个公众号`);
    } else if (snapshot.successCount === 0) {
      const firstMessage = normalizeRuntimeErrorMessage(String(snapshot.message || '未知错误'));
      if (firstMessage === 'session expired') {
        toast.error('同步失败', '登录状态已失效，请重新登录后重试');
      } else {
        toast.error('同步失败', firstMessage);
      }
    } else {
      toast.warning('部分同步失败', `成功 ${snapshot.successCount} 个，失败 ${snapshot.failedCount} 个`);
    }
  } finally {
    batchSyncProgress.value = {
      ...batchSyncProgress.value,
      running: false,
    };
    isSyncing.value = false;
    syncingRowId.value = null;
    const shouldDeferRefresh = Number(finalSnapshot?.heapUsedMb || 0) >= 2500;
    if (shouldDeferRefresh) {
      toast.warning('已完成同步', '后台已写入缓存。当前服务端内存较高，先跳过自动刷新，稍后再手动刷新列表。');
    } else {
      const refreshed = await getAllInfo();
      accounts.value = refreshed;
      await loadArticlePage(true);
      clearSelectionOutOfScope();
    }
  }
}

async function onHeaderSyncClick() {
  if (selectedAccount.value) {
    await syncCurrentAccount();
    return;
  }
  if (selectedCategory.value === '__all__') {
    await syncAllAccountsInCurrentScope();
  }
}

function importAccount() {
  fileRef.value?.click();
}

async function handleFileChange(evt: Event) {
  const files = (evt.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  const file = files[0];
  try {
    importBtnLoading.value = true;
    const jsonData = JSON.parse(await file.text());
    if (jsonData.usefor !== 'wechat-article-exporter') {
      toast.error('导入公众号失败', '导入文件格式不正确，请选择本站导出的文件。');
      return;
    }

    const infos = jsonData.accounts;
    if (!infos || infos.length <= 0) {
      toast.error('导入公众号失败', '导入文件格式不正确，请选择本站导出的文件。');
      return;
    }

    await importMpAccounts(infos);
    await refreshData();
    toast.success('批量导入成功', `已导入 ${infos.length} 个公众号`);
  } catch (error) {
    toast.error('导入公众号失败', (error as Error).message);
  } finally {
    importBtnLoading.value = false;
    (evt.target as HTMLInputElement).value = '';
  }
}

function exportAccount() {
  const rows = [...accountsInCategory.value];
  if (rows.length === 0) {
    toast.warning('提示', '当前没有可导出的公众号');
    return;
  }

  exportBtnLoading.value = true;
  try {
    const data: AccountManifest = {
      version: '1.0',
      usefor: 'wechat-article-exporter',
      accounts: rows,
    };
    exportAccountJsonFile(data, '公众号');
    toast.success('批量导出成功', `已导出 ${rows.length} 个公众号`);
  } finally {
    exportBtnLoading.value = false;
  }
}

function downloadArticles(type: 'html' | 'metadata' | 'comment') {
  download(type, effectiveArticleUrls.value);
}

function exportArticles(type: 'excel' | 'json' | 'html' | 'text' | 'markdown' | 'word') {
  exportFile(type, effectiveArticleUrls.value);
}

let cookieTimer: number | null = null;
function updateDesktopViewport() {
  isDesktopViewport.value = window.innerWidth >= 768;
}

watch(isDesktopViewport, desktop => {
  if (!desktop) {
    resetMobileHistory();
  }
});

onMounted(async () => {
  updateDesktopViewport();
  await runtimeStateSync.hydrate();
  await favoriteOnlySync.hydrate();
  initializeRuntimeState();
  await refreshData();
  resetMobileHistory();
  cookieTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
  window.addEventListener('resize', updateDesktopViewport);
});

onUnmounted(() => {
  if (cookieTimer) {
    window.clearInterval(cookieTimer);
    cookieTimer = null;
  }
  if (schedulerSyncTimer.value) {
    window.clearTimeout(schedulerSyncTimer.value);
    schedulerSyncTimer.value = null;
  }
  window.removeEventListener('resize', updateDesktopViewport);
});
</script>

<template>
  <div class="h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
    <div class="flex h-full flex-col md:hidden">
      <header class="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/92 px-4 pb-3 pt-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/92">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex flex-1 items-start gap-3">
            <UButton
              v-if="mobileCanGoBack"
              size="2xs"
              color="gray"
              variant="ghost"
              icon="i-lucide:chevron-left"
              class="icon-btn mt-0.5"
              @click="backFromMobileView"
            />
            <UButton
              v-else
              size="2xs"
              color="gray"
              variant="ghost"
              icon="i-lucide:menu"
              class="icon-btn mt-0.5"
              @click="showMobileAccounts"
            />
            <div class="min-w-0 flex-1">
              <div v-if="mobileView === 'articles' && selectedAccountInfo" class="flex items-center gap-2">
                <h1 class="truncate text-base font-semibold">{{ mobileHeaderTitle }}</h1>
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:pencil"
                  :disabled="!selectedAccountInfo"
                  class="icon-btn shrink-0"
                  @click="editSelectedAccountCategory"
                />
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:minus"
                  :disabled="!selectedAccount"
                  :loading="isDeleting"
                  class="icon-btn shrink-0"
                  @click="deleteCurrentAccount"
                />
              </div>
              <h1 v-else class="truncate text-base font-semibold">{{ mobileHeaderTitle }}</h1>
              <p class="mt-1 truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                <template v-if="mobileView === 'articles' && selectedAccountInfo">
                  {{ articleTotalCount }} 篇文章
                  <span v-if="activeAccountSyncStatus"> · {{ activeAccountSyncStatus }}</span>
                </template>
                <template v-else>
                  {{ mobileHeaderMeta }}
                </template>
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <UTooltip v-if="mobileView !== 'article'" :text="favoriteOnly ? '取消只看收藏' : '只看收藏'">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                :icon="favoriteOnly ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                class="icon-btn mobile-favorite-toggle"
                :class="favoriteOnly ? 'is-active' : ''"
                @click="favoriteOnly = !favoriteOnly"
              />
            </UTooltip>
            <UTooltip v-if="mobileView !== 'article'" :text="syncHeaderTooltip">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-heroicons:arrow-path-rounded-square-20-solid"
                :disabled="!canSyncFromHeader"
                :loading="isSyncing"
                class="icon-btn"
                @click="onHeaderSyncClick"
              />
            </UTooltip>
            <UTooltip v-else text="查看原文">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:external-link"
                class="icon-btn"
                :disabled="!selectedArticle"
                @click="selectedArticle && openOriginalArticle(selectedArticle.link)"
              />
            </UTooltip>
            <UTooltip v-if="mobileView !== 'article'" text="系统菜单">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:layout-grid"
                class="icon-btn"
                @click="openSystemMenu()"
              />
            </UTooltip>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-hidden">
        <div v-if="mobileView === 'articles'" class="flex h-full flex-col">
          <div v-if="loading" class="px-3 py-3">
            <LoadingCards />
          </div>
          <div
            v-else
            ref="mobileArticlesListRef"
            class="mobile-touch-surface flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3"
            @scroll.passive="onMobileReaderScroll"
            @touchstart.passive="onMobileSwipeStart('articles', $event)"
            @touchmove.passive="onMobileSwipeMove('articles', $event)"
            @touchend="onMobileSwipeEnd('articles', $event)"
            @touchcancel="onMobileSwipeCancel"
          >
            <ul v-if="displayedArticles.length > 0" class="space-y-3">
              <li
                v-for="article in displayedArticles"
                :key="articleKey(article)"
                class="rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition-colors dark:border-slate-800 dark:bg-slate-900"
              >
                <div class="flex items-start gap-3">
                  <input
                    v-if="selectionMode"
                    type="checkbox"
                    class="mt-1"
                    :checked="isArticleSelected(article)"
                    @click.stop
                    @change="toggleArticleSelection(article, ($event.target as HTMLInputElement).checked)"
                  />
                  <div class="min-w-0 flex-1 cursor-pointer" @click="openArticle(article)">
                    <p class="line-clamp-2 text-sm font-medium">{{ articleDisplayTitle(article) }}</p>
                    <div class="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span class="min-w-0 flex items-center gap-2 truncate">
                        <span class="article-account-avatar">
                          <img
                            v-if="article.round_head_img"
                            :src="IMAGE_PROXY + article.round_head_img"
                            alt=""
                            class="size-full object-cover"
                          />
                          <UIcon v-else name="i-lucide:user-round" class="size-3.5 text-slate-400" />
                        </span>
                        <span class="truncate">{{ article.accountName }}</span>
                      </span>
                      <span class="inline-flex shrink-0 items-center gap-1.5">
                        <span v-if="isArticleUnread(article)" class="unread-dot" />
                        <span>{{ formatTimeStamp(article.update_time || article.create_time) }}</span>
                        <UButton
                          size="2xs"
                          color="gray"
                          variant="ghost"
                          :icon="isArticleFavorite(article) ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                          class="icon-btn article-star-btn"
                          :class="isArticleFavorite(article) ? 'is-active' : ''"
                          @click.stop="toggleArticleFavorite(article)"
                        />
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="py-8">
              <EmptyStatePanel
                :icon="articleListEmptyState.icon"
                :title="articleListEmptyState.title"
                :description="articleListEmptyState.description"
              />
            </div>

            <div v-if="articlePageHasMore || articlePageLoading" class="px-1 py-3">
              <UButton
                size="sm"
                color="gray"
                variant="soft"
                block
                :loading="articlePageLoading"
                :disabled="!articlePageHasMore"
                @click="loadMoreArticles"
              >
                {{ articlePageHasMore ? '加载更多文章' : '已全部加载' }}
              </UButton>
            </div>
          </div>
        </div>

        <div v-else class="flex h-full flex-col">
          <div v-if="contentLoading">
            <EmptyStatePanel
              icon="i-lucide-loader-circle"
              title="内容加载中"
              description="正在准备文章内容，请稍候。"
            />
          </div>
          <div
            v-else
            ref="mobileArticleContentRef"
            class="mobile-touch-surface flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4"
            @scroll.passive="onMobileReaderScroll"
            @touchstart.passive="onMobileSwipeStart('article', $event)"
            @touchmove.passive="onMobileSwipeMove('article', $event)"
            @touchend="onMobileSwipeEnd('article', $event)"
            @touchcancel="onMobileSwipeCancel"
          >
            <div class="mb-5 border-b border-slate-200/80 pb-4 dark:border-slate-800/80">
              <h2 class="text-[22px] font-bold leading-tight text-slate-900 dark:text-slate-50">
                {{ selectedArticleDisplayTitle }}
              </h2>
              <p class="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                {{ selectedArticle?.author_name || selectedArticle?.accountName }}
                <span class="mx-1">·</span>
                {{ selectedArticle && formatTimeStamp(selectedArticle.update_time || selectedArticle.create_time) }}
              </p>
            </div>
            <IframeHtmlRenderer :html="selectedArticleHtml" />
          </div>
        </div>
      </div>

      <Transition name="mobile-drawer-fade">
        <div
          v-if="mobileAccountsPanelOpen"
          class="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
          @click.self="mobileAccountsPanelOpen = false"
        >
          <Transition name="mobile-drawer-slide">
            <aside
              v-if="mobileAccountsPanelOpen"
              class="mobile-accounts-drawer mobile-touch-surface flex h-full w-[min(23rem,88vw)] flex-col border-r border-slate-200 bg-slate-50 shadow-[18px_0_48px_rgba(15,23,42,0.16)] dark:border-slate-800 dark:bg-slate-950"
              @touchstart.passive="onMobileSwipeStart('drawer', $event)"
              @touchmove.passive="onMobileSwipeMove('drawer', $event)"
              @touchend="onMobileSwipeEnd('drawer', $event)"
              @touchcancel="onMobileSwipeCancel"
            >
              <div class="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div class="flex items-start justify-between gap-3">
                  <div v-if="loginAccount" class="min-w-0 flex flex-1 items-center gap-3">
                    <div class="size-10 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <img
                        v-if="loginAccount.avatar"
                        :src="IMAGE_PROXY + loginAccount.avatar"
                        alt=""
                        class="size-full object-cover"
                      />
                      <UIcon v-else name="i-lucide:user-round" class="size-full p-2 text-slate-500" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="min-w-0 flex-1 truncate text-sm font-semibold">
                          {{ loginAccount.nickname || '已登录账号' }}
                        </p>
                        <UButton
                          size="2xs"
                          color="rose"
                          variant="soft"
                          icon="i-lucide:log-out"
                          :loading="logoutBtnLoading"
                          class="shrink-0"
                          @click="logoutMp"
                        >
                          登出
                        </UButton>
                      </div>
                      <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">剩余时间 {{ cookieRemainText }}</p>
                    </div>
                  </div>
                  <div v-else class="min-w-0 flex-1">
                    <UButton
                      size="sm"
                      color="gray"
                      variant="soft"
                      icon="i-lucide:log-in"
                      @click="openLogin"
                    >
                      登录公众号
                    </UButton>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <UButton
                      size="2xs"
                      color="gray"
                      variant="ghost"
                      icon="i-lucide:x"
                      class="icon-btn"
                      @click="mobileAccountsPanelOpen = false"
                    />
                  </div>
                </div>

                <div class="mt-3 flex items-center gap-2">
                  <UInput v-model="accountKeyword" class="flex-1" size="sm" icon="i-lucide:search" placeholder="搜索公众号名称" />
                  <UButton size="sm" color="gray" variant="soft" icon="i-lucide:plus" :loading="addBtnLoading" @click="addAccount">
                    添加
                  </UButton>
                </div>

                <div class="mt-2 flex max-h-[112px] flex-wrap gap-1 overflow-y-auto">
                  <button
                    v-for="category in categories"
                    :key="category.id"
                    type="button"
                    class="rounded-full border px-2.5 py-1 text-xs transition-colors"
                    :class="
                      selectedCategory === category.id
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-slate-300 text-slate-600 hover:border-slate-500 dark:border-slate-700 dark:text-slate-300'
                    "
                    @click="onClickCategory(category.id)"
                  >
                    {{ category.label }} · {{ category.count }}
                  </button>
                </div>
              </div>

              <div ref="mobileAccountsListRef" class="flex-1 overflow-y-auto px-3 py-3">
                <ul class="space-y-3">
                  <li
                    v-for="account in accountsInCategory"
                    :key="account.fakeid"
                    class="rounded-[22px] border px-4 py-3 transition-colors"
                    :class="
                      selectedAccount === account.fakeid
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900'
                    "
                  >
                    <div class="flex items-start gap-3">
                      <button type="button" class="min-w-0 flex flex-1 items-start gap-3 text-left" @click="onClickAccount(account)">
                        <div class="size-11 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <img
                            v-if="account.round_head_img"
                            :src="IMAGE_PROXY + account.round_head_img"
                            alt=""
                            class="size-full object-cover"
                          />
                          <UIcon v-else name="i-lucide:user-round" class="size-full p-2 text-slate-500" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 min-w-0">
                            <p class="truncate text-sm font-semibold">{{ account.nickname || account.fakeid }}</p>
                            <span
                              v-if="hasAccountNewArticles(account)"
                              class="account-new-dot shrink-0"
                              title="有新文章"
                              aria-label="有新文章"
                            />
                          </div>
                          <p
                            class="mt-1 text-xs"
                            :class="selectedAccount === account.fakeid ? 'text-slate-200 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'"
                          >
                            {{ normalizeCategory(account) }}
                            <span v-if="isFocusedAccount(account)"> · 重点关注</span>
                            <span> · {{ account.articles || 0 }} 篇</span>
                          </p>
                        </div>
                      </button>
                      <UButton
                        size="2xs"
                        color="gray"
                        variant="ghost"
                        :icon="isFocusedAccount(account) ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                        class="icon-btn account-star-btn mt-0.5"
                        :class="isFocusedAccount(account) ? 'is-active' : ''"
                        @click.stop="markAccountAsFocused(account)"
                      />
                    </div>
                  </li>
                </ul>
              </div>
            </aside>
          </Transition>
        </div>
      </Transition>

      <ScrollTopFab :visible="mobileScrollTopVisible" @click="scrollMobileReaderToTop" />
    </div>

    <div class="hidden h-full md:flex overflow-hidden">
    <aside class="w-[320px] flex-shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col">
      <header class="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UTooltip text="系统菜单">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:layout-grid"
                class="icon-btn"
                @click="openSystemMenu()"
              />
            </UTooltip>
          </div>

          <div class="flex items-center justify-end gap-2">
            <UPopover v-if="loginAccount" :popper="{ placement: 'bottom-end' }">
              <span class="cookie-inline-text">剩余时间 {{ cookieRemainText }}</span>
              <button type="button" class="avatar-btn">
                <img
                  v-if="loginAccount.avatar"
                  :src="IMAGE_PROXY + loginAccount.avatar"
                  alt=""
                  class="size-7 rounded-full object-cover"
                />
                <UIcon v-else name="i-lucide:user-round" class="size-4 text-slate-500" />
              </button>
              <template #panel>
                <div class="p-3 w-[240px] space-y-2">
                  <p class="text-sm font-semibold truncate">{{ loginAccount.nickname || '已登录账号' }}</p>
                  <p class="text-xs text-slate-500">Cookie 剩余：{{ cookieRemainText }}</p>
                  <p class="text-xs text-slate-500">到期时间：{{ cookieExpireAt }}</p>
                  <UButton
                    size="xs"
                    color="rose"
                    variant="soft"
                    icon="i-lucide:log-out"
                    :loading="logoutBtnLoading"
                    @click="logoutMp"
                  >
                    退出登录
                  </UButton>
                </div>
              </template>
            </UPopover>
            <UTooltip v-else text="登录公众号">
              <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:log-in" class="icon-btn" @click="openLogin" />
            </UTooltip>
          </div>
        </div>

        <UInput v-model="accountKeyword" size="sm" icon="i-lucide:search" placeholder="仅搜索公众号名称" />

        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UTooltip text="添加公众号">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:plus"
                :loading="addBtnLoading"
                class="icon-btn"
                @click="addAccount"
              />
            </UTooltip>

            <UTooltip text="删除当前公众号">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:minus"
                :disabled="!selectedAccount"
                :loading="isDeleting"
                class="icon-btn"
                @click="deleteCurrentAccount"
              />
            </UTooltip>
          </div>

          <div class="flex items-center gap-2">
            <UTooltip text="批量导入公众号">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:arrow-down-to-line"
                :loading="importBtnLoading"
                class="icon-btn"
                @click="importAccount"
              >
                <input ref="fileRef" type="file" accept=".json" class="hidden" @change="handleFileChange" />
              </UButton>
            </UTooltip>
            <UTooltip text="批量导出公众号">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:arrow-up-from-line"
                :loading="exportBtnLoading"
                class="icon-btn"
                @click="exportAccount"
              />
            </UTooltip>
          </div>
        </div>

        <div class="flex flex-wrap gap-1 max-h-[108px] overflow-y-auto">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="px-2.5 py-1 rounded-full text-xs border transition-colors"
            :class="
              selectedCategory === category.id
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'border-slate-300 text-slate-600 hover:border-slate-500 dark:border-slate-700 dark:text-slate-300'
            "
            @click="onClickCategory(category.id)"
          >
            {{ category.label }} · {{ category.count }}
          </button>
        </div>

      </header>

      <ul class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
        <li
          v-for="account in accountsInCategory"
          :key="account.fakeid"
          class="px-3 py-2.5 transition-colors cursor-pointer"
          :class="
            selectedAccount === account.fakeid
              ? 'bg-slate-100 dark:bg-slate-800'
              : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
          "
          @click="onClickAccount(account)"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <div class="size-9 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 shrink-0">
                <img
                  v-if="account.round_head_img"
                  :src="IMAGE_PROXY + account.round_head_img"
                  alt=""
                  class="size-full object-cover"
                />
                <UIcon v-else name="i-lucide:user-round" class="size-full p-2 text-slate-500" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <p class="text-sm font-semibold truncate">{{ account.nickname || account.fakeid }}</p>
                  <span
                    v-if="hasAccountNewArticles(account)"
                    class="account-new-dot shrink-0"
                    title="有新文章"
                    aria-label="有新文章"
                  />
                </div>
                <p class="text-xs text-slate-500 mt-1">
                  {{ normalizeCategory(account) }}
                  <span v-if="isFocusedAccount(account)"> · 重点关注</span>
                  <span> · {{ account.articles || 0 }} 篇</span>
                </p>
              </div>
            </div>
            <UTooltip :text="isFocusedAccount(account) ? '取消重点关注' : '设为重点关注'">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                :icon="isFocusedAccount(account) ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                class="icon-btn account-star-btn"
                :class="isFocusedAccount(account) ? 'is-active' : ''"
                @click.stop="markAccountAsFocused(account)"
              />
            </UTooltip>
          </div>
        </li>
      </ul>
    </aside>

    <section class="w-[430px] flex-shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col">
      <header class="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="font-semibold truncate">{{ articleListTitle }}</h2>
            <span class="text-xs text-slate-500 shrink-0">{{ articleTotalCount }} 篇</span>
            <span v-if="activeAccountSyncStatus" class="text-xs text-emerald-600 shrink-0">
              {{ activeAccountSyncStatus }}
            </span>
            <UTooltip text="编辑当前公众号分类">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-lucide:square-pen"
                :disabled="!selectedAccountInfo"
                class="icon-btn"
                @click="editSelectedAccountCategory"
              />
            </UTooltip>
          </div>

          <div class="flex items-center gap-2">
            <span v-if="headerBatchSyncProgressText" class="text-xs text-slate-500 shrink-0">
              {{ headerBatchSyncProgressText }}
            </span>
            <UTooltip :text="syncHeaderTooltip">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                icon="i-heroicons:arrow-path-rounded-square-20-solid"
                :disabled="!canSyncFromHeader"
                :loading="isSyncing"
                class="icon-btn"
                @click="onHeaderSyncClick"
              />
            </UTooltip>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-2 items-center">
            <UTooltip :text="selectionBtnTooltip">
              <UButton
                size="2xs"
                color="gray"
                variant="ghost"
                :icon="selectionBtnIcon"
                class="icon-btn"
                @click="onSelectionAction"
              />
            </UTooltip>

            <UTooltip v-if="downloadBtnLoading" text="停止抓取">
              <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:square" class="icon-btn" @click="stopDownload" />
            </UTooltip>

            <UTooltip text="抓取文章数据">
              <ButtonGroup
                :items="[
                  { label: '文章内容', event: 'download-html' },
                  { label: '阅读量(需登录)', event: 'download-metadata' },
                  { label: '留言(需登录)', event: 'download-comment' },
                ]"
                @download-html="downloadArticles('html')"
                @download-metadata="downloadArticles('metadata')"
                @download-comment="downloadArticles('comment')"
              >
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:download"
                  :loading="downloadBtnLoading"
                  class="icon-btn"
                />
              </ButtonGroup>
            </UTooltip>

            <span class="text-[11px] text-slate-500 self-center">
              <template v-if="downloadBtnLoading">抓取 {{ downloadCompletedCount }}/{{ downloadTotalCount }}</template>
              <template v-if="exportFileLoading">
                <template v-if="downloadBtnLoading"> · </template>
                {{ exportPhase }} {{ exportCompletedCount }}/{{ exportTotalCount }}
              </template>
            </span>
          </div>

          <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div class="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/70">
              <UCheckbox v-model="favoriteOnly" name="desktop-favorite-only" label="只看收藏" />
            </div>
            <UTooltip text="导出文章">
              <ButtonGroup
                :items="[
                  { label: 'Excel', event: 'export-excel' },
                  { label: 'JSON', event: 'export-json' },
                  { label: 'HTML', event: 'export-html' },
                  { label: 'Txt', event: 'export-text' },
                  { label: 'Markdown', event: 'export-markdown' },
                  { label: 'Word', event: 'export-word' },
                ]"
                @export-excel="exportArticles('excel')"
                @export-json="exportArticles('json')"
                @export-html="exportArticles('html')"
                @export-text="exportArticles('text')"
                @export-markdown="exportArticles('markdown')"
                @export-word="exportArticles('word')"
              >
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:file-output"
                  :loading="exportFileLoading"
                  class="icon-btn"
                />
              </ButtonGroup>
            </UTooltip>
          </div>
        </div>
      </header>

      <div v-if="loading" class="px-3 py-3">
        <LoadingCards />
      </div>

      <div v-else-if="displayedArticles.length === 0" class="flex-1">
        <EmptyStatePanel
          :icon="articleListEmptyState.icon"
          :title="articleListEmptyState.title"
          :description="articleListEmptyState.description"
        />
      </div>

      <div v-else v-bind="articleContainerProps" class="flex-1 h-0 overflow-y-auto">
      <ul v-bind="articleWrapperProps" class="divide-y divide-slate-100 dark:divide-slate-800">
        <li
          v-for="row in virtualDisplayedArticles"
          :key="articleKey(row.data)"
          class="px-3 py-2.5 transition-colors cursor-pointer"
          :class="
            selectedArticle && articleKey(selectedArticle) === articleKey(row.data)
              ? 'bg-slate-100 dark:bg-slate-800'
              : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
          "
          @click="openArticle(row.data)"
        >
          <div class="flex items-start" :class="selectionMode ? 'gap-2' : ''">
            <input
              v-if="selectionMode"
              type="checkbox"
              class="mt-1"
              :checked="isArticleSelected(row.data)"
              @click.stop
              @change="toggleArticleSelection(row.data, ($event.target as HTMLInputElement).checked)"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium line-clamp-2">{{ articleDisplayTitle(row.data) }}</p>
              <div class="mt-1 text-xs text-slate-500 flex items-center justify-between gap-2">
                <span class="truncate">{{ row.data.accountName }}</span>
                <span class="shrink-0 inline-flex items-center gap-1.5">
                  <span v-if="isArticleUnread(row.data)" class="unread-dot" />
                  <span>{{ formatTimeStamp(row.data.update_time || row.data.create_time) }}</span>
                  <UTooltip :text="isArticleFavorite(row.data) ? '取消收藏' : '收藏文章'">
                    <UButton
                      size="2xs"
                      color="gray"
                      variant="ghost"
                      :icon="isArticleFavorite(row.data) ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                      class="icon-btn article-star-btn"
                      :class="isArticleFavorite(row.data) ? 'is-active' : ''"
                      @click.stop="toggleArticleFavorite(row.data)"
                    />
                  </UTooltip>
                </span>
              </div>
            </div>
          </div>
        </li>
      </ul>
      </div>
      <div v-if="!loading && (articlePageHasMore || articlePageLoading)" class="px-3 py-2 border-t border-slate-200 dark:border-slate-800">
        <UButton
          size="2xs"
          color="gray"
          variant="ghost"
          block
          :loading="articlePageLoading"
          :disabled="!articlePageHasMore"
          @click="loadMoreArticles"
        >
          {{ articlePageHasMore ? '加载更多文章' : '已全部加载' }}
        </UButton>
      </div>
    </section>

    <main class="flex-1 overflow-hidden flex flex-col">
      <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <template v-if="selectedArticle">
          <h1 class="text-[30px] leading-tight font-bold">{{ selectedArticleDisplayTitle }}</h1>
          <div class="mt-2 text-sm text-slate-500 flex items-center gap-4">
            <span>{{ selectedArticle.author_name || selectedArticle.accountName }}</span>
            <span>{{ formatTimeStamp(selectedArticle.update_time || selectedArticle.create_time) }}</span>
            <button type="button" class="text-blue-500 hover:text-blue-600" @click="openOriginalArticle(selectedArticle.link)">
              查看原文
            </button>
          </div>
        </template>
        <template v-else>
          <p class="text-slate-500">选择文章后在这里阅读内容</p>
        </template>
      </div>

      <div v-if="!selectedArticle">
        <EmptyStatePanel
          icon="i-lucide-file-text"
          title="请选择一篇文章"
          description="选择文章后，就可以在这里阅读正文内容。"
        />
      </div>
      <div v-else-if="contentLoading">
        <EmptyStatePanel
          icon="i-lucide-loader-circle"
          title="内容加载中"
          description="正在准备文章内容，请稍候。"
        />
      </div>
      <div v-else class="flex-1 overflow-y-auto p-4">
        <IframeHtmlRenderer :html="selectedArticleHtml" />
      </div>
    </main>
    </div>

    <GlobalSearchAccountDialog ref="searchAccountDialogRef" @select:account="onSelectAccount" />

    <UModal v-model="categoryEditorOpen" :ui="{ width: 'sm:max-w-[720px]' }">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">编辑分类</h3>
            <UButton
              size="2xs"
              color="gray"
              variant="ghost"
              icon="i-lucide:x"
              class="icon-btn"
              @click="categoryEditorOpen = false"
            />
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-sm text-slate-500 truncate">
            当前公众号：{{ categoryEditorAccount?.nickname || categoryEditorAccount?.fakeid || '-' }}
          </p>

          <div class="space-y-2">
            <p class="text-sm font-medium">已有分类</p>
            <div class="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto">
              <button
                type="button"
                class="px-2.5 py-1 rounded-full text-xs border transition-colors"
                :class="
                  categoryEditorValue === '未分类'
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'border-slate-300 text-slate-600 hover:border-slate-500 dark:border-slate-700 dark:text-slate-300'
                "
                @click="categoryEditorValue = '未分类'"
              >
                未分类
              </button>
              <button
                v-for="name in editableCategoryNames.filter(item => item !== '未分类')"
                :key="name"
                type="button"
                class="px-2.5 py-1 rounded-full text-xs border transition-colors"
                :class="
                  categoryEditorValue === name
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'border-slate-300 text-slate-600 hover:border-slate-500 dark:border-slate-700 dark:text-slate-300'
                "
                @click="categoryEditorValue = name"
              >
                {{ name }}
              </button>
              <span v-if="editableCategoryNames.length === 0" class="text-xs text-slate-400">暂无可选分类</span>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-sm font-medium">新增分类</p>
            <div class="flex items-center gap-2">
              <UInput
                v-model="categoryEditorNewValue"
                size="sm"
                placeholder="输入分类名称后新增"
                class="flex-1"
                @keyup.enter="addCategoryForEditor"
              />
              <UButton
                size="xs"
                color="gray"
                variant="soft"
                icon="i-lucide:plus"
                :loading="categoryEditorAdding"
                @click="addCategoryForEditor"
              >
                新增
              </UButton>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-sm font-medium">删除分类</p>
            <div class="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto">
              <UButton
                v-for="name in editableCategoryNames.filter(item => item !== '未分类')"
                :key="`delete-${name}`"
                size="2xs"
                color="rose"
                variant="soft"
                icon="i-lucide:trash-2"
                :loading="categoryDeleting === name"
                @click="deleteCategoryFromEditor(name)"
              >
                {{ name }}
              </UButton>
              <span
                v-if="editableCategoryNames.filter(item => item !== '未分类').length === 0"
                class="text-xs text-slate-400"
              >
                暂无可删除分类
              </span>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <UButton size="xs" color="gray" variant="ghost" @click="categoryEditorOpen = false">取消</UButton>
            <UButton size="xs" color="primary" :loading="categoryEditorSaving" @click="saveCategoryEditor">保存</UButton>
          </div>
        </div>
      </UCard>
    </UModal>

    <Transition name="mobile-menu-fade">
      <div
        v-if="systemMenuOpen && !isDesktopViewport"
        class="fixed inset-0 z-50 bg-slate-950/42 backdrop-blur-[10px] md:hidden"
        @click.self="systemMenuOpen = false"
      >
        <Transition name="mobile-menu-drop">
          <section
            v-if="systemMenuOpen && !isDesktopViewport"
            class="fixed inset-x-3 top-[68px] max-h-[calc(100vh-84px)] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-950"
          >
            <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-4 pb-4 pt-4 dark:border-slate-800">
              <div class="min-w-0">
                <p class="text-base font-semibold">系统菜单</p>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">抓取及下载文章及更多高级选项请到桌面网页端。</p>
              </div>
              <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:x" class="icon-btn" @click="systemMenuOpen = false" />
            </div>

            <div class="max-h-[calc(100vh-176px)] overflow-y-auto px-4 py-4">
              <div class="space-y-5">
                <section class="space-y-3">
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="item in systemMenuItems"
                      :key="item.id"
                      type="button"
                      class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors"
                      :class="
                        systemMenuActive === item.id
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      "
                      @click="openSystemMenu(item.id)"
                    >
                      <UIcon :name="item.icon" class="size-4 shrink-0" />
                      <span>{{ item.label }}</span>
                    </button>
                  </div>
                </section>

                <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                  <div id="title" class="hidden" />
                  <KeepAlive>
                    <component :is="activeSystemMenuComponent" class="min-h-full bg-white dark:bg-slate-950" />
                  </KeepAlive>
                </section>
              </div>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>

    <UModal v-if="isDesktopViewport" v-model="systemMenuOpen" :ui="{ width: 'sm:max-w-[1120px]' }">
      <UCard :ui="{ body: { padding: 'p-0 sm:p-0' } }">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">系统菜单</h3>
            <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:x" class="icon-btn" @click="systemMenuOpen = false" />
          </div>
        </template>

        <div class="h-[72vh] min-h-[520px] flex">
          <aside class="w-48 border-r border-slate-200 dark:border-slate-800 p-2 bg-slate-50/70 dark:bg-slate-900/70">
            <button
              v-for="item in systemMenuItems"
              :key="item.id"
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left"
              :class="
                systemMenuActive === item.id
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              "
              @click="openSystemMenu(item.id)"
            >
              <UIcon :name="item.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ item.label }}</span>
            </button>
          </aside>

          <section class="flex-1 bg-white dark:bg-slate-950">
            <div id="title" class="hidden" />
            <KeepAlive>
              <component :is="activeSystemMenuComponent" class="h-full" />
            </KeepAlive>
          </section>
        </div>
      </UCard>
    </UModal>
  </div>
</template>

<style scoped>
.icon-btn {
  @apply !inline-flex size-7 !p-0 !gap-0 items-center justify-center leading-none rounded-full border border-slate-200 dark:border-slate-700
    bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300
    hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-900
    hover:border-slate-300 dark:hover:border-slate-500 transition-colors;
}

.icon-btn :deep(.iconify),
.icon-btn :deep([class*='i-']) {
  margin: 0 !important;
  width: 14px !important;
  height: 14px !important;
  font-size: 14px !important;
}

.icon-btn :deep(.i-lucide\:plus),
.icon-btn :deep(.i-lucide\:minus),
.icon-btn :deep(.i-lucide\:pencil) {
  transform: translateY(-0.5px);
}

.avatar-btn {
  @apply size-8 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700
    bg-white dark:bg-slate-900 flex items-center justify-center hover:ring-2 hover:ring-blue-400/40 transition;
}

.cookie-inline-text {
  @apply inline-flex h-8 items-center text-[11px] text-slate-500 whitespace-nowrap;
}

.account-star-btn {
  @apply size-6;
}

.account-star-btn.is-active {
  @apply text-amber-500 hover:text-amber-500 border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10;
}

.article-star-btn {
  @apply size-6 shrink-0;
}

.article-star-btn.is-active {
  @apply text-amber-500 hover:text-amber-500 border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10;
}

.mobile-favorite-toggle.is-active {
  @apply text-amber-500 hover:text-amber-500 border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10;
}

.article-account-avatar {
  @apply inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800;
}

.account-new-dot {
  @apply relative inline-block size-2.5 rounded-full border border-white/90 bg-rose-500 dark:border-slate-900;
  box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.42);
  animation: account-new-dot-pulse 1.6s ease-out infinite;
}

.unread-dot {
  @apply inline-block size-2 rounded-full bg-red-500;
}

@keyframes account-new-dot-pulse {
  0% {
    transform: scale(0.92);
    opacity: 0.92;
    box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.46);
  }

  55% {
    transform: scale(1);
    opacity: 1;
    box-shadow: 0 0 0 8px rgba(244, 63, 94, 0);
  }

  100% {
    transform: scale(0.92);
    opacity: 0.92;
    box-shadow: 0 0 0 0 rgba(244, 63, 94, 0);
  }
}

.mobile-accounts-drawer {
  max-width: 23rem;
}

.mobile-touch-surface {
  touch-action: pan-y pinch-zoom;
  overscroll-behavior-x: contain;
}

.mobile-drawer-fade-enter-active,
.mobile-drawer-fade-leave-active {
  transition: opacity 180ms ease;
}

.mobile-drawer-fade-enter-from,
.mobile-drawer-fade-leave-to {
  opacity: 0;
}

.mobile-drawer-slide-enter-active,
.mobile-drawer-slide-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.mobile-drawer-slide-enter-from,
.mobile-drawer-slide-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

.mobile-menu-fade-enter-active,
.mobile-menu-fade-leave-active {
  transition: opacity 180ms ease;
}

.mobile-menu-fade-enter-from,
.mobile-menu-fade-leave-to {
  opacity: 0;
}

.mobile-menu-drop-enter-active,
.mobile-menu-drop-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.mobile-menu-drop-enter-from,
.mobile-menu-drop-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
