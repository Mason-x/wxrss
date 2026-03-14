<script setup lang="ts">
import type {
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  GridApi,
  GridOptions,
  GridReadyEvent,
  ICellRendererParams,
  SelectionChangedEvent,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import { formatTimeStamp } from '#shared/utils/helpers';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';
import {
  bootstrapAccountAi,
  getArticleList,
  INITIAL_SUBSCRIBE_PAGE_SIZE,
  refreshAiDailyDigest,
  syncRssFeed,
} from '~/apis';
import GlobalSearchAccountDialog from '~/components/global/SearchAccountDialog.vue';
import GridAccountActions from '~/components/grid/AccountActions.vue';
import GridLoadProgress from '~/components/grid/LoadProgress.vue';
import EmptyStatePanel from '~/components/mobile/EmptyStatePanel.vue';
import ScrollTopFab from '~/components/mobile/ScrollTopFab.vue';
import ConfirmModal from '~/components/modal/Confirm.vue';
import toastFactory from '~/composables/toast';
import useLoginCheck from '~/composables/useLoginCheck';
import { IMAGE_PROXY, websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
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
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

useHead({
  title: `订阅源管理 | ${websiteName}`,
});

interface PromiseInstance {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

const toast = toastFactory();
const modal = useModal();
const { checkLogin } = useLoginCheck();
const route = useRoute();
const { navigateToLogin } = useMpAuth();

const { getSyncTimestamp } = useSyncDeadline();

const preferences = usePreferences();
const aiAutoSummaryOnSyncEnabled = computed(() => preferences.value.aiAutoSummaryOnSyncEnabled !== false);

// 账号事件总线，用于和 Credentials 面板保持列表同步
const { accountEventBus } = useAccountEventBus();
accountEventBus.on(event => {
  if (event === 'account-added' || event === 'account-removed') {
    refresh();
  }
});

const searchAccountDialogRef = ref<typeof GlobalSearchAccountDialog | null>(null);

const addBtnLoading = ref(false);
function addAccount() {
  if (!checkLogin()) return;

  searchAccountDialogRef.value!.open();
}
async function onSelectAccount(account: MpAccount | AccountInfo) {
  addBtnLoading.value = true;
  try {
    if (!isRssAccount(account)) {
      await loadAccountArticle(account, false, INITIAL_SUBSCRIBE_PAGE_SIZE);
    }
    await refresh();
    await bootstrapAiAfterAddingAccount(account.fakeid);
    await runAiRefreshAfterSync();
    toast.success(
      isRssAccount(account) ? 'RSS 添加成功' : '公众号添加成功',
      isRssAccount(account)
        ? `已成功添加订阅【${account.nickname}】`
        : `已成功添加公众号【${account.nickname}】，并同步了最近 ${INITIAL_SUBSCRIBE_PAGE_SIZE} 篇文章`
    );
    accountEventBus.emit('account-added', { fakeid: account.fakeid });
  } catch (error: any) {
    toast.error(isRssAccount(account) ? '添加 RSS 失败' : '添加公众号失败', String(error?.message || '未知错误'));
  } finally {
    addBtnLoading.value = false;
  }
}

// 表示同步过程中是否执行了取消操作
const isCanceled = ref(false);
const isDeleting = ref(false);
const isSyncing = ref(false);

// 当前正在同步的公众号id
const syncingRowId = ref<string | null>(null);

const syncTimer = ref<number | null>(null);

async function _load(
  account: MpAccount,
  begin: number,
  loadMore: boolean,
  promise: PromiseInstance,
  initialPageSize = 0
) {
  if (isCanceled.value) {
    isCanceled.value = false; // 这里需要将状态复位
    promise.reject(new Error('已取消同步'));
    return;
  }

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
    promise.reject(new Error('已取消同步'));
    return;
  }
  const noNewOnThisPage = Number(pageMessageCount) > 0 && inserted === 0;
  if (completed || noNewOnThisPage) {
    await updateRow(account.fakeid);
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
  const syncToTimestamp = getSyncTimestamp();
  if (tailCreateTime > 0 && tailCreateTime < syncToTimestamp) {
    // 已同步到配置的时间范围
    loadMore = false;
  }

  await updateRow(account.fakeid);
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
    syncingRowId.value = account.fakeid;
    isSyncing.value = true;

    try {
      const result = await syncRssFeed({ fakeid: account.fakeid });
      return result.account;
    } finally {
      syncingRowId.value = null;
      isSyncing.value = false;
    }
  }

  return new Promise((resolve, reject) => {
    const promise: PromiseInstance = { resolve, reject };

    _load(account, 0, loadMore, promise, initialPageSize).catch(e => {
      syncingRowId.value = null;
      isSyncing.value = false;

      if (e.message === 'session expired') {
        void navigateToLogin(route.fullPath);
      }
      reject(e);
    });
  });
}

// 同步所有公众号
async function loadSelectedAccountArticle() {
  if (!checkLogin()) return;

  isCanceled.value = false;

  try {
    const rows = getSelectedRows();
    for (const account of rows) {
      await loadAccountArticle(account);
    }
    await runAiRefreshAfterSync();
    toast.success(`已成功同步 ${rows.length} 个订阅源`);
  } catch (e: any) {
    toast.error('同步失败', e.message);
  }
}

const globalRowData = ref<MpAccount[]>([]);

const columnDefs = ref<ColDef[]>([
  {
    colId: 'fakeid',
    headerName: 'fakeid',
    field: 'fakeid',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 200,
    cellClass: 'font-mono',
    initialHide: true,
  },
  {
    colId: 'round_head_img',
    headerName: '头像',
    field: 'round_head_img',
    sortable: false,
    filter: false,
    cellRenderer: (params: ICellRendererParams) => {
      return `<img alt="" src="${IMAGE_PROXY + params.value}" style="height: 30px; width: 30px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 100%;" />`;
    },
    cellClass: 'flex justify-center items-center',
    minWidth: 80,
  },
  {
    colId: 'nickname',
    headerName: '名称',
    field: 'nickname',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'nickname',
    minWidth: 200,
  },
  {
    colId: 'category',
    headerName: '分类',
    field: 'category',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    editable: true,
    minWidth: 140,
    tooltipField: 'category',
    valueGetter: params => params.data?.category || '',
  },
  {
    colId: 'create_time',
    headerName: '添加时间',
    field: 'create_time',
    valueFormatter: p => (p.value ? formatTimeStamp(p.value) : ''),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('create_time') * 1000);
    },
    sort: 'desc',
    minWidth: 180,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    colId: 'update_time',
    headerName: '最后同步时间',
    field: 'update_time',
    valueFormatter: p => (p.value ? formatTimeStamp(p.value) : ''),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('update_time') * 1000);
    },
    minWidth: 180,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    colId: 'total_count',
    headerName: '消息总数',
    field: 'total_count',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 150,
  },
  {
    colId: 'count',
    headerName: '已同步消息数',
    field: 'count',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 180,
  },
  {
    colId: 'articles',
    headerName: '已同步文章数',
    field: 'articles',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 180,
    initialHide: true,
  },
  {
    colId: 'load_percent',
    headerName: '同步进度',
    valueGetter: params => (params.data.total_count === 0 ? 0 : params.data.count / params.data.total_count),
    cellDataType: 'number',
    cellRenderer: GridLoadProgress,
    filter: 'agNumberColumnFilter',
    minWidth: 200,
  },
  {
    colId: 'completed',
    headerName: '是否同步完成',
    field: 'completed',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已同步完成', '未同步完成'),
    cellClass: 'flex justify-center items-center',
    headerClass: 'justify-center',
    minWidth: 200,
  },
  {
    colId: 'action',
    headerName: '操作',
    field: 'fakeid',
    sortable: false,
    filter: false,
    cellRenderer: GridAccountActions,
    cellRendererParams: {
      onSync: (params: ICellRendererParams) => {
        syncSingleAccount(params.data);
      },
      onStop: () => {
        stopSync();
      },
      isDeleting: isDeleting,
      isSyncing: isSyncing,
      syncingRowId: syncingRowId,
    },
    cellClass: 'flex justify-center items-center',
    maxWidth: 100,
    pinned: 'right',
  },
]);

