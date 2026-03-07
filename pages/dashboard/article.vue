<script setup lang="ts">
import type {
  ColDef,
  FilterChangedEvent,
  GetRowIdParams,
  GridApi,
  GridOptions,
  GridReadyEvent,
  ICellRendererParams,
  SelectionChangedEvent,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import type { PreviewArticle } from '#components';
import { durationToSeconds, formatItemShowType, formatTimeStamp, sleep } from '#shared/utils/helpers';
import { validateHTMLContent } from '#shared/utils/html';
import GridAlbum from '~/components/grid/Album.vue';
import GridArticleActions from '~/components/grid/ArticleActions.vue';
import GridCoverTooltip from '~/components/grid/CoverTooltip.vue';
import GridStatusBar from '~/components/grid/StatusBar.vue';
import EmptyStatePanel from '~/components/mobile/EmptyStatePanel.vue';
import LoadingCards from '~/components/mobile/LoadingCards.vue';
import ScrollTopFab from '~/components/mobile/ScrollTopFab.vue';
import AccountSelectorForArticle from '~/components/selector/AccountSelectorForArticle.vue';
import { isDev, websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { articleDeleted, getArticleCache, updateArticleStatus } from '~/store/v2/article';
import { getCommentCache } from '~/store/v2/comment';
import { getDebugCache } from '~/store/v2/debug';
import { getHtmlCache } from '~/store/v2/html';
import { type MpAccount } from '~/store/v2/info';
import { getMetadataCache, type Metadata } from '~/store/v2/metadata';
import type { Preferences } from '~/types/preferences';
import type { AppMsgExWithFakeID } from '~/types/types';
import type { ArticleMetadata } from '~/utils/download/types';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

useHead({
  title: `文章下载 | ${websiteName}`,
});

interface Article extends AppMsgExWithFakeID, Partial<ArticleMetadata> {
  contentDownload: boolean;
  commentDownload: boolean;
}

const globalRowData = ref<Article[]>([]);

const columnDefs = ref<ColDef[]>([
  {
    headerName: 'ID',
    field: 'aid',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '链接',
    field: 'link',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 150,
    initialHide: true,
    cellClass: 'font-mono',
  },
  {
    headerName: '标题',
    field: 'title',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'title',
    minWidth: 200,
  },
  {
    headerName: '封面',
    field: 'cover',
    sortable: false,
    filter: false,
    cellRenderer: (params: ICellRendererParams) => {
      return `<img alt="" src="${params.value}" style="height: 40px; width: 40px; object-fit: cover;" />`;
    },
    tooltipField: 'cover',
    tooltipComponent: GridCoverTooltip,
    minWidth: 80,
    hide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '摘要',
    field: 'digest',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'digest',
    minWidth: 200,
    initialHide: true,
  },
  {
    headerName: '创建时间',
    field: 'create_time',
    valueFormatter: p => formatTimeStamp(p.value),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('create_time') * 1000);
    },
    minWidth: 180,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '发布时间',
    field: 'update_time',
    valueFormatter: p => formatTimeStamp(p.value),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('update_time') * 1000);
    },
    minWidth: 180,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '是否已删除',
    field: 'is_deleted',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已删除', '未删除'),
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '文章状态',
    field: '_status',
    valueFormatter: p => p.value,
    filter: 'agSetColumnFilter',
    filterParams: {
      valueFormatter: (p: ValueFormatterParams) => p.value,
    },
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '内容已下载',
    field: 'contentDownload',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    field: 'commentDownload',
    headerName: '评论已下载',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '阅读',
    field: 'readNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '点赞',
    field: 'oldLikeNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '分享',
    field: 'shareNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '喜欢',
    field: 'likeNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '评论',
    field: 'commentNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    field: 'author_name',
    headerName: '作者',
    cellDataType: 'text',
    filter: 'agSetColumnFilter',
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '是否原创',
    valueGetter: p => p.data && p.data.copyright_stat === 1 && p.data.copyright_type === 1,
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('原创', '非原创'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '文章类型',
    field: 'item_show_type',
    valueFormatter: p => formatItemShowType(p.value),
    filter: 'agSetColumnFilter',
    filterParams: {
      valueFormatter: (p: ValueFormatterParams) => formatItemShowType(p.value),
    },
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '媒体时长',
    field: 'media_duration',
    valueGetter: params => durationToSeconds(params.data.media_duration),
    valueFormatter: params => params.data.media_duration,
    filter: 'agNumberColumnFilter',
    comparator: (a, b) => a - b,
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '所属合集',
    field: 'appmsg_album_infos',
    cellRenderer: GridAlbum,
    sortable: false,
    filter: false,
    valueFormatter: p => p.value.map((album: any) => album.title).join(','),
    minWidth: 150,
    initialHide: true,
  },
  {
    headerName: '操作',
    field: 'link',
    sortable: false,
    filter: false,
    cellRenderer: GridArticleActions,
    cellRendererParams: {
      onPreview: (params: ICellRendererParams) => {
        preview(params.data);
      },
      onGotoLink: (params: ICellRendererParams) => {
        window.open(params.value, '_blank', 'noopener');
      },
    },
    maxWidth: 100,
    pinned: 'right',
    cellClass: 'flex justify-center items-center',
  },
]);

