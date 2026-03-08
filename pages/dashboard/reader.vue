<script setup lang="ts">
import { format } from 'date-fns';
import { AnimatePresence, animate, motion, transformValue, type PanInfo, useDragControls, useMotionValue, useReducedMotion } from 'motion-v';
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

interface MobileArticlesLayerSnapshot {
  categoryId: string;
  accountId: string | null;
  favoriteOnly: boolean;
  title: string;
  meta: string;
  articles: ReaderArticle[];
  totalCount: number;
  pageOffset: number;
  pageHasMore: boolean;
  emptyState: {
    icon: string;
    title: string;
    description: string;
  };
  scrollTop: number;
}

type MobileSwipeContext = 'articles' | 'article' | 'drawer';
type MobileSwipeEdge = 'left' | 'right' | 'none';

interface MobileDragSession {
  context: MobileSwipeContext | null;
  interactive: boolean;
  startX: number;
  edge: MobileSwipeEdge;
  width: number;
  pointX: number;
  pointY: number;
}

type MobileInteractiveSwipeContext = Extract<MobileSwipeContext, 'articles' | 'article'>;

interface MobileSwipeResolvedAction {
  kind: 'transition' | 'rebound' | 'noop';
  revealPreviousLayer?: boolean;
  execute: () => Promise<void>;
}

interface MobileHeaderLayerState {
  kind: 'articles' | 'article';
  title: string;
  meta: string;
  accountId: string | null;
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
const mobileAccountsListRef = ref<any>(null);
const mobileArticlesListRef = ref<any>(null);
const mobileArticleContentRef = ref<any>(null);
const mobileScrollTopVisible = ref(false);
const mobileAccountsPanelOpen = ref(false);
const isDesktopViewport = ref(false);
const mobileHistory = ref<MobileHistoryState[]>([]);
const mobileHistoryIndex = ref(-1);
const mobileHistoryApplying = ref(false);
const mobileArticlesUnderlayActive = ref(false);
const mobileArticlesUnderlaySnapshot = ref<MobileArticlesLayerSnapshot | null>(null);
const mobilePendingArticlesRestore = ref<MobileArticlesLayerSnapshot | null>(null);
const mobileArticleUnderlayActive = ref(false);
const mobileDragSession = reactive<MobileDragSession>({
  context: null,
  interactive: false,
  startX: 0,
  edge: 'none',
  width: 0,
  pointX: 0,
  pointY: 0,
});
const mobileArticlesDragControls = useDragControls();
const mobileArticleDragControls = useDragControls();
const prefersReducedMotion = useReducedMotion();
const mobileArticlesSwipeX = useMotionValue(0);
const mobileArticleSwipeX = useMotionValue(0);
const mobileArticleFavoriteHovering = ref(false);

const MOBILE_SWIPE_EDGE_GUTTER = 28;
const MOBILE_SWIPE_TRIGGER_THRESHOLD = 48;
const MOBILE_SWIPE_VELOCITY_THRESHOLD = 280;
const MOBILE_SWIPE_REENTRY_OFFSET_RATIO = 0.12;
const MOBILE_SWIPE_REENTRY_MAX_OFFSET = 44;
const MOBILE_ARTICLES_UNDERLAY_BASE_X = -16;
const MOBILE_ARTICLES_UNDERLAY_BASE_SCALE = 0.988;
const MOBILE_ARTICLES_UNDERLAY_BASE_OPACITY = 0.94;
const MOBILE_ARTICLES_UNDERLAY_SCRIM_OPACITY = 0.08;
const MOBILE_ARTICLE_UNDERLAY_BASE_X = -18;
const MOBILE_ARTICLE_UNDERLAY_BASE_SCALE = 0.986;
const MOBILE_ARTICLE_UNDERLAY_BASE_OPACITY = 0.92;
const MOBILE_ARTICLE_UNDERLAY_SCRIM_OPACITY = 0.14;
const MOBILE_ARTICLE_FAVORITE_CORNER_SIZE = 116;
const MOBILE_ARTICLE_FAVORITE_CORNER_REVEAL_OFFSET = 72;
const MOBILE_ARTICLE_FAVORITE_TRIGGER_PROGRESS = 0.15;
const MOBILE_ARTICLE_EDGE_SENSOR_WIDTH = 32;
const MOBILE_UNDERLAY_ITEM_ESTIMATED_HEIGHT = 96;
const MOBILE_UNDERLAY_WINDOW_SIZE = 22;
const MOBILE_UNDERLAY_WINDOW_BUFFER = 6;

function getMobileViewportWidth() {
  if (typeof window === 'undefined') {
    return 390;
  }
  return Math.max(window.innerWidth || 390, 1);
}

function getMobileViewportHeight() {
  if (typeof window === 'undefined') {
    return 844;
  }
  return Math.max(window.innerHeight || 844, 1);
}

function getMobileArticleSwipeProgress() {
  return Math.max(0, Math.min(1, mobileArticleSwipeX.get() / getMobileViewportWidth()));
}

const mobileArticlesUnderlayX = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticlesSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLES_UNDERLAY_BASE_X + progress * Math.abs(MOBILE_ARTICLES_UNDERLAY_BASE_X);
});

const mobileArticlesUnderlayScale = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticlesSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLES_UNDERLAY_BASE_SCALE + progress * (1 - MOBILE_ARTICLES_UNDERLAY_BASE_SCALE);
});

const mobileArticlesUnderlayOpacity = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticlesSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLES_UNDERLAY_BASE_OPACITY + progress * (1 - MOBILE_ARTICLES_UNDERLAY_BASE_OPACITY);
});

const mobileArticlesUnderlayScrimOpacity = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticlesSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLES_UNDERLAY_SCRIM_OPACITY * (1 - progress);
});

const mobileArticleUnderlayX = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticleSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLE_UNDERLAY_BASE_X + progress * Math.abs(MOBILE_ARTICLE_UNDERLAY_BASE_X);
});

const mobileArticleUnderlayScale = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticleSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLE_UNDERLAY_BASE_SCALE + progress * (1 - MOBILE_ARTICLE_UNDERLAY_BASE_SCALE);
});

const mobileArticleUnderlayOpacity = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticleSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLE_UNDERLAY_BASE_OPACITY + progress * (1 - MOBILE_ARTICLE_UNDERLAY_BASE_OPACITY);
});

