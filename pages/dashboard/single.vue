<script setup lang="ts">
import {
  type ColDef,
  type GetRowIdParams,
  type GridApi,
  type GridOptions,
  type GridReadyEvent,
  type ICellRendererParams,
  type SelectionChangedEvent,
  themeQuartz,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import dayjs from 'dayjs';
import { onMounted } from 'vue';
import { formatElapsedTime, formatTimeStamp } from '#shared/utils/helpers';
import { request } from '#shared/utils/request';
import { websiteName } from '~/config';
import GridArticleActions from '~/components/grid/ArticleActions.vue';
import GridLoading from '~/components/grid/Loading.vue';
import GridNoRows from '~/components/grid/NoRows.vue';
import EmptyStatePanel from '~/components/mobile/EmptyStatePanel.vue';
import ScrollTopFab from '~/components/mobile/ScrollTopFab.vue';
import PreviewArticle from '~/components/preview/Article.vue';
import toastFactory from '~/composables/toast';
import { deleteHtmlCache, getHtmlCache } from '~/store/v2/html';
import type { AppMsgExWithFakeID } from '~/types/types';
import { Downloader } from '~/utils/download/Downloader';
import { Exporter } from '~/utils/download/Exporter';
import type { ArticleMetadata, DownloaderStatus } from '~/utils/download/types';

useHead({
  title: `单篇文章下载 | ${websiteName}`,
});

type ExportFormat = 'html' | 'excel' | 'json';

interface SingleArticleRow extends Partial<ArticleMetadata> {
  id: string;
  fakeid: string;
  link: string;
  title: string;
  author_name: string;
  digest: string;
  cover?: string;
  create_time: number;
  update_time: number;
  appmsgid: number;
  itemidx: number;
  aid: string;
  contentDownload: boolean;
  commentDownload: boolean;
  accountName?: string | null;
  downloading?: boolean;
}

const toast = toastFactory();
const inputUrl = ref('');
const rows = useLocalStorage<SingleArticleRow[]>('single-article:rows', []);
if (!rows.value) {
  rows.value = [];
}

const columnDefs = ref<ColDef[]>([
  {
    headerName: '标题',
    field: 'title',
    flex: 2,
    minWidth: 220,
    filter: 'agTextColumnFilter',
    tooltipField: 'title',
  },
  {
    headerName: '链接',
    field: 'link',
    flex: 3,
    minWidth: 240,
    cellRenderer: (params: ICellRendererParams<SingleArticleRow, string>) =>
      `<span class="text-xs font-mono break-all">${params.value}</span>`,
  },
  {
    headerName: '作者',
    field: 'author_name',
    flex: 1,
    minWidth: 140,
  },
  {
    headerName: '发布时间',
    field: 'update_time',
    flex: 1,
    minWidth: 160,
    valueFormatter: (params: ValueFormatterParams) => (params.value ? formatTimeStamp(params.value) : '--'),
  },
  {
    headerName: '内容已下载',
    field: 'contentDownload',
    minWidth: 140,
    cellRenderer: (params: ICellRendererParams<SingleArticleRow, boolean>) => {
      const row = params.data as SingleArticleRow;
      if (row.downloading) {
        return '<span class="px-2 py-1 rounded bg-yellow-100 text-yellow-700 text-xs">抓取中</span>';
      }
      return params.value
        ? '<span class="px-2 py-1 rounded bg-green-100 text-green-700 text-xs">是</span>'
        : '<span class="px-2 py-1 rounded bg-gray-100 text-gray-500 text-xs">否</span>';
    },
    filter: 'agSetColumnFilter',
    cellDataType: 'boolean',
  },
  {
    headerName: '操作',
    colId: 'single-action',
    field: 'link',
    sortable: false,
    filter: false,
    cellRenderer: GridArticleActions,
    cellRendererParams: {
      onPreview: (params: ICellRendererParams) => {
        previewRow(params.data as SingleArticleRow);
      },
      onGotoLink: (params: ICellRendererParams) => {
        window.open(params.value as string, '_blank', 'noopener');
      },
    },
    width: 110,
    pinned: 'right',
    cellClass: 'flex justify-center items-center',
  },
]);

const gridOptions: GridOptions = {
  rowSelection: {
    mode: 'multiRow',
    headerCheckbox: true,
    selectAll: 'filtered',
  },
  suppressContextMenu: true,
  animateRows: true,
  columnDefs: columnDefs.value,
  defaultColDef: {
    sortable: true,
    filter: true,
    flex: 1,
    minWidth: 120,
  },
  getRowId: (params: GetRowIdParams) => params.data.id,
  selectionColumnDef: {
    sortable: true,
    width: 80,
    pinned: 'left',
  },
  components: {
    agLoadingOverlay: GridLoading,
    agNoRowsOverlay: GridNoRows,
  },
  overlayLoadingTemplate: '<grid-loading />',
  overlayNoRowsTemplate: '<grid-no-rows />',
};

const gridApi = shallowRef<GridApi | null>(null);
const selectedRowIds = ref<string[]>([]);
const hasSelectedRows = computed(() => selectedRowIds.value.length > 0);
const selectedCount = computed(() => selectedRowIds.value.length);
const rowCount = computed(() => rows.value.length);
const previewArticleRef = ref<typeof PreviewArticle | null>(null);
const mobileListRef = ref<HTMLElement | null>(null);
const showScrollTop = ref(false);

const downloadBtnLoading = ref(false);
const exportBtnLoading = ref(false);
const exportPhase = ref('');
const downloadProgressCurrent = ref(0);
const downloadProgressTotal = ref(0);

const progressText = computed(() => {
  if (downloadProgressTotal.value > 0) {
    return `抓取进度 ${downloadProgressCurrent.value}/${downloadProgressTotal.value}`;
  }
  return `已添加 ${rowCount.value} 篇`;
});

function refreshGrid() {
  gridApi.value?.setGridOption('rowData', rows.value);
}

function onGridReady(event: GridReadyEvent) {
  gridApi.value = event.api;
  gridApi.value.setGridOption('rowData', rows.value);
  gridApi.value.setGridOption(
    'theme',
    themeQuartz.withParams({
      borderColor: '#e5e7eb',
      rowBorder: true,
      columnBorder: true,
      headerFontWeight: 600,
    })
  );
  if (selectedRowIds.value.length > 0) {
    const idSet = new Set(selectedRowIds.value);
    gridApi.value.forEachNode(node => {
      node.setSelected(idSet.has(String(node.data?.id)));
    });
  }
}

function onSelectionChanged(event: SelectionChangedEvent) {
  selectedRowIds.value = event.api.getSelectedRows().map(row => String((row as SingleArticleRow).id));
}

watch(
  rows,
  () => {
    refreshGrid();
    const rowIdSet = new Set(rows.value.map(row => row.id));
    selectedRowIds.value = selectedRowIds.value.filter(id => rowIdSet.has(id));
  },
  { deep: true }
);

watch(selectedRowIds, ids => {
  if (!gridApi.value) return;
  const idSet = new Set(ids);
  gridApi.value.forEachNode(node => {
    const shouldSelect = idSet.has(String(node.data?.id));
    if (node.isSelected() !== shouldSelect) {
      node.setSelected(shouldSelect);
    }
  });
});

onMounted(() => {
  rows.value.forEach(row => {
    upsertArticleStub(row);
  });
});

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('链接不能为空');
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const normalized = hasProtocol ? trimmed : `https://${trimmed}`;
  const parsed = new URL(normalized);
  if (parsed.hostname !== 'mp.weixin.qq.com') {
    throw new Error('请输入有效的公众号文章链接');
  }
  return parsed.toString();
}