const gridOptions: GridOptions = defu(
  {
    getRowId: (params: GetRowIdParams) => `${params.data.fakeid}:${params.data.aid}`,
    statusBar: {
      statusPanels: [
        {
          statusPanel: GridStatusBar,
          align: 'left',
        },
      ],
    },
  },
  sharedGridOptions
);

const gridApi = shallowRef<GridApi | null>(null);
function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;
  restoreColumnState();
  if (selectedArticleRowIds.value.length > 0) {
    const idSet = new Set(selectedArticleRowIds.value);
    gridApi.value.forEachNode(node => {
      node.setSelected(idSet.has(String(node.id)));
    });
  }
}

function onColumnStateChange() {
  if (gridApi.value) {
    saveColumnState();
  }
}

function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState', JSON.stringify(state));
}

function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    gridApi.value?.applyColumnState({
      state,
      applyOrder: true,
    });
  }
}

function onFilterChanged(event: FilterChangedEvent) {
  event.api.deselectAll();
  selectedArticleRowIds.value = [];
}

const preferences = usePreferences();
const hideDeleted = computed(() => (preferences.value as unknown as Preferences).hideDeleted);

const previewArticleRef = ref<typeof PreviewArticle | null>(null);

function preview(article: Article) {
  previewArticleRef.value?.open(article);
}

const loading = ref(false);
const selectedAccount = ref<MpAccount | undefined>();

watch(selectedAccount, newVal => {
  if (!newVal?.fakeid) {
    globalRowData.value = [];
    selectedArticleRowIds.value = [];
    gridApi.value?.setGridOption('rowData', []);
    return;
  }
  switchTableData(newVal.fakeid).catch(() => {});
});

watch(hideDeleted, () => {
  if (selectedAccount.value?.fakeid) {
    switchTableData(selectedAccount.value.fakeid).catch(() => {});
  }
});

async function switchTableData(fakeid: string) {
  loading.value = true;
  const articles: Article[] = [];
  const data = await getArticleCache(fakeid, Date.now());
  for (const article of data) {
    const contentDownload = (await getHtmlCache(article.link)) !== undefined;
    const commentDownload = (await getCommentCache(article.link)) !== undefined;
    const metadata = await getMetadataCache(article.link);
    if (metadata) {
      articles.push({
        ...metadata,
        ...article,
        contentDownload,
        commentDownload,
      });
    } else {
      articles.push({
        ...article,
        contentDownload,
        commentDownload,
      });
    }
  }
  await sleep(200);
  globalRowData.value = articles.filter(article => (hideDeleted.value ? !article.is_deleted : true));
  selectedArticleRowIds.value = [];
  gridApi.value?.setGridOption('rowData', globalRowData.value);
  loading.value = false;
}

function getArticleRowId(article: Article) {
  return `${article.fakeid}:${article.aid}`;
}

function updateRow(article: Article) {
  const rowId = getArticleRowId(article);
  const rowNode = gridApi.value?.getRowNode(rowId);
  if (rowNode) {
    rowNode.updateData(article);
  }
  globalRowData.value = globalRowData.value.map(item => (getArticleRowId(item) === rowId ? { ...article } : item));
}

const selectedArticleRowIds = ref<string[]>([]);
const mobileListRef = ref<HTMLElement | null>(null);
const showScrollTop = ref(false);
const selectedArticles = computed(() => {
  const idSet = new Set(selectedArticleRowIds.value);
  return globalRowData.value.filter(article => idSet.has(getArticleRowId(article)));
});