const mobileArticleUnderlayScrimOpacity = transformValue(() => {
  const progress = Math.max(0, Math.min(1, mobileArticleSwipeX.get() / getMobileViewportWidth()));
  return MOBILE_ARTICLE_UNDERLAY_SCRIM_OPACITY * (1 - progress);
});

const mobileArticleFavoriteCornerX = transformValue(() => {
  const progress = getMobileArticleSwipeProgress();
  return -mobileArticleSwipeX.get() + (1 - progress) * MOBILE_ARTICLE_FAVORITE_CORNER_REVEAL_OFFSET;
});

const mobileArticleFavoriteCornerOpacity = transformValue(() => {
  const progress = getMobileArticleSwipeProgress();
  return Math.max(0, Math.min(1, (progress - 0.03) / 0.18));
});

const mobileArticleFavoriteCornerScale = transformValue(() => {
  const progress = getMobileArticleSwipeProgress();
  return 0.94 + Math.max(0, Math.min(1, progress / 0.22)) * 0.06;
});

const mobilePanelSpring = computed(() =>
  prefersReducedMotion.value ? { duration: 0.12 } : { type: 'spring' as const, stiffness: 520, damping: 40, mass: 0.68 }
);

const mobilePageTransition = computed(() =>
  prefersReducedMotion.value ? { duration: 0.1 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
);

const mobileSwipeElastic = computed(() =>
  prefersReducedMotion.value ? { left: 1, right: 1 } : { left: 0.92, right: 0.92 }
);

const mobileDrawerElastic = computed(() =>
  prefersReducedMotion.value ? { left: 1, right: 0.04 } : { left: 0.98, right: 0.08 }
);

const mobileSwipeSnapTransition = computed(() =>
  prefersReducedMotion.value
    ? { bounceStiffness: 1200, bounceDamping: 96 }
    : { bounceStiffness: 980, bounceDamping: 64 }
);

const mobileDrawerSnapTransition = computed(() =>
  prefersReducedMotion.value
    ? { bounceStiffness: 960, bounceDamping: 76 }
    : { bounceStiffness: 760, bounceDamping: 46 }
);

const mobileSwipeCommitTransition = computed(() =>
  prefersReducedMotion.value ? { duration: 0.1 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }
);

const mobileSwipeReboundTransition = computed(() =>
  prefersReducedMotion.value ? { duration: 0.1 } : { duration: 0.12, ease: [0.22, 1, 0.36, 1] as const }
);

const mobileSwipeReentryTransition = computed(() =>
  prefersReducedMotion.value ? { duration: 0.09 } : { duration: 0.14, ease: [0.16, 1, 0.3, 1] as const }
);

const mobileArticlesHeaderState = computed<MobileHeaderLayerState>(() => {
  const baseMeta = selectedAccount.value
    ? `${articleTotalCount.value} 篇文章`
    : `${articleTotalCount.value} 篇文章 · ${accountsInCategory.value.length} 个公众号`;
  const dynamicMeta = selectedAccount.value ? activeAccountSyncStatus.value : headerBatchSyncProgressText.value;

  return {
    kind: 'articles',
    title: articleListTitle.value,
    meta: dynamicMeta ? `${baseMeta} · ${dynamicMeta}` : baseMeta,
    accountId: selectedAccount.value,
  };
});

const mobileCurrentHeaderState = computed<MobileHeaderLayerState>(() => {
  if (mobileView.value === 'article' && selectedArticle.value) {
    const author = selectedArticle.value.author_name || selectedArticle.value.accountName || '未知发布者';
    const publishTime = formatTimeStamp(selectedArticle.value.update_time || selectedArticle.value.create_time);
    return {
      kind: 'article',
      title: selectedArticleDisplayTitle.value || '文章阅读',
      meta: `${author} · ${publishTime}`,
      accountId: null,
    };
  }
  return mobileArticlesHeaderState.value;
});

const mobileHeaderUnderlayState = computed<MobileHeaderLayerState | null>(() => {
  if (mobileView.value === 'article' && mobileArticleUnderlayActive.value) {
    return mobileArticlesHeaderState.value;
  }

  if (mobileView.value === 'articles' && mobileArticlesUnderlayActive.value && mobileArticlesUnderlaySnapshot.value) {
    return {
      kind: 'articles',
      title: mobileArticlesUnderlaySnapshot.value.title,
      meta: mobileArticlesUnderlaySnapshot.value.meta,
      accountId: mobileArticlesUnderlaySnapshot.value.accountId,
    };
  }

  return null;
});

const mobileCurrentHeaderX = transformValue(() =>
  mobileView.value === 'article' ? mobileArticleSwipeX.get() : mobileArticlesSwipeX.get()
);

const mobileHeaderUnderlayStyle = computed(() =>
  mobileView.value === 'article'
    ? { x: mobileArticleUnderlayX, scale: mobileArticleUnderlayScale, opacity: mobileArticleUnderlayOpacity }
    : { x: mobileArticlesUnderlayX, scale: mobileArticlesUnderlayScale, opacity: mobileArticlesUnderlayOpacity }
);

const mobileArticlesUnderlayWindow = computed(() => {
  const snapshot = mobileArticlesUnderlaySnapshot.value;
  if (!snapshot) {
    return {
      items: [] as ReaderArticle[],
      translateY: 0,
    };
  }

  const start = Math.max(
    0,
    Math.floor(snapshot.scrollTop / MOBILE_UNDERLAY_ITEM_ESTIMATED_HEIGHT) - MOBILE_UNDERLAY_WINDOW_BUFFER
  );
  const end = Math.min(snapshot.articles.length, start + MOBILE_UNDERLAY_WINDOW_SIZE);

  return {
    items: snapshot.articles.slice(start, end),
    translateY: start * MOBILE_UNDERLAY_ITEM_ESTIMATED_HEIGHT - snapshot.scrollTop,
  };
});

watch(mobileView, () => {
  mobileScrollTopVisible.value = false;
  if (mobileView.value !== 'article') {
    mobileArticleSwipeX.set(0);
    mobileArticleUnderlayActive.value = false;
  }
  if (mobileView.value !== 'articles') {
    mobileArticlesSwipeX.set(0);
    mobileArticlesUnderlayActive.value = false;
  }
});

function buildMobileArticlesLayerSnapshot(): MobileArticlesLayerSnapshot {
  return {
    categoryId: selectedCategory.value,
    accountId: selectedAccount.value,
    favoriteOnly: Boolean(favoriteOnly.value),
    title: mobileArticlesHeaderState.value.title,
    meta: mobileArticlesHeaderState.value.meta,
    articles: displayedArticles.value.slice(),
    totalCount: articleTotalCount.value,
    pageOffset: articlePageOffset.value,
    pageHasMore: articlePageHasMore.value,
    emptyState: { ...articleListEmptyState.value },
    scrollTop: resolveScrollableElement(mobileArticlesListRef.value)?.scrollTop || 0,
  };
}

function rememberMobileArticlesUnderlaySnapshot() {
  if (isDesktopViewport.value || mobileView.value !== 'articles') {
    return;
  }

  mobileArticlesUnderlaySnapshot.value = buildMobileArticlesLayerSnapshot();
}

function matchesMobileArticlesSnapshot(
  snapshot: MobileArticlesLayerSnapshot | null,
  state: Pick<MobileHistoryState, 'categoryId' | 'accountId'>
) {
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.categoryId === state.categoryId &&
    snapshot.accountId === state.accountId &&
    snapshot.favoriteOnly === Boolean(favoriteOnly.value)
  );
}

