<template>
  <div class="iframe-html-renderer relative">
    <iframe
      ref="iframeRef"
      class="block w-full border-0 bg-transparent"
      :style="iframeStyle"
      :srcdoc="preparedHtml"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      scrolling="no"
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="handleLoad"
    />
  </div>
  <Teleport to="body">
    <div
      v-if="showFloatingSearchButton"
      class="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-4 z-[90] md:right-6"
    >
      <UButton
        size="sm"
        color="gray"
        variant="solid"
        icon="i-lucide:search"
        class="iframe-search-fab pointer-events-auto"
        @click="openSearchPanel"
      />
    </div>

    <div
      v-if="showFloatingSearchPanel"
      class="pointer-events-none fixed inset-x-0 bottom-0 z-[95] flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-6"
    >
      <div
        class="pointer-events-auto flex w-full max-w-[42rem] items-center gap-2 rounded-[26px] border border-slate-200/85 bg-white/96 px-3 py-3 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700/85 dark:bg-slate-950/94"
      >
        <input
          ref="searchInputRef"
          v-model="searchKeyword"
          type="search"
          placeholder="搜索正文关键词"
          class="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-500 md:text-sm"
          @keydown="handleSearchInputKeydown"
        />
        <span class="min-w-[3.5rem] text-right text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {{ searchStatusLabel }}
        </span>
        <UButton
          size="2xs"
          color="gray"
          variant="ghost"
          icon="i-lucide:chevron-up"
          :disabled="searchMatches.length === 0"
          @click="focusPreviousSearchMatch"
        />
        <UButton
          size="2xs"
          color="gray"
          variant="ghost"
          icon="i-lucide:chevron-down"
          :disabled="searchMatches.length === 0"
          @click="focusNextSearchMatch"
        />
        <UButton size="2xs" color="gray" variant="ghost" icon="i-lucide:x" @click="closeSearchPanel" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import type { NitroFetchRequest } from 'nitropack';
import usePreferences from '~/composables/usePreferences';
import usePreferencesCapabilities from '~/composables/usePreferencesCapabilities';
import type { Preferences } from '~/types/preferences';

interface Props {
  html: string;
  contentKind?: 'default' | 'rss' | 'report';
  searchable?: boolean;
}

