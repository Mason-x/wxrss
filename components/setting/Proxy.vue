<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">代理节点</h3>
      <p class="mt-2 text-sm">
        <ExternalLink :href="docsWebSite + '/get-started/private-proxy.html'" text="查看搭建说明" />
      </p>
    </template>

    <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div class="w-full space-y-3">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:clipboard-paste" @click="pasteProxyList">
            粘贴
          </UButton>
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:trash-2" @click="clear">
            清空
          </UButton>
        </div>

        <textarea
          v-model="textareaValue"
          class="h-72 w-full resize-none rounded-[26px] border border-white/75 bg-white/80 p-4 font-mono text-sm shadow-[0_18px_32px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900/80"
          spellcheck="false"
          placeholder="每行一个代理地址，例如：https://proxy-01.example.com"
        />
      </div>

      <div class="w-full space-y-4 lg:max-w-md">
        <div class="app-shell-muted rounded-[26px] p-4 text-sm leading-7 sm:p-5">
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
          <UButton type="button" color="black" class="flex-1 justify-center rounded-full sm:w-24" @click="save">
            {{ saveBtnText }}
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import ExternalLink from '~/components/base/ExternalLink.vue';
import toastFactory from '~/composables/toast';
import useSavePreferences from '~/composables/useSavePreferences';
import { docsWebSite } from '~/config';
import { validatePrivateProxyList } from '~/config/proxy';
import type { Preferences } from '~/types/preferences';

const toast = toastFactory();
const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const { saveNow } = useSavePreferences();
const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

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

async function pasteProxyList() {
  try {
    textareaValue.value = await navigator.clipboard.readText();
    toast.success('已粘贴代理配置', '代理节点已从剪贴板填入。');
  } catch (error: any) {
    toast.warning('无法读取剪贴板', String(error?.message || '请检查浏览器剪贴板权限。'));
  }
}

async function save() {
  const result = validatePrivateProxyList(textareaValue.value.split('\n'));
  preferences.value.privateProxyList = result.proxies;
  textareaValue.value = result.proxies.join('\n');
  await saveNow();

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

async function clear() {
  preferences.value.privateProxyList = [];
  textareaValue.value = '';
  await saveNow();
  toast.info('已清空代理配置', '未配置代理时，抓取和导出不会启动。');
  setSaveButtonState('已清空');
}
</script>