// 注意，`defu`函数最左边的参数优先级最高
const gridOptions: GridOptions = defu(
  {
    getRowId: (params: GetRowIdParams) => String(params.data.fakeid),
  },
  sharedGridOptions
);

const gridApi = shallowRef<GridApi | null>(null);
function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;

  restoreColumnState();
  if (selectedRowIds.value.length > 0) {
    const idSet = new Set(selectedRowIds.value);
    gridApi.value.forEachNode(node => {
      node.setSelected(idSet.has(String(node.data?.fakeid)));
    });
  }
  refresh();
}

function onColumnStateChange() {
  if (gridApi.value) {
    saveColumnState();
  }
}

async function onCellValueChanged(evt: CellValueChangedEvent<MpAccount>) {
  if (evt.colDef.colId !== 'category' || !evt.data) {
    return;
  }

  const category = String(evt.newValue || '').trim();
  evt.data.category = category;
  await updateAccountCategory(evt.data.fakeid, category);
}

function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState-account', JSON.stringify(state));
}

function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState-account');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    gridApi.value?.applyColumnState({
      state,
      applyOrder: true,
    });
  }
}

async function refresh() {
  try {
    globalRowData.value = await getAllInfo();
    gridApi.value?.setGridOption('rowData', globalRowData.value);
    const rowIdSet = new Set(globalRowData.value.map(row => row.fakeid));
    selectedRowIds.value = selectedRowIds.value.filter(id => rowIdSet.has(id));
  } catch (error: any) {
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
  }
}