interface MpVideoInfoResponse {
  videos?: Record<string, { src: string; poster?: string }>;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (event: 'open-article-link', link: string): void;
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const preferences = usePreferences() as unknown as Ref<Preferences>;
const preferenceCapabilities = usePreferencesCapabilities();
const fetcher = $fetch as <T>(request: NitroFetchRequest, options?: Record<string, any>) => Promise<T>;
const preparedHtml = ref('');
const searchPanelOpen = ref(false);
const searchKeyword = ref('');
const searchMatches = ref<HTMLElement[]>([]);
const activeSearchMatchIndex = ref(-1);
const searchInputRef = ref<HTMLInputElement | null>(null);
const rendererVisible = ref(false);
const iframeStyle = {
  backgroundColor: '#ffffff',
};
let resizeObserver: ResizeObserver | null = null;
let prepareRequestId = 0;
let galleryCleanupFns: Array<() => void> = [];

const VIDEO_PROXY_HOSTS = [
  'mp.weixin.qq.com',
  'mpvideo.qpic.cn',
  'mmbiz.qpic.cn',
  'res.wx.qq.com',
  'puui.qpic.cn',
  'vpic.cn',
];

const searchable = computed(() => Boolean(props.searchable));
const showFloatingSearchButton = computed(() => searchable.value && rendererVisible.value && !searchPanelOpen.value);
const showFloatingSearchPanel = computed(() => searchable.value && rendererVisible.value && searchPanelOpen.value);
const searchStatusLabel = computed(() => {
  const keyword = searchKeyword.value.trim();
  if (!keyword) {
    return '输入后搜索';
  }

  if (searchMatches.value.length === 0) {
    return '无结果';
  }

  return `${activeSearchMatchIndex.value + 1}/${searchMatches.value.length}`;
});

function syncRendererVisibility(): void {
  const iframe = iframeRef.value;
  if (!iframe || typeof window === 'undefined') {
    rendererVisible.value = false;
    return;
  }

  const styles = window.getComputedStyle(iframe);
  const rect = iframe.getBoundingClientRect();
  rendererVisible.value =
    styles.display !== 'none' && styles.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function buildSrcdoc(html: string): string {
  const sanitized = DOMPurify.sanitize(html || '', {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['iframe', 'video', 'audio', 'source'],
    ADD_ATTR: [
      'allow',
      'allowfullscreen',
      'controls',
      'controlslist',
      'crossorigin',
      'poster',
      'preload',
      'frameborder',
      'playsinline',
      'webkit-playsinline',
      'muted',
      'loop',
      'autoplay',
      'srcdoc',
      'src',
      'type',
      'scrolling',
      'target',
      'rel',
      'data-src',
      'data-mpvid',
      'sandbox',
      'referrerpolicy',
    ],
  });

  const hasHead = /<head[\s>]/i.test(sanitized);
  const hasBody = /<body[\s>]/i.test(sanitized);
  const baseMarkup = '<base target="_blank" />';
  const styleMarkup = `
    <style>
      *, *::before, *::after {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      body {
        overflow-x: hidden;
        max-width: 100%;
        -webkit-text-size-adjust: 100%;
        overflow-wrap: break-word;
        color: #0f172a;
      }
      html,
      body {
        background: #ffffff !important;
        color-scheme: light;
      }
      body > * {
        max-width: 100%;
      }
      body[data-renderer-kind="rss"] {
        padding: 0 clamp(16px, 3.4vw, 28px) 1.75rem;
      }
      body[data-renderer-kind="report"] {
        padding: 0 clamp(16px, 3.8vw, 32px) 2rem;
        color: #0f172a;
      }
      .ai-daily-report {
        width: min(100%, 920px);
        margin: 0 auto;
        padding: clamp(20px, 3.6vw, 32px);
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 28px;
        background: #ffffff;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
        color: #0f172a;
      }
      .ai-daily-report-empty {
        margin: 0;
        color: #64748b;
      }
      .ai-daily-report > :first-child {
        margin-top: 0;
      }
      .ai-daily-report > :last-child {
        margin-bottom: 0;
      }
      .ai-daily-report section + section,
      .ai-daily-report article + article,
      .ai-daily-report .section + .section {
        margin-top: 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid rgba(226, 232, 240, 0.9);
      }
      .ai-daily-report h1,
      .ai-daily-report h2,
      .ai-daily-report h3,
      .ai-daily-report h4 {
        margin: 1.25rem 0 0.75rem;
        color: #0f172a;
        line-height: 1.3;
        font-weight: 700;
      }
      .ai-daily-report h1 {
        font-size: clamp(1.5rem, 3vw, 2rem);
      }
      .ai-daily-report h2 {
        font-size: clamp(1.2rem, 2.3vw, 1.45rem);
      }
      .ai-daily-report h3 {
        font-size: clamp(1.05rem, 2vw, 1.2rem);
      }
      .ai-daily-report p,
      .ai-daily-report li {
        color: #334155;
        font-size: 15px;
        line-height: 1.85;
      }
      .ai-daily-report p {
        margin: 0.9rem 0;
      }
      .ai-daily-report ul,
      .ai-daily-report ol {
        margin: 0.85rem 0;
        padding-left: 1.25rem;
      }
      .ai-daily-report li + li {
        margin-top: 0.45rem;
      }
      .ai-daily-report strong {
        color: #0f172a;
        font-weight: 700;
      }
      .ai-daily-report blockquote {
        margin: 1rem 0;
        padding: 0.9rem 1rem;
        border-left: 3px solid #38bdf8;
        border-radius: 14px;
        background: #f8fafc;
        color: #475569;
      }
      .ai-daily-report hr {
        margin: 1.4rem 0;
        border: 0;
        border-top: 1px solid rgba(226, 232, 240, 0.9);
      }
      .ai-daily-report a {
        color: #2563eb;
        text-decoration: none;
      }
      .ai-daily-report a:hover {
        text-decoration: underline;
      }
      .ai-daily-report-header {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .ai-daily-report-title {
        margin: 0;
        font-size: clamp(1.45rem, 3vw, 2rem);
        line-height: 1.25;
      }
      .ai-daily-report-meta {
        margin: 0;
        color: #64748b;
        font-size: 0.88rem;
        line-height: 1.6;
      }
      .ai-daily-report-body > :first-child,
      .ai-daily-report-sources > :first-child {
        margin-top: 0;
      }
      .ai-daily-report-body > :last-child,
      .ai-daily-report-sources > :last-child {
        margin-bottom: 0;
      }
      .ai-daily-report-source-list {
        margin: 0.9rem 0 0;
        padding-left: 1.25rem;
      }
      .ai-daily-report-source-item + .ai-daily-report-source-item {
        margin-top: 0.65rem;
      }
      .ai-daily-report-source-link {
        display: inline-block;
        color: #0f172a;
        font-size: 0.98rem;
        font-weight: 600;
        line-height: 1.65;
        text-decoration: none;
      }
      .ai-daily-report-source-link:hover {
        color: #2563eb;
        text-decoration: underline;
      }
      .ai-daily-report-source-meta {
        margin: 0.15rem 0 0;
        color: #64748b;
        font-size: 0.84rem;
        line-height: 1.55;
      }
      .ai-daily-report-overview {
        margin-bottom: 1.5rem;
      }
      .ai-daily-report-entries {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .ai-daily-report-entry {
        padding: 1rem 1.05rem;
        border: 1px solid rgba(226, 232, 240, 0.95);
        border-radius: 22px;
        background: #f8fafc;
      }
      .ai-daily-report-entry-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
      }
      .ai-daily-report-entry-heading {
        min-width: 0;
        flex: 1;
      }
      .ai-daily-report-entry-title {
        margin: 0;
        font-size: 1rem;
        line-height: 1.45;
      }
      .ai-daily-report-entry-meta {
        margin: 0.4rem 0 0;
        color: #64748b;
        font-size: 0.82rem;
        line-height: 1.5;
      }
      .ai-daily-report-entry-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 0.6rem;
      }
      .ai-daily-report-entry-tag {
        display: inline-flex;
        align-items: center;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        background: rgba(226, 232, 240, 0.95);
        color: #334155;
        font-size: 0.74rem;
        font-weight: 600;
        line-height: 1.2;
      }
      .ai-daily-report-entry-link {
        flex-shrink: 0;
        white-space: nowrap;
        padding: 0.42rem 0.8rem;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
        font-size: 0.82rem;
        font-weight: 600;
        text-decoration: none;
      }
      .ai-daily-report-entry-summary {
        margin: 0.9rem 0 0;
      }
      .ai-daily-report code {
        padding: 0.15rem 0.35rem;
        border-radius: 8px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 0.92em;
      }
      .ai-daily-report pre {
        margin: 1rem 0;
        padding: 1rem 1.1rem;
        border-radius: 18px;
        background: #0f172a;
        color: #e2e8f0;
      }
      .ai-daily-report pre code {
        padding: 0;
        background: transparent;
        color: inherit;
      }
      img, video, iframe, audio {
        max-width: 100%;
      }
      img {
        display: block;
        width: auto !important;
        max-width: 100% !important;
        height: auto !important;
        margin-inline: auto;
      }
      picture,
      figure,
      .image-wrapper,
      .img-wrapper,
      .img_container,
      .img-box,
      .kg-image-card,
      .wp-caption,
      .rich_media_content img {
        max-width: 100% !important;
      }
      figure,
      .image-wrapper,
      .img-wrapper,
      .img_container,
      .img-box,
      .kg-image-card,
      .wp-caption {
        width: 100% !important;
        margin-inline: auto;
      }
      figure img,
      .image-wrapper img,
      .img-wrapper img,
      .img_container img,
      .img-box img,
      .kg-image-card img,
      .wp-caption img {
        max-width: 100% !important;
      }
      video {
        display: block;
        width: 100%;
        height: auto;
        background: #000;
      }
      body audio {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-height: 40px !important;
        margin: 1rem 0 !important;
      }
      table {
        max-width: none;
        border-collapse: collapse;
      }
      .iframe-table-wrap {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .iframe-table-wrap > table {
        min-width: 100%;
        width: max-content !important;
        max-width: none !important;
      }
      .iframe-table-wrap + .iframe-table-wrap {
        margin-top: 0.75rem;
      }
      pre {
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      td, th {
        word-break: break-word;
      }
      [data-iframe-search-match="true"] {
        border-radius: 0.22em;
        background: rgba(250, 204, 21, 0.32);
        box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.12);
        scroll-margin-top: 96px;
      }
      [data-iframe-search-match="true"][data-iframe-search-current="true"] {
        background: rgba(249, 115, 22, 0.34);
        box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.28);
      }
    </style>
  `;

  const bodyKindAttr = props.contentKind !== 'default' ? ` data-renderer-kind="${props.contentKind}"` : '';

  if (hasHead) {
    const withBase = sanitized.replace(/<head([^>]*)>/i, `<head$1>${baseMarkup}`);
    const withHead = withBase.replace(/<\/head>/i, `${styleMarkup}</head>`);
    if (!hasBody) {
      return withHead;
    }

    return withHead.replace(/<body([^>]*)>/i, `<body$1${bodyKindAttr}>`);
  }

  return `<!doctype html><html><head>${baseMarkup}${styleMarkup}</head><body${bodyKindAttr}>${sanitized}</body></html>`;
}

function shouldProxyVideoUrl(url: string): boolean {
  if (!url || typeof window === 'undefined') {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return false;
    }

    return VIDEO_PROXY_HOSTS.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function buildPrivateProxyUrl(url: string): string {
  if (!preferenceCapabilities.value.privateProxyConfigured || !shouldProxyVideoUrl(url)) {
    return url;
  }

  const headers: Record<string, string> = {
    Referer: 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
  };

  const query = new URLSearchParams({
    url,
    headers: JSON.stringify(headers),
  });
  return `/api/web/proxy/fetch?${query.toString()}`;
}

async function refreshMpVideos(doc: Document): Promise<void> {
  const videoElements = Array.from(doc.querySelectorAll('video[data-mpvid]'));
  if (videoElements.length === 0) {
    return;
  }

  const articleUrl = doc.querySelector('meta[name="wechat-article-url"]')?.getAttribute('content')?.trim();
  if (!articleUrl) {
    return;
  }

  const videoIds = [...new Set(videoElements.map(video => video.getAttribute('data-mpvid') || '').filter(Boolean))];
  if (videoIds.length === 0) {
    return;
  }

  try {
    const response = await fetcher<MpVideoInfoResponse>('/api/public/v1/mpvideo-info', {
      query: {
        url: articleUrl,
        vids: videoIds.join(','),
      },
    });

    const videos = response?.videos || {};
    videoElements.forEach(video => {
      const videoId = video.getAttribute('data-mpvid') || '';
      const info = videos[videoId];
      if (!info) {
        return;
      }

      if (info.src) {
        video.setAttribute('src', info.src);
      }
      if (info.poster) {
        video.setAttribute('poster', info.poster);
      }
    });
  } catch (error) {
    console.warn('mpvideo refresh failed:', error);
  }
}

function rewriteMediaUrls(doc: Document): void {
  doc.querySelectorAll('video[src], audio[src], source[src]').forEach(node => {
    const src = node.getAttribute('src') || '';
    if (!src) {
      return;
    }

    node.setAttribute('src', buildPrivateProxyUrl(src));
  });

  doc.querySelectorAll('video[poster]').forEach(node => {
    const poster = node.getAttribute('poster') || '';
    if (!poster) {
      return;
    }

    node.setAttribute('poster', buildPrivateProxyUrl(poster));
  });
}

function wrapResponsiveTables(doc: Document): void {
  doc.querySelectorAll('table').forEach(table => {
    if (table.closest('.iframe-table-wrap')) {
      return;
    }

    if (table.parentElement?.closest('td, th')) {
      return;
    }

    const parent = table.parentElement;
    if (!parent) {
      return;
    }

    const wrapper = doc.createElement('div');
    wrapper.className = 'iframe-table-wrap';
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

async function buildPreparedHtml(html: string): Promise<string> {
  if (!html || typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return buildSrcdoc(html);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  await refreshMpVideos(doc);
  rewriteMediaUrls(doc);
  wrapResponsiveTables(doc);

  return buildSrcdoc('<!doctype html>\n' + doc.documentElement.outerHTML);
}

async function refreshPreparedHtml(): Promise<void> {
  const requestId = ++prepareRequestId;
  const nextHtml = await buildPreparedHtml(props.html);
  if (requestId !== prepareRequestId) {
    return;
  }

  preparedHtml.value = nextHtml;
}

function updateHeight(): void {
  const iframe = iframeRef.value;
  const doc = iframe?.contentDocument;
  if (!iframe || !doc) {
    return;
  }

  const nextHeight = Math.max(
    doc.documentElement?.scrollHeight || 0,
    doc.body?.scrollHeight || 0,
    doc.documentElement?.offsetHeight || 0,
    doc.body?.offsetHeight || 0,
    320
  );

  iframe.style.height = `${nextHeight}px`;
}

function disconnectResizeObserver(): void {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

function isSearchExcludedNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  if (!String(node.textContent || '').trim()) {
    return true;
  }

  if (
    parent.closest(
      'script, style, noscript, textarea, input, select, button, option, [data-iframe-search-match="true"]'
    )
  ) {
    return true;
  }

  return false;
}

function clearSearchHighlights(doc: Document | null = iframeRef.value?.contentDocument || null): void {
  if (!doc) {
    searchMatches.value = [];
    activeSearchMatchIndex.value = -1;
    return;
  }

  const parents = new Set<Node>();
  doc.querySelectorAll<HTMLElement>('[data-iframe-search-match="true"]').forEach(match => {
    const parent = match.parentNode;
    if (!parent) {
      return;
    }

    parents.add(parent);
    parent.replaceChild(doc.createTextNode(match.textContent || ''), match);
  });

  parents.forEach(parent => {
    parent.normalize();
  });

  searchMatches.value = [];
  activeSearchMatchIndex.value = -1;
}

function collectSearchMatches(doc: Document, keyword: string): HTMLElement[] {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword || !doc.body) {
    return [];
  }

  const keywordLower = normalizedKeyword.toLocaleLowerCase();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const currentNode = walker.currentNode as Text;
    if (!isSearchExcludedNode(currentNode)) {
      textNodes.push(currentNode);
    }
  }

  const matches: HTMLElement[] = [];

  textNodes.forEach(node => {
    const originalText = String(node.textContent || '');
    const lowerText = originalText.toLocaleLowerCase();
    let searchStart = 0;
    let matchIndex = lowerText.indexOf(keywordLower, searchStart);

    if (matchIndex === -1) {
      return;
    }

    const fragment = doc.createDocumentFragment();

    while (matchIndex !== -1) {
      if (matchIndex > searchStart) {
        fragment.append(doc.createTextNode(originalText.slice(searchStart, matchIndex)));
      }

      const highlight = doc.createElement('span');
      highlight.setAttribute('data-iframe-search-match', 'true');
      highlight.textContent = originalText.slice(matchIndex, matchIndex + normalizedKeyword.length);
      fragment.append(highlight);
      matches.push(highlight);

      searchStart = matchIndex + normalizedKeyword.length;
      matchIndex = lowerText.indexOf(keywordLower, searchStart);
    }

    if (searchStart < originalText.length) {
      fragment.append(doc.createTextNode(originalText.slice(searchStart)));
    }

    node.parentNode?.replaceChild(fragment, node);
  });

  return matches;
}

function findScrollableAncestor(element: HTMLElement): HTMLElement | Window {
  let current = element.parentElement;
  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY || styles.overflow;
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 1) {
      return current;
    }
    current = current.parentElement;
  }

  return window;
}

function scrollMatchIntoView(match: HTMLElement): void {
  const iframe = iframeRef.value;
  if (!iframe) {
    return;
  }

  const iframeRect = iframe.getBoundingClientRect();
  const matchRect = match.getBoundingClientRect();
  const offsetTop = 88;
  const scrollTarget = findScrollableAncestor(iframe);

  if (scrollTarget === window) {
    const nextTop = window.scrollY + iframeRect.top + matchRect.top - offsetTop;
    window.scrollTo({
      top: Math.max(nextTop, 0),
      behavior: 'smooth',
    });
    return;
  }

  const container = scrollTarget as HTMLElement;
  const containerRect = container.getBoundingClientRect();
  const nextTop = container.scrollTop + (iframeRect.top - containerRect.top) + matchRect.top - offsetTop;
  container.scrollTo({
    top: Math.max(nextTop, 0),
    behavior: 'smooth',
  });
}

function setActiveSearchMatch(index: number, options: { scroll?: boolean } = {}): void {
  if (searchMatches.value.length === 0) {
    activeSearchMatchIndex.value = -1;
    return;
  }

  const total = searchMatches.value.length;
  const nextIndex = ((index % total) + total) % total;
  activeSearchMatchIndex.value = nextIndex;

  searchMatches.value.forEach((match, matchIndex) => {
    if (matchIndex === nextIndex) {
      match.setAttribute('data-iframe-search-current', 'true');
    } else {
      match.removeAttribute('data-iframe-search-current');
    }
  });

  if (options.scroll !== false) {
    scrollMatchIntoView(searchMatches.value[nextIndex]);
  }
}

function applySearch(keyword: string): void {
  const doc = iframeRef.value?.contentDocument || null;
  clearSearchHighlights(doc);

  if (!searchable.value || !doc) {
    return;
  }

  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    updateHeight();
    return;
  }

  searchMatches.value = collectSearchMatches(doc, normalizedKeyword);
  if (searchMatches.value.length > 0) {
    setActiveSearchMatch(0);
  } else {
    activeSearchMatchIndex.value = -1;
  }

  updateHeight();
}

function focusNextSearchMatch(): void {
  if (searchMatches.value.length === 0) {
    return;
  }

  setActiveSearchMatch(activeSearchMatchIndex.value + 1);
}

function focusPreviousSearchMatch(): void {
  if (searchMatches.value.length === 0) {
    return;
  }

  setActiveSearchMatch(activeSearchMatchIndex.value - 1);
}

function openSearchPanel(): void {
  if (!searchable.value) {
    return;
  }

  searchPanelOpen.value = true;
  nextTick(() => {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  });
}

function closeSearchPanel(): void {
  searchPanelOpen.value = false;
  searchKeyword.value = '';
  clearSearchHighlights();
  updateHeight();
}

function handleSearchInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      focusPreviousSearchMatch();
      return;
    }
    focusNextSearchMatch();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeSearchPanel();
  }
}

