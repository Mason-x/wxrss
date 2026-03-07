<template>
  <UCard class="h-full">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">代理节点</h3>
      <p class="mt-2 text-sm">
        <ExternalLink :href="docsWebSite + '/get-started/private-proxy.html'" text="查看搭建说明" />
      </p>
    </template>

    <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
      <textarea
        v-model="textareaValue"
        class="h-72 w-full resize-none rounded-2xl border border-slate-200 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
        spellcheck="false"
        placeholder="每行一个代理地址，例如：https://proxy-01.example.com"
      />

      <div class="w-full space-y-4 lg:max-w-md">
        <div
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 dark:border-slate-800 dark:bg-slate-950/60"
        >
          <p class="font-medium">使用要求</p>
          <ol class="mt-2 list-decimal space-y-2 pl-5 text-slate-600 dark:text-slate-300">
            <li>必须填写完整的 `http://` 或 `https://` 地址。</li>
            <li>系统会在地址后自动拼接 `?url=`、`headers=` 和 `authorization=` 参数。</li>
            <li>已内置拦截旧公共代理域名，保存时会自动过滤。</li>
          </ol>
          <p class="mt-3 font-medium">说明</p>
          <p class="text-slate-600 dark:text-slate-300">
            未配置代理时，文章抓取和资源导出不会启动，以避免请求落到任何公共代理节点。
          </p>
        </div>

        <div class="flex gap-3">
          <UButton type="button" color="black" class="flex-1 justify-center sm:w-24" @click="save">
            {{ saveBtnText }}
          </UButton>
          <UButton type="button" color="gray" variant="soft" class="justify-center sm:w-24" @click="clear">
            清空
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import ExternalLink from '~/components/base/ExternalLink.vue';
import toastFactory from '~/composables/toast';
import { docsWebSite } from '~/config';
import { validatePrivateProxyList } from '~/config/proxy';
import type { Preferences } from '~/types/preferences';

const toast = toastFactory();
const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const textareaValue = ref('');
const saveBtnText = ref('保存');

function syncTextareaFromPreferences() {
  const result = validatePrivateProxyList(preferences.value.privateProxyList || []);
  if (result.proxies.length !== (preferences.value.privateProxyList || []).length) {
    preferences.value.privateProxyList = result.proxies;
  }
  textareaValue.value = result.proxies.join('\n');
}

function setSaveButtonState(text: string) {
  saveBtnText.value = text;
  setTimeout(() => {
    saveBtnText.value = '保存';
  }, 1000);
}

onMounted(() => {
  syncTextareaFromPreferences();
});

function save() {
  const result = validatePrivateProxyList(textareaValue.value.split('\n'));
  preferences.value.privateProxyList = result.proxies;
  textareaValue.value = result.proxies.join('\n');

  if (result.rejectedLegacy.length > 0) {
    toast.warning('已过滤旧公共代理地址', `共过滤 ${result.rejectedLegacy.length} 个旧公共节点。`);
  }
  if (result.invalid.length > 0) {
    toast.warning('存在无效代理地址', `共忽略 ${result.invalid.length} 行无效配置。`);
  }

  if (result.proxies.length > 0) {
    toast.success('代理节点已保存', `当前生效 ${result.proxies.length} 个代理节点。`);
    setSaveButtonState('已保存');
    return;
  }

  toast.info('代理节点已清空', '未配置代理时，抓取和导出不会启动。');
  setSaveButtonState('已清空');
}

function clear() {
  preferences.value.privateProxyList = [];
  textareaValue.value = '';
  toast.info('已清空代理配置', '未配置代理时，抓取和导出不会启动。');
  setSaveButtonState('已清空');
}
</script>