async function updateRow(fakeid: string) {
  const info = await getInfoCache(fakeid);
  const rowNode = gridApi.value?.getRowNode(fakeid);
  if (rowNode && info) {
    rowNode.updateData(info);
  }
  const index = globalRowData.value.findIndex(item => item.fakeid === fakeid);
  if (index >= 0 && info) {
    globalRowData.value = globalRowData.value.map(item => (item.fakeid === fakeid ? info : item));
  }
}

const selectedRowIds = ref<string[]>([]);
const hasSelectedRows = computed(() => selectedRowIds.value.length > 0);
const selectedCount = computed(() => selectedRowIds.value.length);
const mobileListRef = ref<HTMLElement | null>(null);
const showScrollTop = ref(false);
function onSelectionChanged(evt: SelectionChangedEvent) {
  selectedRowIds.value = evt.api.getSelectedRows().map(row => String((row as MpAccount).fakeid));
}
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

function onMobileListScroll() {
  showScrollTop.value = (mobileListRef.value?.scrollTop || 0) > 320;
}

function scrollMobileListToTop() {
  mobileListRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function syncSingleAccount(account: MpAccount) {
  if (!checkLogin()) return;

  isCanceled.value = false;
  try {
    await loadAccountArticle(account);
    await runAiRefreshAfterSync();
    toast.success('同步完成', `公众号【${account.nickname}】的文章已同步完毕`);
  } catch (e: any) {
    toast.error('同步失败', e.message);
  }
}

async function runAiRefreshAfterSync() {
  if (!aiAutoSummaryOnSyncEnabled.value) {
    return;
  }

  try {
    await refreshAiDailyDigest();
  } catch (error) {
    console.error('AI daily refresh failed:', error);
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
  isCanceled.value = true;
  if (syncTimer.value) {
    window.clearTimeout(syncTimer.value);
    syncTimer.value = null;
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

watch(selectedRowIds, ids => {
  if (!gridApi.value) return;
  const idSet = new Set(ids);
  gridApi.value.forEachNode(node => {
    const shouldSelect = idSet.has(String(node.data?.fakeid));
    if (node.isSelected() !== shouldSelect) {
      node.setSelected(shouldSelect);
    }
  });
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
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">订阅源管理</h1>
    </Teleport>

    <div class="flex h-full flex-col divide-y divide-gray-200">
      <header class="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-slate-50/92 px-3 py-3 backdrop-blur md:static md:border-b-0 md:bg-transparent md:backdrop-blur-0">
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

          <div class="hidden flex-wrap items-center gap-2 md:flex">
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

        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span class="rounded-full bg-slate-100 px-3 py-1">账号总数 {{ globalRowData.length }}</span>
          <span class="rounded-full bg-blue-50 px-3 py-1 text-blue-600">已选择 {{ selectedCount }} 个</span>
          <span class="rounded-full bg-amber-50 px-3 py-1 text-amber-700">同步范围 {{ getActualDateRange() }}</span>
        </div>
      </header>

      <div class="min-h-0 flex-1">
        <div
          v-if="globalRowData.length === 0"
        >
          <EmptyStatePanel
            icon="i-lucide-users"
            title="还没有公众号账号"
            description="先添加或导入订阅源，之后就可以在这里批量同步和管理分类。"
          />
        </div>

        <div v-else class="h-full">
          <div
            ref="mobileListRef"
            class="h-full overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] md:hidden"
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
                        class="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-400"
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
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            "
                          >
                            {{ account.completed ? '已完成' : '未完成' }}
                          </span>
                          <span
                            v-if="isSyncing && syncingRowId === account.fakeid"
                            class="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700"
                          >
                            同步中
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
                      <div class="h-2 rounded-full bg-slate-100">
                        <div
                          class="h-2 rounded-full bg-blue-500 transition-all"
                          :style="{ width: `${getLoadPercent(account)}%` }"
                        />
                      </div>
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

          <div class="hidden h-full md:block">
            <ag-grid-vue
              style="width: 100%; height: 100%"
              :rowData="globalRowData"
              :columnDefs="columnDefs"
              :gridOptions="gridOptions"
              @grid-ready="onGridReady"
              @cell-value-changed="onCellValueChanged"
              @selection-changed="onSelectionChanged"
              @column-moved="onColumnStateChange"
              @column-visible="onColumnStateChange"
              @column-pinned="onColumnStateChange"
              @column-resized="onColumnStateChange"
            />
          </div>
        </div>
      </div>
    </div>

    <ScrollTopFab :visible="showScrollTop" @click="scrollMobileListToTop" />
    <GlobalSearchAccountDialog ref="searchAccountDialogRef" @select:account="onSelectAccount" />
  </div>
</template>