function bindResizeObserver(): void {
  disconnectResizeObserver();
  const doc = iframeRef.value?.contentDocument;
  if (!doc || typeof ResizeObserver === 'undefined') {
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    updateHeight();
  });

  if (doc.documentElement) {
    resizeObserver.observe(doc.documentElement);
  }
  if (doc.body) {
    resizeObserver.observe(doc.body);
  }
}

function clearGalleryInteractions(): void {
  galleryCleanupFns.forEach(cleanup => cleanup());
  galleryCleanupFns = [];
}

function getGalleryDots(track: HTMLElement): HTMLElement[] {
  return Array.from(track.parentElement?.querySelectorAll<HTMLElement>('.dynamic-fallback-gallery-dot') || []);
}

function getGalleryIndex(track: HTMLElement, total: number): number {
  if (total <= 0) {
    return 0;
  }

  const slideWidth = track.clientWidth || 1;
  return Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / slideWidth)));
}

function syncGalleryIndicators(track: HTMLElement): void {
  const dots = getGalleryDots(track);
  if (dots.length === 0) {
    return;
  }

  const nextIndex = getGalleryIndex(track, dots.length);
  dots.forEach((dot, index) => {
    dot.classList.toggle('is-active', index === nextIndex);
  });
}

function scrollGalleryToIndex(track: HTMLElement, nextIndex: number, behavior: ScrollBehavior = 'smooth'): void {
  const slideWidth = track.clientWidth || 0;
  if (!slideWidth) {
    return;
  }

  track.scrollTo({ left: slideWidth * nextIndex, behavior });
  syncGalleryIndicators(track);
}

