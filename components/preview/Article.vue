<template>
  <div>
    <USlideover v-model="isOpen" :ui="{ width: 'max-w-[720px]' }">
      <div class="article-preview h-screen overflow-y-scroll">
        <IframeHtmlRenderer :html="articleHtml" />
      </div>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { normalizeHtml } from '#shared/utils/html';
import IframeHtmlRenderer from '~/components/preview/IframeHtmlRenderer.vue';
import toastFactory from '~/composables/toast';
import usePreferences from '~/composables/usePreferences';
import { getHtmlCache, type HtmlAsset } from '~/store/v2/html';
import type { Preferences } from '~/types/preferences';
import type { AppMsgEx } from '~/types/types';
import { renderComments } from '~/utils/comment';

const toast = toastFactory();

const isOpen = ref(false);
const articleHtml = ref('');

async function open(article: AppMsgEx) {
  const htmlAsset = await getHtmlCache(article.link);
  if (htmlAsset) {
    isOpen.value = true;
    const rawHtml = await htmlAsset.file.text();
    articleHtml.value = await normalizeHtmlForPreview(htmlAsset, rawHtml);
    return;
  }

  toast.warning('Article preview failed', `Article "${article.title}" has no cached HTML yet.`);
}

defineExpose({
  open,
});

const preferences = usePreferences() as unknown as Ref<Preferences>;

async function normalizeHtmlForPreview(cachedHtml: HtmlAsset, html: string): Promise<string> {
  const normalizedHtml = normalizeHtml(html, 'html');
  const parser = new DOMParser();
  const previewDocument = parser.parseFromString(normalizedHtml, 'text/html');

  previewDocument.title = cachedHtml.title;

  if (preferences.value.exportConfig.exportHtmlIncludeComments) {
    const commentHTML = await renderComments(cachedHtml.url);
    if (commentHTML) {
      previewDocument.body.insertAdjacentHTML('beforeend', `\n<!-- comments -->\n${commentHTML}`);
    }
  }

  return '<!DOCTYPE html>\n' + previewDocument.documentElement.outerHTML;
}
</script>