function restoreMobileArticlesLayerSnapshot(snapshot: MobileArticlesLayerSnapshot) {
  articleRows.value = snapshot.articles.slice();
  articleTotalCount.value = snapshot.totalCount;
  articlePageOffset.value = snapshot.pageOffset;
  articlePageHasMore.value = snapshot.pageHasMore;
}

function restoreMobileArticlesScrollTop(scrollTop: number) {
  requestAnimationFrame(() => {
    const container = resolveScrollableElement(mobileArticlesListRef.value);
    if (!container) {
      return;
    }

    container.scrollTop = scrollTop;
    onMobileReaderScroll();
  });
}

function setMobileUnderlayActive(context: MobileInteractiveSwipeContext, active: boolean) {
  if (context === 'article') {
    mobileArticleUnderlayActive.value = active;
    return;
  }

  mobileArticlesUnderlayActive.value = active && Boolean(mobileArticlesUnderlaySnapshot.value);
}

function clearMobileUnderlay(context?: MobileInteractiveSwipeContext) {
  if (!context || context === 'article') {
    mobileArticleUnderlayActive.value = false;
  }
  if (!context || context === 'articles') {
    mobileArticlesUnderlayActive.value = false;
  }
}

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
    if (
      matchesMobileArticlesSnapshot(mobilePendingArticlesRestore.value, {
        categoryId: selectedCategory.value,
        accountId: selectedAccount.value,
      })
    ) {
      mobilePendingArticlesRestore.value = null;
      clearSelectionOutOfScope();
      return;
    }

    mobilePendingArticlesRestore.value = null;
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
      const snapshot = mobileArticlesUnderlaySnapshot.value;
      if (matchesMobileArticlesSnapshot(snapshot, state) && snapshot) {
        mobilePendingArticlesRestore.value = snapshot;
        restoreMobileArticlesLayerSnapshot(snapshot);
        restoreMobileArticlesScrollTop(snapshot.scrollTop);
      }
      return true;
    }

    mobilePendingArticlesRestore.value = null;
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

function resetMobileDragSession() {
  mobileDragSession.context = null;
  mobileDragSession.interactive = false;
  mobileDragSession.startX = 0;
  mobileDragSession.edge = 'none';
  mobileDragSession.width = 0;
  mobileDragSession.pointX = 0;
  mobileDragSession.pointY = 0;
  mobileArticleFavoriteHovering.value = false;
}

function rememberMobileDragSession(context: MobileSwipeContext, event: PointerEvent) {
  const container = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const bounds = container?.getBoundingClientRect();
  const width = bounds?.width || window.innerWidth;
  const localX = event.clientX - (bounds?.left || 0);

  mobileDragSession.context = context;
  mobileDragSession.interactive = isMobileSwipeInteractiveTarget(event.target);
  mobileDragSession.startX = event.clientX;
  mobileDragSession.width = width;
  mobileDragSession.pointX = event.clientX;
  mobileDragSession.pointY = event.clientY;
  mobileDragSession.edge =
    localX <= MOBILE_SWIPE_EDGE_GUTTER ? 'left' : width - localX <= MOBILE_SWIPE_EDGE_GUTTER ? 'right' : 'none';

  if (context === 'article') {
    setMobileUnderlayActive(context, !mobileDragSession.interactive && mobileDragSession.edge === 'left');
    return;
  }

  if (context === 'articles') {
    setMobileUnderlayActive(
      context,
      !mobileDragSession.interactive &&
        mobileDragSession.edge === 'left' &&
        Boolean(selectedAccount.value) &&
        Boolean(mobileArticlesUnderlaySnapshot.value)
    );
  }
}

function beginMobileDrag(context: MobileSwipeContext, event: PointerEvent) {
  if (isDesktopViewport.value) {
    return;
  }

  rememberMobileDragSession(context, event);

  if (mobileDragSession.interactive) {
    return;
  }

  if (context === 'articles') {
    if (mobileDragSession.edge !== 'left' || !canNavigateMobileHistory(-1)) {
      return;
    }
    mobileArticlesDragControls.start(event);
    return;
  }

  if (context === 'article') {
    if (mobileDragSession.edge !== 'left') {
      return;
    }
    mobileArticleDragControls.start(event);
  }
}

function getMobileArticleFavoriteZoneRect() {
  const width = getMobileViewportWidth();
  const height = getMobileViewportHeight();
  const progress = getMobileArticleSwipeProgress();
  const revealOffset = (1 - progress) * MOBILE_ARTICLE_FAVORITE_CORNER_REVEAL_OFFSET;

  return {
    left: width - MOBILE_ARTICLE_FAVORITE_CORNER_SIZE + revealOffset,
    top: height - MOBILE_ARTICLE_FAVORITE_CORNER_SIZE,
    right: width,
    bottom: height,
  };
}