function onSelectionChanged(event: SelectionChangedEvent) {
  selectedArticleRowIds.value = event.api.getSelectedRows().map(row => getArticleRowId(row as Article));
}

const selectedArticleUrls = computed(() => selectedArticles.value.map(article => article.link));
const selectedCount = computed(() => selectedArticles.value.length);

function isArticleSelected(article: Article) {
  return selectedArticleRowIds.value.includes(getArticleRowId(article));
}

function toggleArticleSelection(article: Article, checked: boolean) {
  const rowId = getArticleRowId(article);
  if (checked) {
    if (!selectedArticleRowIds.value.includes(rowId)) {
      selectedArticleRowIds.value = [...selectedArticleRowIds.value, rowId];
    }
    return;
  }
  selectedArticleRowIds.value = selectedArticleRowIds.value.filter(id => id !== rowId);
}

function toggleArticleSelectionByClick(article: Article) {
  toggleArticleSelection(article, !isArticleSelected(article));
}

function toggleArticleSelectionFromInput(article: Article) {
  toggleArticleSelection(article, !isArticleSelected(article));
}

function onMobileListScroll() {
  showScrollTop.value = (mobileListRef.value?.scrollTop || 0) > 320;
}

function scrollMobileListToTop() {
  mobileListRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

watch(selectedArticleRowIds, ids => {
  if (!gridApi.value) return;
  const idSet = new Set(ids);
  gridApi.value.forEachNode(node => {
    const shouldSelect = idSet.has(String(node.id));
    if (node.isSelected() !== shouldSelect) {
      node.setSelected(shouldSelect);
    }
  });
});

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader({
  onContent(url: string) {
    const article = globalRowData.value.find(item => item.link === url);
    if (article) {
      article.contentDownload = true;
      article._status = '正常';
      updateRow(article);

      updateArticleStatus(url, '正常');
      article.is_deleted = false;
      articleDeleted(url, false);
    } else {
      console.warn(`${url} not found in table data when update contentDownload`);
    }
  },
  onStatusChange(url: string, status: string) {
    const article = globalRowData.value.find(item => item.link === url);
    if (article) {
      article._status = status;
      updateRow(article);

      updateArticleStatus(url, status);
    }
  },
  onDelete(url: string) {
    const article = globalRowData.value.find(item => item.link === url);
    if (article) {
      article.is_deleted = true;
      article._status = '已删除';
      updateRow(article);

      updateArticleStatus(url, '已删除');
      articleDeleted(url);
    }
  },
  onMetadata(url: string, metadata: Metadata) {
    const article = globalRowData.value.find(item => item.link === url);
    if (article) {
      article.readNum = metadata.readNum;
      article.oldLikeNum = metadata.oldLikeNum;
      article.shareNum = metadata.shareNum;
      article.likeNum = metadata.likeNum;
      article.commentNum = metadata.commentNum;

      if ((preferences.value as unknown as Preferences).downloadConfig.metadataOverrideContent) {
        article.contentDownload = true;
        article._status = '正常';
        updateArticleStatus(url, '正常');
        article.is_deleted = false;
        articleDeleted(url, false);
      }

      updateRow(article);
    } else {
      console.warn(`${url} not found in table data when update metadata`);
    }
  },
  onComment(url: string) {
    const article = globalRowData.value.find(item => item.link === url);
    if (article) {
      article.commentDownload = true;
      updateRow(article);
    } else {
      console.warn(`${url} not found in table data when update commentDownload`);
    }
  },
});

const {
  loading: exportBtnLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

async function debug() {
  const cache = await getDebugCache('https://mp.weixin.qq.com/s/0IEaqpJIBGykHFKqj-7xqw');
  console.log(cache);
  if (cache) {
    const html = await cache.file.text();
    console.log(html);
    const result = validateHTMLContent(html);
    console.log(result);
  }
}

const copied = ref(false);
function copyWechatLink() {
  const link = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${selectedAccount.value?.fakeid}&scene=124#wechat_redirect`;
  navigator.clipboard.writeText(link);

  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1000);
}

function openOriginalArticle(link: string) {
  window.open(link, '_blank', 'noopener');
}

const downloadLabel = computed(() => {
  if (downloadBtnLoading.value) {
    return `抓取中 ${downloadCompletedCount.value}/${downloadTotalCount.value}`;
  }
  return '抓取';
});

const exportLabel = computed(() => {
  if (exportBtnLoading.value) {
    return `${exportPhase.value} ${exportCompletedCount.value}/${exportTotalCount.value}`;
  }
  return '导出';
});
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">文章下载</h1>
    </Teleport>

    <div class="flex h-full flex-col divide-y divide-gray-200">
      <header class="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-slate-50/92 px-3 py-3 backdrop-blur md:static md:border-b-0 md:bg-transparent md:backdrop-blur-0">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <AccountSelectorForArticle v-model="selectedAccount" class="w-full sm:w-80" />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton v-if="downloadBtnLoading" size="sm" color="black" @click="stopDownload">停止</UButton>

            <ButtonGroup class="hidden md:inline-flex"
              :items="[
                { label: '文章内容', event: 'download-article-html' },
                { label: '阅读数据（需要 Credential）', event: 'download-article-metadata' },
                { label: '评论内容（需要 Credential）', event: 'download-article-comment' },
              ]"
              @download-article-html="download('html', selectedArticleUrls)"
              @download-article-metadata="download('metadata', selectedArticleUrls)"
              @download-article-comment="download('comment', selectedArticleUrls)"
            >
              <UButton
                size="sm"
                :loading="downloadBtnLoading"
                :disabled="!selectedAccount || selectedCount === 0"
                color="white"
                class="font-mono"
                :label="downloadLabel"
                trailing-icon="i-heroicons-chevron-down-20-solid"
              />
            </ButtonGroup>

            <ButtonGroup class="hidden md:inline-flex"
              :items="[
                { label: 'Excel', event: 'export-article-excel' },
                { label: 'JSON', event: 'export-article-json' },
                { label: 'HTML', event: 'export-article-html' },
                { label: 'Txt', event: 'export-article-text' },
                { label: 'Markdown', event: 'export-article-markdown' },
                { label: 'Word（内测）', event: 'export-article-word' },
              ]"
              @export-article-excel="exportFile('excel', selectedArticleUrls)"
              @export-article-json="exportFile('json', selectedArticleUrls)"
              @export-article-html="exportFile('html', selectedArticleUrls)"
              @export-article-text="exportFile('text', selectedArticleUrls)"
              @export-article-markdown="exportFile('markdown', selectedArticleUrls)"
              @export-article-word="exportFile('word', selectedArticleUrls)"
            >
              <UButton
                size="sm"
                :loading="exportBtnLoading"
                :disabled="!selectedAccount || selectedCount === 0"
                color="white"
                class="font-mono"
                :label="exportLabel"
                trailing-icon="i-heroicons-chevron-down-20-solid"
              />
            </ButtonGroup>

            <UButton
              size="sm"
              :disabled="!selectedAccount"
              :icon="copied ? 'i-lucide:check' : 'i-heroicons-link-16-solid'"
              label="复制公众号链接"
              :color="copied ? 'green' : 'gray'"
              variant="soft"
              @click="copyWechatLink"
            />

            <UButton v-if="isDev" size="sm" color="gray" variant="soft" @click="debug">调试</UButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span class="rounded-full bg-slate-100 px-3 py-1">
            {{ selectedAccount?.nickname ? `当前账号 ${selectedAccount.nickname}` : '请选择一个公众号' }}
          </span>
          <span class="rounded-full bg-blue-50 px-3 py-1 text-blue-600">文章 {{ globalRowData.length }} 篇</span>
          <span class="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">已选择 {{ selectedCount }} 篇</span>
        </div>
      </header>

      <div class="min-h-0 flex-1">
        <div v-if="!selectedAccount">
          <EmptyStatePanel
            icon="i-lucide-newspaper"
            title="请选择一个公众号"
            description="选择账号后，就能查看文章列表并批量抓取、导出内容。"
          />
        </div>

        <div v-else-if="globalRowData.length === 0 && !loading">
          <EmptyStatePanel
            icon="i-lucide-file-search"
            title="这个账号还没有文章"
            description="可以先回到阅读页或账号页同步，再来这里做抓取和导出。"
          />
        </div>

        <div v-else class="h-full">
          <div
            ref="mobileListRef"
            class="h-full overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] md:hidden"
            @scroll.passive="onMobileListScroll"
          >
            <LoadingCards v-if="loading" />

            <div v-else class="space-y-3">
              <article
                v-for="article in globalRowData"
                :key="getArticleRowId(article)"
                class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900"
                :class="isArticleSelected(article) ? 'border-blue-300 ring-2 ring-blue-100' : ''"
                role="button"
                tabindex="0"
                @click="toggleArticleSelectionByClick(article)"
                @keydown.enter.prevent="toggleArticleSelectionByClick(article)"
                @keydown.space.prevent="toggleArticleSelectionByClick(article)"
              >
                <div class="flex items-start gap-3">
                  <input
                    :checked="isArticleSelected(article)"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    @click.stop
                    @change="toggleArticleSelectionFromInput(article)"
                  />

                  <div class="min-w-0 flex-1 space-y-3">
                    <div class="flex items-start gap-3">
                      <img
                        v-if="article.cover"
                        :src="article.cover"
                        alt=""
                        class="h-14 w-14 flex-shrink-0 rounded-2xl border border-slate-200 object-cover"
                      />
                      <div
                        v-else
                        class="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-400"
                      >
                        <UIcon name="i-lucide-image-off" />
                      </div>

                      <div class="min-w-0 flex-1 space-y-2">
                        <div class="flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            class="rounded-full px-2.5 py-1 font-medium"
                            :class="
                              article.contentDownload
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-500'
                            "
                          >
                            {{ article.contentDownload ? '内容已下载' : '内容未下载' }}
                          </span>
                          <span
                            class="rounded-full px-2.5 py-1 font-medium"
                            :class="
                              article.commentDownload
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-slate-100 text-slate-500'
                            "
                          >
                            {{ article.commentDownload ? '评论已下载' : '评论未下载' }}
                          </span>
                          <span
                            v-if="article.is_deleted"
                            class="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-700"
                          >
                            已删除
                          </span>
                        </div>

                        <h2 class="line-clamp-2 text-sm font-semibold leading-6 text-slate-800">
                          {{ article.title }}
                        </h2>

                        <div class="space-y-1 text-xs text-slate-500">
                          <p>作者：{{ article.author_name || '--' }}</p>
                          <p>发布时间：{{ article.update_time ? formatTimeStamp(article.update_time) : '--' }}</p>
                        </div>
                      </div>
                    </div>

                    <div class="grid grid-cols-4 gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500">
                      <div>
                        <p class="font-medium text-slate-700">{{ article.readNum || 0 }}</p>
                        <p>阅读</p>
                      </div>
                      <div>
                        <p class="font-medium text-slate-700">{{ article.oldLikeNum || 0 }}</p>
                        <p>点赞</p>
                      </div>
                      <div>
                        <p class="font-medium text-slate-700">{{ article.shareNum || 0 }}</p>
                        <p>分享</p>
                      </div>
                      <div>
                        <p class="font-medium text-slate-700">{{ article.commentNum || 0 }}</p>
                        <p>评论</p>
                      </div>
                    </div>

                    <p v-if="article.digest" class="line-clamp-3 text-xs leading-5 text-slate-600">
                      {{ article.digest }}
                    </p>

                    <div class="flex flex-wrap gap-2">
                      <UButton class="hidden md:inline-flex"
                        size="sm"
                        color="blue"
                        variant="soft"
                        :disabled="downloadBtnLoading"
                        @click.stop="download('html', [article.link])"
                      >
                        抓取内容
                      </UButton>
                      <UButton
                        size="sm"
                        color="white"
                        :disabled="!article.contentDownload"
                        @click.stop="preview(article)"
                      >
                        预览
                      </UButton>
                      <UButton size="sm" color="white" @click.stop="openOriginalArticle(article.link)">查看原文</UButton>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <div class="hidden h-full md:block">
            <ag-grid-vue
              style="width: 100%; height: 100%"
              :loading="loading"
              :rowData="globalRowData"
              :columnDefs="columnDefs"
              :gridOptions="gridOptions"
              @grid-ready="onGridReady"
              @filter-changed="onFilterChanged"
              @column-moved="onColumnStateChange"
              @column-visible="onColumnStateChange"
              @column-pinned="onColumnStateChange"
              @column-resized="onColumnStateChange"
              @selection-changed="onSelectionChanged"
            />
          </div>
        </div>
      </div>
    </div>

    <ScrollTopFab :visible="showScrollTop" @click="scrollMobileListToTop" />
    <PreviewArticle ref="previewArticleRef" />
  </div>
</template>