function snapGalleryToNearestSlide(track: HTMLElement): void {
  const total = track.children.length;
  if (total <= 0) {
    return;
  }

  scrollGalleryToIndex(track, getGalleryIndex(track, total));
}

function bindGalleryInteractions(doc: Document): void {
  clearGalleryInteractions();

  doc.querySelectorAll<HTMLElement>('.dynamic-fallback-gallery-track').forEach(track => {
    const dots = getGalleryDots(track);
    const total = Math.max(track.children.length, dots.length);

    let pointerId: number | null = null;
    let startX = 0;
    let startScrollLeft = 0;
    let dragging = false;
    let suppressClick = false;
    let lastWheelAt = 0;

    const focusTrack = () => {
      if (doc.activeElement === track) {
        return;
      }

      track.focus({ preventScroll: true });
    };

    const moveGallery = (offset: number, behavior: ScrollBehavior = 'smooth'): boolean => {
      if (total <= 1 || offset === 0) {
        return false;
      }

      const currentIndex = getGalleryIndex(track, total);
      const nextIndex = Math.max(0, Math.min(total - 1, currentIndex + offset));
      if (nextIndex === currentIndex) {
        return false;
      }

      scrollGalleryToIndex(track, nextIndex, behavior);
      return true;
    };

    const onScroll = () => {
      syncGalleryIndicators(track);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) {
        return;
      }

      focusTrack();
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = track.scrollLeft;
      dragging = false;
      suppressClick = false;
      track.classList.add('is-dragging');

      try {
        track.setPointerCapture(event.pointerId);
      } catch {
        // ignore unsupported pointer capture
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - startX;
      if (!dragging && Math.abs(deltaX) > 4) {
        dragging = true;
        suppressClick = true;
      }

      if (!dragging) {
        return;
      }

      track.scrollLeft = startScrollLeft - deltaX;
      syncGalleryIndicators(track);
      event.preventDefault();
    };

    const stopDragging = (event?: PointerEvent) => {
      if (pointerId == null) {
        return;
      }

      const activePointerId = pointerId;
      pointerId = null;
      track.classList.remove('is-dragging');

      try {
        track.releasePointerCapture(event?.pointerId ?? activePointerId);
      } catch {
        // ignore unsupported pointer capture
      }

      if (dragging) {
        snapGalleryToNearestSlide(track);
      } else {
        syncGalleryIndicators(track);
      }

      dragging = false;
      if (suppressClick) {
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    };

    const onPointerEnter = () => {
      focusTrack();
    };

    const onWheel = (event: WheelEvent) => {
      if (total <= 1) {
        return;
      }

      const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(dominantDelta) < 12) {
        return;
      }

      const now = Date.now();
      if (now - lastWheelAt < 280) {
        event.preventDefault();
        return;
      }

      const moved = moveGallery(dominantDelta > 0 ? 1 : -1);
      if (!moved) {
        return;
      }

      focusTrack();
      lastWheelAt = now;
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      let offset = 0;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        offset = -1;
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        offset = 1;
      }

      if (!offset) {
        return;
      }

      if (!moveGallery(offset)) {
        return;
      }

      event.preventDefault();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerenter', onPointerEnter);
    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', stopDragging);
    track.addEventListener('pointercancel', stopDragging);
    track.addEventListener('wheel', onWheel, { passive: false });
    track.addEventListener('keydown', onKeyDown);
    track.addEventListener('click', onClickCapture, true);

    dots.forEach((dot, index) => {
      const onDotClick = () => {
        focusTrack();
        scrollGalleryToIndex(track, index);
      };

      dot.addEventListener('click', onDotClick);
      galleryCleanupFns.push(() => {
        dot.removeEventListener('click', onDotClick);
      });
    });

    track.scrollTo({ left: 0, behavior: 'auto' });
    syncGalleryIndicators(track);

    galleryCleanupFns.push(() => {
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerenter', onPointerEnter);
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', stopDragging);
      track.removeEventListener('pointercancel', stopDragging);
      track.removeEventListener('wheel', onWheel);
      track.removeEventListener('keydown', onKeyDown);
      track.removeEventListener('click', onClickCapture, true);
    });
  });
}