function parseUrlParams(url: string) {
  const parsed = new URL(url);
  const params = parsed.searchParams;
  const fakeid = params.get('__biz') || 'SINGLE_ARTICLE_FAKEID';
  const mid = params.get('mid') || params.get('appmsgid') || `${Date.now()}`;
  const idx = params.get('idx') || params.get('itemidx') || '1';
  return { fakeid, mid: Number(mid), idx: Number(idx) || 1 };
}

function createRow(url: string): SingleArticleRow {
  const { fakeid, mid, idx } = parseUrlParams(url);
  const timestamp = dayjs().unix();
  const aid = `${mid}_${idx}`;
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return {
    id: generatedId,
    fakeid,
    link: url,
    title: '未命名文章',
    author_name: '--',
    digest: '',
    create_time: timestamp,
    update_time: timestamp,
    appmsgid: mid,
    itemidx: idx,
    aid,
    contentDownload: false,
    commentDownload: false,
    accountName: null,
  };
}

async function addArticle() {
  try {
    const normalized = normalizeUrl(inputUrl.value);
    if (rows.value.some(row => row.link === normalized)) {
      toast.info('提示', '该链接已存在列表中');
      return;
    }
    const row = createRow(normalized);
    rows.value = [row, ...rows.value];
    await upsertArticleStub(row);
    refreshGrid();
    inputUrl.value = '';
    await downloadRows([row], { silent: true });
  } catch (error: any) {
    toast.error('添加失败', error?.message || '链接格式不正确');
  }
}