function canTriggerMobileArticleFavorite(pointX: number, pointY: number) {
  if (!selectedArticle.value || isArticleFavorite(selectedArticle.value)) {
    return false;
  }

  if (mobileDragSession.edge !== 'left' || mobileDragSession.interactive) {
    return false;
  }

  if (getMobileArticleSwipeProgress() < MOBILE_ARTICLE_FAVORITE_TRIGGER_PROGRESS) {
    return false;
  }

  const zone = getMobileArticleFavoriteZoneRect();
  return pointX >= zone.left && pointX <= zone.right && pointY >= zone.top && pointY <= zone.bottom;
}

function onArticleDrag(_event: PointerEvent, info: PanInfo) {
  mobileDragSession.pointX = info.point.x;
  mobileDragSession.pointY = info.point.y;
  mobileArticleFavoriteHovering.value = canTriggerMobileArticleFavorite(info.point.x, info.point.y);
}

async function commitMobileArticleFavoriteFromSwipe(width: number) {
  const article = selectedArticle.value;
  if (!article || isArticleFavorite(article)) {
    return false;
  }

  setMobileUnderlayActive('article', true);
  await animateMobileSwipeValue('article', getMobileSwipeCommitTarget(width || getMobileViewportWidth(), 1), mobileSwipeCommitTransition.value);
  await toggleArticleFavorite(article);

  if (canNavigateMobileHistory(-1)) {
    await navigateMobileHistory(-1);
  } else {
    await backFromMobileView();
  }

  clearMobileUnderlay('article');
  mobileArticleSwipeX.set(0);
  return true;
}

function getMobileSwipeValue(context: MobileInteractiveSwipeContext) {
  return context === 'articles' ? mobileArticlesSwipeX : mobileArticleSwipeX;
}

function getMobileSwipeCommitTarget(width: number, direction: number) {
  const baseWidth = width || window.innerWidth || 360;
  return direction >= 0 ? baseWidth : -baseWidth;
}

function getMobileSwipeReentryOffset(width: number, direction: number) {
  const baseWidth = width || window.innerWidth || 360;
  const reentry = Math.min(baseWidth * MOBILE_SWIPE_REENTRY_OFFSET_RATIO, MOBILE_SWIPE_REENTRY_MAX_OFFSET);
  return direction >= 0 ? -reentry : reentry;
}

async function animateMobileSwipeValue(
  context: MobileInteractiveSwipeContext,
  target: number,
  transition: Record<string, any>
) {
  const motionValue = getMobileSwipeValue(context);
  if (prefersReducedMotion.value) {
    motionValue.set(target);
    return;
  }
  await animate(motionValue, target, transition);
}

function canNavigateMobileHistory(delta: number) {
  const nextIndex = mobileHistoryIndex.value + delta;
  return nextIndex >= 0 && nextIndex < mobileHistory.value.length;
}

function resolveMobileSwipeAction(
  context: MobileInteractiveSwipeContext,
  deltaX: number,
  edge: MobileSwipeEdge
): MobileSwipeResolvedAction {
  if (context === 'articles') {
    if (deltaX > 0) {
      if (selectedAccount.value && edge === 'left') {
        if (canNavigateMobileHistory(-1)) {
          return {
            kind: 'transition',
            revealPreviousLayer: true,
            execute: async () => void (await navigateMobileHistory(-1)),
          };
        }
        return {
          kind: 'transition',
          revealPreviousLayer: true,
          execute: () => backFromMobileView(),
        };
      }
      if (edge === 'left' && !mobileAccountsPanelOpen.value) {
        return {
          kind: 'rebound',
          execute: async () => {
            showMobileAccounts();
          },
        };
      }
      return { kind: 'noop', execute: async () => {} };
    }

    if (mobileAccountsPanelOpen.value) {
      return {
        kind: 'rebound',
        execute: async () => {
          mobileAccountsPanelOpen.value = false;
        },
      };
    }

    return { kind: 'noop', execute: async () => {} };
  }

  if (deltaX > 0) {
    if (edge === 'left') {
      if (canNavigateMobileHistory(-1)) {
        return {
          kind: 'transition',
          revealPreviousLayer: true,
          execute: async () => void (await navigateMobileHistory(-1)),
        };
      }
      return {
        kind: 'transition',
        revealPreviousLayer: true,
        execute: () => backFromMobileView(),
      };
    }

    return { kind: 'noop', execute: async () => {} };
  }

  if (edge === 'right' && canNavigateMobileHistory(1)) {
    return { kind: 'transition', execute: async () => void (await navigateMobileHistory(1)) };
  }

  return { kind: 'noop', execute: async () => {} };
}

function shouldCommitSwipe(offsetX: number, velocityX: number) {
  return Math.abs(offsetX) >= MOBILE_SWIPE_TRIGGER_THRESHOLD || Math.abs(velocityX) >= MOBILE_SWIPE_VELOCITY_THRESHOLD;
}

async function performMobileInteractiveSwipe(
  context: MobileInteractiveSwipeContext,
  offsetX: number,
  edge: MobileSwipeEdge,
  interactive: boolean,
  committed: boolean,
  width: number
) {
  const motionValue = getMobileSwipeValue(context);
  const currentOffset = motionValue.get();
  const effectiveOffset = currentOffset || offsetX;

  if (interactive || !committed) {
    await animateMobileSwipeValue(context, 0, mobileSwipeReboundTransition.value);
    clearMobileUnderlay(context);
    return;
  }

  const action = resolveMobileSwipeAction(context, effectiveOffset, edge);
  if (action.kind === 'noop') {
    clearMobileUnderlay(context);
    await animateMobileSwipeValue(context, 0, mobileSwipeReboundTransition.value);
    return;
  }

  if (action.kind === 'rebound') {
    clearMobileUnderlay(context);
    await animateMobileSwipeValue(context, 0, mobileSwipeReboundTransition.value);
    await action.execute();
    return;
  }

  setMobileUnderlayActive(context, Boolean(action.revealPreviousLayer));
  const direction = effectiveOffset >= 0 ? 1 : -1;
  await animateMobileSwipeValue(context, getMobileSwipeCommitTarget(width, direction), mobileSwipeCommitTransition.value);
  await action.execute();

  if (context === 'articles' && action.revealPreviousLayer) {
    clearMobileUnderlay(context);
    motionValue.set(0);
    return;
  }

  const contextStillActive =
    (context === 'articles' && mobileView.value === 'articles') || (context === 'article' && mobileView.value === 'article');

  if (!contextStillActive) {
    clearMobileUnderlay(context);
    motionValue.set(0);
    return;
  }

  clearMobileUnderlay(context);
  motionValue.set(getMobileSwipeReentryOffset(width, direction));
  await animateMobileSwipeValue(context, 0, mobileSwipeReentryTransition.value);
}

