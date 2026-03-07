<template>
  <div class="iframe-html-renderer">
    <iframe
      ref="iframeRef"
      class="block w-full border-0 bg-transparent"
      :srcdoc="preparedHtml"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="handleLoad"
    />
  </div>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';

interface Props {
  html: string;
}

const props = defineProps<Props>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function buildSrcdoc(html: string): string {
  const sanitized = DOMPurify.sanitize(html || '', {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['iframe'],
    ADD_ATTR: [
      'allow',
      'allowfullscreen',
      'frameborder',
      'scrolling',
      'data-src',
      'srcdoc',
      'sandbox',
      'referrerpolicy',
    ],
  });

  const hasHead = /<head[\s>]/i.test(sanitized);
  const baseMarkup = '<base target="_blank" />';
  const styleMarkup = `
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      body {
        overflow-x: hidden;
      }
      img, video, iframe {
        max-width: 100%;
      }
    </style>
  `;

  if (hasHead) {
    return sanitized.replace(/<head([^>]*)>/i, `<head$1>${baseMarkup}${styleMarkup}`);
  }

  return `<!doctype html><html><head>${baseMarkup}${styleMarkup}</head><body>${sanitized}</body></html>`;
}

const preparedHtml = computed(() => buildSrcdoc(props.html));

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

function handleLoad(): void {
  nextTick(() => {
    updateHeight();
    bindResizeObserver();
  });
}

watch(preparedHtml, async () => {
  await nextTick();
  updateHeight();
});

onMounted(() => {
  window.addEventListener('resize', updateHeight);
});

onUnmounted(() => {
  disconnectResizeObserver();
  window.removeEventListener('resize', updateHeight);
});
</script>