function buildVirtualArticle(row: SingleArticleRow): AppMsgExWithFakeID {
  return {
    fakeid: row.fakeid,
    _status: '',
    aid: row.aid,
    album_id: '',
    appmsg_album_infos: [],
    appmsgid: row.appmsgid,
    author_name: row.author_name || '',
    ban_flag: 0,
    checking: 0,
    copyright_stat: 0,
    copyright_type: 0,
    cover: row.cover || '',
    cover_img: row.cover || '',
    cover_img_theme_color: undefined,
    create_time: row.create_time,
    digest: row.digest,
    has_red_packet_cover: 0,
    is_deleted: false,
    is_pay_subscribe: 0,
    item_show_type: 0,
    itemidx: row.itemidx,
    link: row.link,
    media_duration: '0:00',
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: row.cover || '',
    pic_cdn_url_3_4: row.cover || '',
    pic_cdn_url_16_9: row.cover || '',
    pic_cdn_url_235_1: row.cover || '',
    title: row.title,
    update_time: row.update_time,
  };
}

function upsertArticleStub(row: SingleArticleRow) {
  return request('/api/web/reader/article-upsert', {
    method: 'POST',
    body: {
      account: {
        fakeid: row.fakeid,
        nickname: row.accountName || '',
        total_count: 0,
      },
      articles: [buildVirtualArticle(row)],
      totalCount: 0,
      completed: false,
    },
  });
}

function getSelectedRows(): SingleArticleRow[] {
  const selectedIdSet = new Set(selectedRowIds.value);
  return rows.value.filter(row => selectedIdSet.has(row.id));
}

function isRowSelected(row: SingleArticleRow) {
  return selectedRowIds.value.includes(row.id);
}

function toggleRowSelection(row: SingleArticleRow, checked: boolean) {
  if (checked) {
    if (!selectedRowIds.value.includes(row.id)) {
      selectedRowIds.value = [...selectedRowIds.value, row.id];
    }
    return;
  }
  selectedRowIds.value = selectedRowIds.value.filter(id => id !== row.id);
}

function toggleRowSelectionByClick(row: SingleArticleRow) {
  toggleRowSelection(row, !isRowSelected(row));
}

function toggleRowSelectionFromInput(row: SingleArticleRow) {
  toggleRowSelection(row, !isRowSelected(row));
}

function onMobileListScroll() {
  showScrollTop.value = (mobileListRef.value?.scrollTop || 0) > 320;
}