function bindReaderArticleLinkInteractions(doc: Document): void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('a[data-reader-article-link]') as HTMLAnchorElement | null;
    const link = String(anchor?.getAttribute('data-reader-article-link') || '').trim();
    if (!anchor || !link) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    emit('open-article-link', link);
  };

  doc.addEventListener('click', onClick, true);
  galleryCleanupFns.push(() => {
    doc.removeEventListener('click', onClick, true);
  });
}

function handleLoad(): void {
  nextTick(() => {
    syncRendererVisibility();
    updateHeight();
    bindResizeObserver();
    const doc = iframeRef.value?.contentDocument;
    if (doc) {
      bindGalleryInteractions(doc);
      bindReaderArticleLinkInteractions(doc);
      if (searchable.value && searchKeyword.value.trim()) {
        applySearch(searchKeyword.value);
      }
    }
  });
}

watch(preparedHtml, async () => {
  await nextTick();
  syncRendererVisibility();
  updateHeight();
});

watch(searchKeyword, keyword => {
  if (!searchPanelOpen.value) {
    return;
  }

  applySearch(keyword);
});

watch(
  () => props.html,
  () => {
    searchPanelOpen.value = false;
    searchKeyword.value = '';
    clearSearchHighlights();
    nextTick(() => {
      syncRendererVisibility();
    });
  }
);

