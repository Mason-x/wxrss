<template>
  <div class="iframe-html-renderer">
    <iframe
      ref="iframeRef"
      class="block w-full border-0 bg-transparent"
      :srcdoc="preparedHtml"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      scrolling="no"
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="handleLoad"
    />
  </div>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import type { NitroFetchRequest } from 'nitropack';
import usePreferences from '~/composables/usePreferences';
import { validatePrivateProxyList } from '~/config/proxy';
import type { Preferences } from '~/types/preferences';

interface Props {
  html: string;
}

interface MpVideoInfoResponse {
  videos?: Record<string, { src: string; poster?: string }>;
}

const props = defineProps<Props>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const preferences = usePreferences() as unknown as Ref<Preferences>;
const fetcher = $fetch as <T>(request: NitroFetchRequest, options?: Record<string, any>) => Promise<T>;
const preparedHtml = ref('');
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

function buildSrcdoc(html: string): string {
  const sanitized = DOMPurify.sanitize(html || '', {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['iframe', 'video', 'source'],
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
      'data-src',
      'data-mpvid',
      'sandbox',
      'referrerpolicy',
    ],
  });

  const hasHead = /<head[\s>]/i.test(sanitized);
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
      }
      img, video, iframe {
        max-width: 100%;
      }
      video {
        display: block;
        width: 100%;
        height: auto;
        background: #000;
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
    </style>
  `;

  if (hasHead) {
    return sanitized.replace(/<head([^>]*)>/i, `<head$1>${baseMarkup}${styleMarkup}`);
  }

  return `<!doctype html><html><head>${baseMarkup}${styleMarkup}</head><body>${sanitized}</body></html>`;
}

function getActivePrivateProxy() {
  const { proxies } = validatePrivateProxyList(preferences.value.privateProxyList || []);
  const proxy = proxies[0];
  if (!proxy) {
    return null;
  }

  return {
    proxy,
    authorization: preferences.value.privateProxyAuthorization || '',
  };
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
  const activeProxy = getActivePrivateProxy();
  if (!activeProxy || !shouldProxyVideoUrl(url)) {
    return url;
  }

  const headers: Record<string, string> = {
    Referer: 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
  };

  return `${activeProxy.proxy}?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(JSON.stringify(headers))}&authorization=${encodeURIComponent(activeProxy.authorization)}`;
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

function rewriteVideoUrls(doc: Document): void {
  doc.querySelectorAll('video[src], source[src]').forEach(node => {
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
  rewriteVideoUrls(doc);
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

function handleLoad(): void {
  nextTick(() => {
    updateHeight();
    bindResizeObserver();
    const doc = iframeRef.value?.contentDocument;
    if (doc) {
      bindGalleryInteractions(doc);
    }
  });
}

watch(preparedHtml, async () => {
  await nextTick();
  updateHeight();
});

watch(
  [() => props.html, () => preferences.value.privateProxyAuthorization, () => preferences.value.privateProxyList],
  () => {
    void refreshPreparedHtml();
  },
  {
    deep: true,
    immediate: true,
  }
);

onMounted(() => {
  window.addEventListener('resize', updateHeight);
  window.visualViewport?.addEventListener('resize', updateHeight);
});

onUnmounted(() => {
  clearGalleryInteractions();
  disconnectResizeObserver();
  window.removeEventListener('resize', updateHeight);
  window.visualViewport?.removeEventListener('resize', updateHeight);
});
</script>