function scrollMobileListToTop() {
  mobileListRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function downloadSelectedArticles() {
  await downloadRows(getSelectedRows());
}

async function downloadRows(targetRows: SingleArticleRow[], options: { silent?: boolean } = {}) {
  const { silent = false } = options;
  if (targetRows.length === 0) {
    if (!silent) {
      toast.info('提示', '请先选择至少一篇文章');
    }
    return;
  }

  await Promise.all(
    targetRows.map(async row => {
      row.downloading = true;
      persistRow(row);
      await upsertArticleStub(row);
    })
  );
  const urls = targetRows.map(row => row.link);
  const downloader = new Downloader(urls);

  downloader.on('download:begin', () => {
    downloadProgressCurrent.value = 0;
    downloadProgressTotal.value = urls.length;
    if (!silent) {
      downloadBtnLoading.value = true;
    }
  });

  downloader.on('download:progress', async (url: string, success: boolean, status: DownloaderStatus) => {
    downloadProgressCurrent.value = status.completed.length;
    if (success) {
      const row = rows.value.find(item => item.link === url);
      if (row) {
        row.contentDownload = true;
        row.downloading = false;
        await updateRowFromHtml(row);
        persistRow(row);
      }
    }
  });

  downloader.on('download:finish', (seconds: number, status: DownloaderStatus) => {
    if (!silent) {
      downloadBtnLoading.value = false;
    }
    downloadProgressCurrent.value = downloadProgressTotal.value;
    toast.success(
      '抓取完成',
      `耗时 ${formatElapsedTime(seconds)}，成功 ${status.completed.length}，失败 ${status.failed.length}`
    );
    downloadProgressCurrent.value = 0;
    downloadProgressTotal.value = 0;
  });

  downloader.on('download:deleted', (url: string) => {
    const row = rows.value.find(item => item.link === url);
    if (row) {
      row.contentDownload = false;
      row.title = `${row.title}（已删除）`;
      row.downloading = false;
      persistRow(row);
    }
  });

  try {
    await downloader.startDownload('html');
  } catch (error: any) {
    toast.error('抓取失败', error?.message || '请稍后再试');
  } finally {
    if (!silent) {
      downloadBtnLoading.value = false;
    }
    targetRows.forEach(row => {
      if (row.downloading) {
        row.downloading = false;
        persistRow(row);
      }
    });
    if (downloadProgressCurrent.value !== 0 && downloadProgressCurrent.value !== downloadProgressTotal.value) {
      downloadProgressCurrent.value = 0;
      downloadProgressTotal.value = 0;
    }
  }
}

async function updateRowFromHtml(row: SingleArticleRow) {
  const cache = await getHtmlCache(row.link);
  if (!cache) return;
  const html = await cache.file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('#activity-name')?.textContent?.trim();
  const author =
    doc.querySelector('#js_author_name')?.textContent?.trim() || doc.querySelector('#js_name')?.textContent?.trim();
  const digest = doc.querySelector('#js_content')?.textContent?.trim()?.slice(0, 160) || row.digest;
  const cover =
    doc.querySelector<HTMLImageElement>('#js_cover')?.getAttribute('data-src') ||
    doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.getAttribute('content') ||
    row.cover ||
    '';
  const publishText = doc.querySelector('#publish_time')?.textContent?.trim();
  const ctMatch = html.match(/var ct = "(?<ts>\d+)";/);

  if (title) row.title = title;
  if (author) row.author_name = author;
  row.accountName = doc.querySelector('#js_name')?.textContent?.trim() || row.accountName || null;
  row.digest = digest || '';
  row.cover = cover;

  if (ctMatch?.groups?.ts) {
    row.update_time = Number(ctMatch.groups.ts);
  } else if (publishText) {
    const parsed = dayjs(publishText);
    if (parsed.isValid()) {
      row.update_time = parsed.unix();
    }
  }

  await request('/api/web/reader/article-upsert', {
    method: 'POST',
    body: {
      account: {
        fakeid: row.fakeid,
        nickname: row.accountName || '',
        total_count: 0,
      },
      articles: [
        {
          ...buildVirtualArticle(row),
          digest: row.digest,
          cover,
          cover_img: cover,
          pic_cdn_url_1_1: cover,
          pic_cdn_url_3_4: cover,
          pic_cdn_url_16_9: cover,
          pic_cdn_url_235_1: cover,
        },
      ],
      totalCount: 0,
      completed: false,
    },
  });
}

function persistRow(row: SingleArticleRow) {
  rows.value = rows.value.map(item => (item.id === row.id ? { ...row } : item));
  const node = gridApi.value?.getRowNode(row.id);
  if (node) {
    node.updateData({ ...row });
  }
  refreshActionCells();
}

function previewRow(row: SingleArticleRow) {
  if (!row.contentDownload) {
    toast.warning('提示', '请先抓取该文章内容');
    return;
  }
  const article = buildVirtualArticle(row) as AppMsgExWithFakeID;
  previewArticleRef.value?.open(article);
}

async function handleExport(format: ExportFormat) {
  const selected = getSelectedRows();
  if (selected.length === 0) {
    toast.info('提示', '请先选择要导出的文章');
    return;
  }
  if (selected.some(row => !row.contentDownload)) {
    toast.warning('提示', '请先抓取所选文章的内容');
    return;
  }

  exportBtnLoading.value = true;
  exportPhase.value = format.toUpperCase();
  const exporter = new Exporter(selected.map(row => row.link));
  try {
    const exportType = format === 'html' ? 'html' : format === 'excel' ? 'excel' : 'json';
    await exporter.startExport(exportType);
    toast.success('导出成功', `已完成 ${format.toUpperCase()} 导出`);
  } catch (error: any) {
    toast.error('导出失败', error?.message || '请稍后再试');
  } finally {
    exportBtnLoading.value = false;
    exportPhase.value = '';
  }
}

async function deleteRowData(row: SingleArticleRow) {
  await request('/api/web/reader/article-remove', {
    method: 'POST',
    body: {
      url: row.link,
    },
  });
  await deleteHtmlCache(row.link);
}

async function removeRows() {
  const selected = getSelectedRows();
  if (selected.length === 0) {
    toast.info('提示', '请选择要移除的文章');
    return;
  }
  try {
    await Promise.all(selected.map(row => deleteRowData(row)));
    rows.value = rows.value.filter(row => !selected.some(sel => sel.id === row.id));
    gridApi.value?.deselectAll();
    refreshGrid();
    selectedRowIds.value = [];
    toast.success('移除成功', `已移除 ${selected.length} 篇文章`);
  } catch (error: any) {
    toast.error('移除失败', error?.message || '删除本地缓存时出错');
  }
}

function openOriginalArticle(row: SingleArticleRow) {
  window.open(row.link, '_blank', 'noopener');
}

function refreshActionCells() {
  gridApi.value?.refreshCells({
    force: true,
    columns: ['single-action'],
  });
}
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">单篇文章下载</h1>
    </Teleport>

    <div class="flex h-full flex-col divide-y divide-gray-200">
      <header class="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-slate-50/92 px-3 py-3 backdrop-blur md:static md:border-b-0 md:bg-transparent md:backdrop-blur-0">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex flex-1 flex-col gap-3 sm:flex-row">
            <UInput
              v-model="inputUrl"
              placeholder="请输入公众号文章链接"
              class="flex-1"
              @keyup.enter="addArticle"
            />
            <UButton size="sm" color="blue" class="justify-center" @click="addArticle">添加并抓取</UButton>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              class="hidden md:inline-flex"
              size="sm"
              color="blue"
              variant="soft"
              :disabled="!hasSelectedRows"
              :loading="downloadBtnLoading"
              @click="downloadSelectedArticles"
            >
              抓取选中
            </UButton>

            <ButtonGroup class="hidden md:inline-flex"
              :items="[
                { label: 'HTML', event: 'export-html' },
                { label: 'Excel', event: 'export-excel' },
                { label: 'JSON', event: 'export-json' },
              ]"
              @export-html="() => handleExport('html')"
              @export-excel="() => handleExport('excel')"
              @export-json="() => handleExport('json')"
            >
              <UButton
                size="sm"
                :loading="exportBtnLoading"
                :disabled="!hasSelectedRows"
                color="white"
                class="font-mono"
                :label="exportBtnLoading ? `${exportPhase} 导出中` : '导出'"
                trailing-icon="i-heroicons-chevron-down-20-solid"
              />
            </ButtonGroup>

            <UButton size="sm" color="rose" variant="soft" :disabled="!hasSelectedRows" @click="removeRows">移除</UButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span class="rounded-full bg-slate-100 px-3 py-1">{{ progressText }}</span>
          <span class="rounded-full bg-blue-50 px-3 py-1 text-blue-600">已选择 {{ selectedCount }} 篇</span>
        </div>
      </header>

      <div class="min-h-0 flex-1">
        <div v-if="rows.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <EmptyStatePanel
            icon="i-mingcute-link-line"
            title="还没有单篇文章"
            description="粘贴公众号文章链接后，会自动抓取内容并加入本地列表。"
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
                v-for="row in rows"
                :key="row.id"
                class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900"
                :class="isRowSelected(row) ? 'border-blue-300 ring-2 ring-blue-100' : ''"
                role="button"
                tabindex="0"
                @click="toggleRowSelectionByClick(row)"
                @keydown.enter.prevent="toggleRowSelectionByClick(row)"
                @keydown.space.prevent="toggleRowSelectionByClick(row)"
              >
                <div class="flex items-start gap-3">
                  <input
                    :checked="isRowSelected(row)"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    @click.stop
                    @change="toggleRowSelectionFromInput(row)"
                  />

                  <div class="min-w-0 flex-1 space-y-3">
                    <div class="space-y-2">
                      <div class="flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          class="rounded-full px-2.5 py-1 font-medium"
                          :class="
                            row.downloading
                              ? 'bg-yellow-100 text-yellow-700'
                              : row.contentDownload
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-500'
                          "
                        >
                          {{ row.downloading ? '抓取中' : row.contentDownload ? '已抓取' : '未抓取' }}
                        </span>
                        <span v-if="row.accountName" class="rounded-full bg-sky-50 px-2.5 py-1 text-sky-600">
                          {{ row.accountName }}
                        </span>
                      </div>

                      <h2 class="line-clamp-2 text-sm font-semibold leading-6 text-slate-800">
                        {{ row.title || '未命名文章' }}
                      </h2>
                    </div>

                    <div class="space-y-1 text-xs leading-5 text-slate-500">
                      <p>作者：{{ row.author_name || '--' }}</p>
                      <p>发布时间：{{ row.update_time ? formatTimeStamp(row.update_time) : '--' }}</p>
                      <p class="line-clamp-2 break-all font-mono text-[11px] text-slate-400">{{ row.link }}</p>
                    </div>

                    <p v-if="row.digest" class="line-clamp-3 text-xs leading-5 text-slate-600">
                      {{ row.digest }}
                    </p>

                    <div class="flex flex-wrap gap-2">
                      <UButton
                        class="hidden md:inline-flex"
                        size="sm"
                        color="blue"
                        variant="soft"
                        :loading="row.downloading"
                        @click.stop="downloadRows([row])"
                      >
                        {{ row.contentDownload ? '重新抓取' : '抓取内容' }}
                      </UButton>
                      <UButton size="sm" color="white" @click.stop="openOriginalArticle(row)">查看原文</UButton>
                      <UButton
                        size="sm"
                        color="white"
                        :disabled="!row.contentDownload"
                        @click.stop="previewRow(row)"
                      >
                        预览
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
              class="ag-theme-quartz"
              :columnDefs="columnDefs"
              :gridOptions="gridOptions"
              @grid-ready="onGridReady"
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
