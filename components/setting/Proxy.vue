<template>
  <UCard class="mx-4 mt-6">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">代理节点</h3>
      <p class="text-sm text-slate-500">
        留空时默认使用
        <ExternalLink :href="docsWebSite + '/get-started/proxy.html'" text="公共代理" />
        下载资源。
      </p>
      <p class="mt-2 text-sm">
        <ExternalLink :href="docsWebSite + '/get-started/private-proxy.html'" text="如何搭建私有代理节点" />
      </p>
    </template>

    <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
      <textarea
        v-model="textareaValue"
        class="h-72 w-full rounded-2xl border border-slate-200 p-3 font-mono text-sm resize-none dark:border-slate-700 dark:bg-slate-950"
        spellcheck="false"
        placeholder="每行填写一个代理地址，例如：https://wproxy-01.deno.dev"
      />

      <div class="w-full space-y-4 lg:max-w-md">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 dark:border-slate-800 dark:bg-slate-950/60">
          <p class="font-medium">代理地址要求</p>
          <ol class="mt-2 list-decimal space-y-2 pl-5 text-slate-600 dark:text-slate-300">
            <li>必须是以 <code class="font-mono text-rose-500">http://</code> 或 <code class="font-mono text-rose-500">https://</code> 开头的完整地址。</li>
            <li>系统会在地址后自动追加 <code class="font-mono text-rose-500">?url=</code> 等参数，请确保目标服务能正确处理。</li>
          </ol>
          <p class="mt-3 font-medium">示例</p>
          <p><code class="font-mono text-rose-500">https://wproxy-01.deno.dev</code></p>
          <p><code class="font-mono text-rose-500">https://wproxy-01.deno.dev/</code></p>
        </div>

        <UButton type="submit" color="black" class="w-full justify-center sm:w-24" @click="save">
          {{ saveBtnText }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import ExternalLink from '~/components/base/ExternalLink.vue';
import { docsWebSite } from '~/config';
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const textareaValue = ref('');
const proxyList = computed(() =>
  textareaValue.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('http'))
);

onMounted(() => {
  try {
    const configuredProxyList = preferences.value.privateProxyList;
    if (configuredProxyList.length > 0) {
      textareaValue.value = configuredProxyList.join('\n');
    }
  } catch {}
});

const saveBtnText = ref('保存');
async function save() {
  saveBtnText.value = '保存成功';
  setTimeout(() => {
    preferences.value.privateProxyList = proxyList.value;
    saveBtnText.value = '保存';
  }, 1000);
}
</script>