async function onArticlesDragEnd(_event: PointerEvent, info: PanInfo) {
  const context = mobileDragSession.context;
  const edge = mobileDragSession.edge;
  const interactive = mobileDragSession.interactive;
  const width = mobileDragSession.width;
  const committed = shouldCommitSwipe(info.offset.x, info.velocity.x);
  resetMobileDragSession();

  if (context !== 'articles') {
    return;
  }

  await performMobileInteractiveSwipe('articles', info.offset.x || info.velocity.x, edge, interactive, committed, width);
}

async function onArticleDragEnd(_event: PointerEvent, info: PanInfo) {
  const context = mobileDragSession.context;
  const edge = mobileDragSession.edge;
  const interactive = mobileDragSession.interactive;
  const width = mobileDragSession.width;
  const committed = shouldCommitSwipe(info.offset.x, info.velocity.x);
  const favoriteTriggered = canTriggerMobileArticleFavorite(info.point.x, info.point.y);
  resetMobileDragSession();

  if (context !== 'article') {
    return;
  }

  if (favoriteTriggered) {
    await commitMobileArticleFavoriteFromSwipe(width);
    return;
  }

  await performMobileInteractiveSwipe('article', info.offset.x || info.velocity.x, edge, interactive, committed, width);
}

async function onDrawerDragEnd(_event: PointerEvent, info: PanInfo) {
  const context = mobileDragSession.context;
  const interactive = mobileDragSession.interactive;
  resetMobileDragSession();

  if (interactive || context !== 'drawer' || !shouldCommitSwipe(info.offset.x, info.velocity.x)) {
    return;
  }

  if ((info.offset.x || info.velocity.x) < 0) {
    mobileAccountsPanelOpen.value = false;
  }
}

async function openArticle(article: ReaderArticle, options: { trackHistory?: boolean } = {}) {
  clearMobileUnderlay();
  mobileArticleSwipeX.set(0);
  mobileArticlesSwipeX.set(0);
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
  rememberMobileArticlesUnderlaySnapshot();
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

function resolveScrollableElement(target: any): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }
  const maybeElement = target?.$el;
  return maybeElement instanceof HTMLElement ? maybeElement : null;
}

function onMobileReaderScroll(event?: Event) {
  const directTarget = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const currentContainer =
    directTarget ||
    resolveScrollableElement(
      mobileView.value === 'articles' ? mobileArticlesListRef.value : mobileArticleContentRef.value
    );
  mobileScrollTopVisible.value = (currentContainer?.scrollTop || 0) > 320;
}

function scrollMobileReaderToTop() {
  const currentContainer = resolveScrollableElement(
    mobileView.value === 'articles' ? mobileArticlesListRef.value : mobileArticleContentRef.value
  );
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
    rememberMobileArticlesUnderlaySnapshot();
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
      accounts: targets.map(account => ({
        fakeid: account.fakeid,
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
      })),
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
      } else if (firstMessage === `all ${snapshot.failedCount} accounts failed`) {
        toast.error('同步失败', `全部 ${snapshot.failedCount} 个公众号同步失败`);
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
function isLikelyMobileHandset() {
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
  const shortestSide = Math.min(viewportWidth, viewportHeight);
  const hasTouch = navigator.maxTouchPoints > 0;
  const coarsePointer = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : false;
  const userAgent = navigator.userAgent || '';
  const mobileUa = /Android.+Mobile|iPhone|iPod|Windows Phone|Mobile/i.test(userAgent);

  return mobileUa || (hasTouch && coarsePointer && shortestSide > 0 && shortestSide < 768);
}

function updateDesktopViewport() {
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
  isDesktopViewport.value = !isLikelyMobileHandset() && viewportWidth >= 768;
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
  window.visualViewport?.addEventListener('resize', updateDesktopViewport);
  screen.orientation?.addEventListener?.('change', updateDesktopViewport);
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
  window.visualViewport?.removeEventListener('resize', updateDesktopViewport);
  screen.orientation?.removeEventListener?.('change', updateDesktopViewport);
});
</script>