watch(
  () => props.searchable,
  () => {
    if (!props.searchable) {
      closeSearchPanel();
    }

    nextTick(() => {
      syncRendererVisibility();
    });
  }
);

watch(
  [() => props.html, () => preferenceCapabilities.value.privateProxyConfigured],
  () => {
    void refreshPreparedHtml();
  },
  {
    deep: true,
    immediate: true,
  }
);

onMounted(() => {
  syncRendererVisibility();
  window.addEventListener('resize', updateHeight);
  window.addEventListener('resize', syncRendererVisibility);
  window.visualViewport?.addEventListener('resize', updateHeight);
  window.visualViewport?.addEventListener('resize', syncRendererVisibility);
});

onUnmounted(() => {
  clearSearchHighlights();
  clearGalleryInteractions();
  disconnectResizeObserver();
  window.removeEventListener('resize', updateHeight);
  window.removeEventListener('resize', syncRendererVisibility);
  window.visualViewport?.removeEventListener('resize', updateHeight);
  window.visualViewport?.removeEventListener('resize', syncRendererVisibility);
});
</script>

<style scoped>
.iframe-search-fab {
  @apply !inline-flex size-11 !p-0 !gap-0 items-center justify-center rounded-full border border-slate-200
    bg-white/95 text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur
    dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200;
}

.iframe-search-fab :deep(.iconify),
.iframe-search-fab :deep([class*='i-']) {
  width: 16px !important;
  height: 16px !important;
}
</style>