<template>
  <div class="app-shell-bg h-screen overflow-hidden text-slate-900 dark:text-slate-100">
    <div v-if="!isDesktopViewport" class="relative h-full overflow-hidden">
      <div class="relative h-full overflow-hidden">
        <motion.div
          v-if="mobileArticlesUnderlayActive && mobileArticlesUnderlaySnapshot"
          class="absolute inset-0 z-0 flex h-full flex-col app-shell-bg"
          :style="{ x: mobileArticlesUnderlayX, scale: mobileArticlesUnderlayScale, opacity: mobileArticlesUnderlayOpacity }"
        >
          <div class="app-shell-glass relative z-10 overflow-hidden border-b border-slate-200/60 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800/70">
            <div class="pointer-events-none px-4 pb-3 pt-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex flex-1 items-start gap-3">
                  <span class="mobile-header-underlay-glyph mt-0.5" />
                  <div class="min-w-0 flex-1">
                    <h1 class="truncate text-base font-semibold">
                      {{ mobileArticlesUnderlaySnapshot.title }}
                    </h1>
                    <p class="mt-1 truncate text-[11px] leading-4 text-slate-500/90 dark:text-slate-400/90">
                      {{ mobileArticlesUnderlaySnapshot.meta }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2 opacity-80">
                  <span class="mobile-header-underlay-icon" />
                  <span class="mobile-header-underlay-icon" />
                  <span class="mobile-header-underlay-icon" />
                </div>
              </div>
            </div>
          </div>

          <div class="mobile-underlay-layer pointer-events-none flex-1 overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3">
            <div
              v-if="mobileArticlesUnderlaySnapshot.articles.length > 0"
              class="space-y-3 will-change-transform"
              :style="{ transform: `translate3d(0, ${mobileArticlesUnderlayWindow.translateY}px, 0)` }"
            >
              <div
                v-for="article in mobileArticlesUnderlayWindow.items"
                :key="`underlay-${articleKey(article)}`"
                class="rounded-[26px] border border-white/80 bg-white/80 px-4 py-3 shadow-[0_16px_34px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900/80"
              >
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
                    <span class="article-star-underlay" :class="isArticleFavorite(article) ? 'is-active' : ''">
                      <UIcon :name="isArticleFavorite(article) ? 'i-heroicons:star-solid' : 'i-heroicons:star'" class="size-3.5" />
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div v-else class="flex min-h-full items-center justify-center py-8">
              <EmptyStatePanel
                :icon="mobileArticlesUnderlaySnapshot.emptyState.icon"
                :title="mobileArticlesUnderlaySnapshot.emptyState.title"
                :description="mobileArticlesUnderlaySnapshot.emptyState.description"
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          v-if="mobileArticlesUnderlayActive && mobileArticlesUnderlaySnapshot"
          class="pointer-events-none absolute inset-0 z-[1] bg-slate-950/10 dark:bg-slate-950/20"
          :style="{ opacity: mobileArticlesUnderlayScrimOpacity }"
        />

        <motion.div
          key="mobile-articles"
          class="absolute inset-0 z-[2] flex h-full flex-col app-shell-bg"
          :class="mobileArticlesUnderlayActive ? 'shadow-[-18px_0_40px_rgba(15,23,42,0.12)]' : ''"
          :drag="selectedArticle ? false : 'x'"
          :dragControls="mobileArticlesDragControls"
          :dragListener="false"
          :dragConstraints="{ left: 0, right: 0 }"
          :dragElastic="mobileSwipeElastic"
          :dragMomentum="false"
          :dragDirectionLock="true"
          :dragSnapToOrigin="false"
          :dragTransition="mobileSwipeSnapTransition"
          :onDragEnd="onArticlesDragEnd"
          :style="
            selectedArticle
              ? mobileArticleUnderlayActive
                ? { x: mobileArticleUnderlayX, scale: mobileArticleUnderlayScale, opacity: mobileArticleUnderlayOpacity }
                : { x: 0, scale: 1, opacity: 0 }
              : { x: mobileArticlesSwipeX, scale: 1, opacity: 1 }
          "
        >
          <div class="app-shell-glass relative z-10 overflow-hidden border-b border-slate-200/60 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800/70">
            <div class="px-4 pb-3 pt-3" @pointerdown="beginMobileDrag('articles', $event)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex flex-1 items-start gap-3">
                  <UButton
                    v-if="selectedAccount"
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
                    <div v-if="selectedAccountInfo" class="flex items-center gap-2">
                      <h1 class="truncate text-base font-semibold">{{ mobileArticlesHeaderState.title }}</h1>
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
                    <h1 v-else class="truncate text-base font-semibold">
                      {{ mobileArticlesHeaderState.title }}
                    </h1>
                    <p class="mt-1 truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                      {{ mobileArticlesHeaderState.meta }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <UTooltip :text="favoriteOnly ? '取消只看收藏' : '只看收藏'">
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
              </div>
            </div>
          </div>

          <div v-if="loading" class="px-3 py-3">
            <LoadingCards />
          </div>
          <motion.div
            v-else
            ref="mobileArticlesListRef"
            class="mobile-touch-surface flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3"
            :class="selectedArticle ? 'pointer-events-none' : ''"
            @pointerdown="beginMobileDrag('articles', $event)"
            @scroll.passive="onMobileReaderScroll"
          >
            <ul v-if="displayedArticles.length > 0" class="space-y-3">
              <motion.li
                v-for="(article, index) in displayedArticles"
                :key="articleKey(article)"
                layout
                class="rounded-[26px] border border-white/80 bg-white/80 px-4 py-3 shadow-[0_18px_36px_rgba(15,23,42,0.07)] transition-colors dark:border-white/10 dark:bg-slate-900/80"
                :initial="prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.985 }"
                :animate="{ opacity: 1, y: 0, scale: 1 }"
                :whileTap="{ scale: 0.988 }"
                :transition="
                  prefersReducedMotion
                    ? { duration: 0.12 }
                    : {
                        type: 'spring',
                        stiffness: 460,
                        damping: 32,
                        mass: 0.75,
                        delay: Math.min(index, 6) * 0.02,
                      }
                "
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
              </motion.li>
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
          </motion.div>
        </motion.div>

        <motion.div
          v-if="selectedArticle && mobileArticleUnderlayActive"
          class="pointer-events-none absolute inset-0 z-[3] bg-slate-950/10 dark:bg-slate-950/20"
          :style="{ opacity: mobileArticleUnderlayScrimOpacity }"
        />

        <motion.div
          v-if="selectedArticle"
          key="mobile-article"
          class="mobile-article-sheet absolute inset-0 z-10 flex h-full flex-col bg-white text-slate-900 shadow-[-22px_0_44px_rgba(15,23,42,0.16)] dark:bg-slate-950 dark:text-slate-100"
          drag="x"
          :dragControls="mobileArticleDragControls"
          :dragListener="false"
          :dragConstraints="{ left: 0, right: 0 }"
          :dragElastic="mobileSwipeElastic"
          :dragMomentum="false"
          :dragDirectionLock="false"
          :dragSnapToOrigin="false"
          :dragTransition="mobileSwipeSnapTransition"
          :onDrag="onArticleDrag"
          :onDragEnd="onArticleDragEnd"
          :style="{ x: mobileArticleSwipeX }"
          :initial="prefersReducedMotion ? false : { opacity: 0, scale: 0.996 }"
          :animate="{ opacity: 1, scale: 1 }"
          :transition="mobilePageTransition"
        >
          <div class="mobile-article-edge-sensor absolute inset-y-0 left-0 z-30" @pointerdown="beginMobileDrag('article', $event)" />

          <motion.div
            class="pointer-events-none absolute bottom-0 right-0 z-20"
            :style="{ x: mobileArticleFavoriteCornerX, opacity: mobileArticleFavoriteCornerOpacity, scale: mobileArticleFavoriteCornerScale }"
          >
            <div
              class="mobile-article-favorite-corner"
              :class="{
                'is-ready': mobileArticleFavoriteHovering,
                'is-active': selectedArticle && isArticleFavorite(selectedArticle),
              }"
            >
              <UIcon
                :name="selectedArticle && isArticleFavorite(selectedArticle) ? 'i-heroicons:star-solid' : 'i-heroicons:star'"
                class="size-5"
              />
              <span>{{ selectedArticle && isArticleFavorite(selectedArticle) ? '已收藏' : '收藏' }}</span>
            </div>
          </motion.div>

          <div class="app-shell-glass relative z-10 overflow-hidden border-b border-slate-200/60 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800/70">
            <div class="px-4 pb-3 pt-3" @pointerdown="beginMobileDrag('article', $event)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex flex-1 items-start gap-3">
                  <UButton
                    size="2xs"
                    color="gray"
                    variant="ghost"
                    icon="i-lucide:chevron-left"
                    class="icon-btn mt-0.5"
                    @click="backFromMobileView"
                  />
                  <div class="min-w-0 flex-1">
                    <h1 class="line-clamp-2 text-base font-semibold leading-5">
                      {{ mobileCurrentHeaderState.title }}
                    </h1>
                    <p class="mt-1 truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                      {{ mobileCurrentHeaderState.meta }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <UTooltip text="查看原文">
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
                </div>
              </div>
            </div>
          </div>

          <div v-if="contentLoading">
            <EmptyStatePanel
              icon="i-lucide-loader-circle"
              title="内容加载中"
              description="正在准备文章内容，请稍候。"
            />
          </div>
          <motion.div
            v-else
            ref="mobileArticleContentRef"
            class="mobile-touch-surface flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3"
            @pointerdown="beginMobileDrag('article', $event)"
            @scroll.passive="onMobileReaderScroll"
          >
            <IframeHtmlRenderer :html="selectedArticleHtml" />
          </motion.div>
        </motion.div>
      </div>

      <AnimatePresence>
        <motion.div
          v-if="mobileAccountsPanelOpen"
          key="mobile-drawer-overlay"
          class="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[10px]"
          :initial="prefersReducedMotion ? false : { opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          :transition="mobilePanelSpring"
          @click.self="mobileAccountsPanelOpen = false"
        >
          <motion.aside
            class="app-shell-panel mobile-accounts-drawer mobile-touch-surface flex h-full w-[min(23rem,88vw)] flex-col border-r border-slate-200/60 shadow-[18px_0_48px_rgba(15,23,42,0.16)] dark:border-slate-800/70"
            :initial="prefersReducedMotion ? false : { x: '-100%' }"
            :animate="{ x: 0 }"
            :exit="{ x: '-100%' }"
            drag="x"
            :dragConstraints="{ left: 0, right: 0 }"
            :dragElastic="mobileDrawerElastic"
            :dragMomentum="false"
            :dragDirectionLock="true"
            :dragSnapToOrigin="true"
            :dragTransition="mobileDrawerSnapTransition"
            :transition="mobilePanelSpring"
            :onDragEnd="onDrawerDragEnd"
            @pointerdown="beginMobileDrag('drawer', $event)"
          >
              <div class="app-shell-glass border-b border-slate-200/60 px-4 py-3 dark:border-slate-800/70">
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
                    class="rounded-full border px-2.5 py-1 text-xs transition-all duration-200"
                    :class="
                      selectedCategory === category.id
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)] dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-white/80 bg-white/70 text-slate-600 hover:-translate-y-px hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900'
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
                    class="rounded-[24px] border px-4 py-3 transition-all duration-200"
                    :class="
                      selectedAccount === account.fakeid
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_38px_rgba(15,23,42,0.18)] dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-white/80 bg-white/80 shadow-[0_14px_30px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900/80'
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
          </motion.aside>
        </motion.div>
      </AnimatePresence>

      <ScrollTopFab :visible="mobileScrollTopVisible" @click="scrollMobileReaderToTop" />
    </div>

    <div v-else class="flex h-full gap-3 overflow-hidden p-3">
    <aside class="app-shell-panel w-[320px] flex-shrink-0 flex flex-col overflow-hidden rounded-[30px]">
      <header class="app-shell-glass space-y-2 border-b border-slate-200/60 p-3 dark:border-slate-800/70">
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
            class="px-2.5 py-1 rounded-full text-xs border transition-all duration-200"
            :class="
              selectedCategory === category.id
                ? 'bg-slate-900 text-white border-slate-900 shadow-[0_12px_24px_rgba(15,23,42,0.14)] dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'border-white/80 bg-white/70 text-slate-600 hover:-translate-y-px hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900'
            "
            @click="onClickCategory(category.id)"
          >
            {{ category.label }} · {{ category.count }}
          </button>
        </div>

      </header>

      <ul class="app-shell-scrollbar flex-1 overflow-y-auto divide-y divide-slate-200/60 px-2 py-2 dark:divide-slate-800/70">
        <li
          v-for="account in accountsInCategory"
          :key="account.fakeid"
          class="cursor-pointer rounded-[22px] px-3 py-2.5 transition-all duration-200"
          :class="
            selectedAccount === account.fakeid
              ? 'bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)] dark:bg-slate-900'
              : 'hover:bg-white/80 hover:shadow-[0_12px_24px_rgba(15,23,42,0.05)] dark:hover:bg-slate-900/70'
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

    <section class="app-shell-panel w-[430px] flex-shrink-0 overflow-hidden rounded-[30px] flex flex-col">
      <header class="app-shell-glass space-y-2 border-b border-slate-200/60 p-3 dark:border-slate-800/70">
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
            <div class="rounded-full border border-white/80 bg-white/80 px-3 py-1.5 shadow-[0_12px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-900/80">
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

      <div v-else v-bind="articleContainerProps" class="app-shell-scrollbar flex-1 h-0 overflow-y-auto px-2 py-2">
      <ul v-bind="articleWrapperProps" class="space-y-2">
        <li
          v-for="row in virtualDisplayedArticles"
          :key="articleKey(row.data)"
          class="cursor-pointer rounded-[22px] border border-transparent px-3 py-3 transition-all duration-200"
          :class="
            selectedArticle && articleKey(selectedArticle) === articleKey(row.data)
              ? 'border-white/80 bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-900'
              : 'hover:border-white/70 hover:bg-white/80 hover:shadow-[0_12px_24px_rgba(15,23,42,0.05)] dark:hover:border-white/10 dark:hover:bg-slate-900/70'
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
                <span class="min-w-0 flex items-center gap-2 truncate">
                  <span class="article-account-avatar">
                    <img
                      v-if="row.data.round_head_img"
                      :src="IMAGE_PROXY + row.data.round_head_img"
                      alt=""
                      class="size-full object-cover"
                    />
                    <UIcon v-else name="i-lucide:user-round" class="size-3.5 text-slate-400" />
                  </span>
                  <span class="truncate">{{ row.data.accountName }}</span>
                </span>
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
      <div v-if="!loading && (articlePageHasMore || articlePageLoading)" class="border-t border-slate-200/60 px-3 py-2 dark:border-slate-800/70">
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

    <main class="app-shell-panel flex-1 overflow-hidden rounded-[30px] flex flex-col">
      <div class="app-shell-glass border-b border-slate-200/60 px-6 py-4 dark:border-slate-800/70">
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
      <div v-else class="app-shell-scrollbar flex-1 overflow-y-auto p-4">
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
        class="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[14px] md:hidden"
        @click.self="systemMenuOpen = false"
      >
        <Transition name="mobile-menu-drop">
          <section
            v-if="systemMenuOpen && !isDesktopViewport"
            class="app-shell-panel fixed inset-x-3 top-[68px] max-h-[calc(100vh-84px)] overflow-hidden rounded-[30px] border border-slate-200/60 shadow-[0_28px_80px_rgba(15,23,42,0.24)] dark:border-slate-800/70"
          >
            <div class="app-shell-glass flex items-start justify-between gap-4 border-b border-slate-200/60 px-4 pb-4 pt-4 dark:border-slate-800/70">
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
                      class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all duration-200"
                      :class="
                        systemMenuActive === item.id
                          ? 'border-slate-900 bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)] dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                          : 'border-white/80 bg-white/70 text-slate-600 hover:-translate-y-px hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900'
                      "
                      @click="openSystemMenu(item.id)"
                    >
                      <UIcon :name="item.icon" class="size-4 shrink-0" />
                      <span>{{ item.label }}</span>
                    </button>
                  </div>
                </section>

                <section class="overflow-hidden rounded-[26px] border border-white/80 bg-white/80 shadow-[0_18px_36px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-900/80">
                  <div id="title" class="hidden" />
                  <KeepAlive>
                    <component :is="activeSystemMenuComponent" class="min-h-full bg-transparent" />
                  </KeepAlive>
                </section>
              </div>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>

    <UModal v-if="isDesktopViewport" v-model="systemMenuOpen" :ui="{ width: 'sm:max-w-[1120px]' }">
      <UCard class="app-shell-panel overflow-hidden rounded-[30px]" :ui="{ ring: '', body: { padding: 'p-0 sm:p-0' } }">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">系统菜单</h3>
            <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:x" class="icon-btn" @click="systemMenuOpen = false" />
          </div>
        </template>

        <div class="h-[72vh] min-h-[520px] flex">
          <aside class="app-shell-glass w-48 border-r border-slate-200/60 p-2 dark:border-slate-800/70">
            <button
              v-for="item in systemMenuItems"
              :key="item.id"
              type="button"
              class="w-full flex items-center gap-2 rounded-[18px] px-3 py-2 text-left text-sm transition-all duration-200"
              :class="
                systemMenuActive === item.id
                  ? 'bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)] dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-900/70'
              "
              @click="openSystemMenu(item.id)"
            >
              <UIcon :name="item.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ item.label }}</span>
            </button>
          </aside>

          <section class="flex-1 bg-transparent">
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
  @apply !inline-flex size-7 !p-0 !gap-0 items-center justify-center leading-none rounded-full border border-white/80 dark:border-white/10
    bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300
    hover:-translate-y-px hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-900
    transition-all duration-200;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
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
  @apply size-8 rounded-full overflow-hidden border border-white/80 dark:border-white/10
    bg-white/80 dark:bg-slate-900/80 flex items-center justify-center hover:-translate-y-px transition-all duration-200;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
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

.mobile-header-underlay-glyph,
.mobile-header-underlay-icon {
  @apply block size-7 shrink-0 rounded-full border border-white/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/80;
}

.article-star-underlay {
  @apply inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/80 text-slate-400 dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-500;
}

.article-star-underlay.is-active {
  @apply border-amber-300 bg-amber-50 text-amber-500 dark:border-amber-500/60 dark:bg-amber-500/10;
}

.article-account-avatar {
  @apply inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/70 bg-slate-200 dark:border-white/10 dark:bg-slate-800;
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
  will-change: transform;
}

.mobile-touch-surface {
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  will-change: transform, scroll-position;
  transform: translateZ(0);
}

.mobile-underlay-layer {
  contain: layout paint;
  transform: translateZ(0);
}

.mobile-article-sheet {
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.985) 0%, rgba(255, 255, 255, 1) 12%, rgba(255, 255, 255, 1) 100%);
}

:global(.dark) .mobile-article-sheet {
  background-image: linear-gradient(180deg, rgba(2, 6, 23, 0.985) 0%, rgba(2, 6, 23, 1) 12%, rgba(2, 6, 23, 1) 100%);
}

.mobile-article-favorite-corner {
  @apply flex h-[116px] w-[116px] flex-col items-center justify-center gap-1.5 rounded-tl-[34px] text-slate-500 shadow-[-12px_-12px_28px_rgba(15,23,42,0.12)] dark:text-slate-300;
  background-color: rgba(148, 163, 184, 0.96);
}

.mobile-article-favorite-corner span {
  @apply text-[11px] font-medium tracking-[0.08em];
}

.mobile-article-favorite-corner.is-ready {
  @apply text-amber-600 dark:text-amber-300;
  background-color: rgba(252, 211, 77, 0.94);
}

.mobile-article-favorite-corner.is-active {
  @apply text-amber-500 dark:text-amber-300;
  background-color: rgba(251, 191, 36, 0.92);
}

:global(.dark) .mobile-article-favorite-corner {
  background-color: rgba(15, 23, 42, 0.94);
}

:global(.dark) .mobile-article-favorite-corner.is-ready {
  background-color: rgba(245, 158, 11, 0.34);
}

:global(.dark) .mobile-article-favorite-corner.is-active {
  background-color: rgba(245, 158, 11, 0.28);
}

.mobile-article-edge-sensor {
  width: 32px;
  touch-action: none;
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
