<template>
  <USlideover
    v-model="isOpen"
    side="left"
    :ui="{
      width: 'w-screen max-w-none sm:max-w-[34rem]',
      overlay: { background: 'bg-slate-950/45' },
    }"
  >
    <div class="flex flex-1 flex-col overflow-hidden bg-white shadow dark:bg-slate-950">
      <div class="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <UButton
              size="2xs"
              color="gray"
              variant="ghost"
              icon="i-lucide:chevron-left"
              class="icon-btn"
              @click="closeSwitcher"
            />
            <div>
              <p class="text-sm font-semibold">添加订阅源</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">支持公众号搜索，也支持 RSS / RSSHub 订阅源</p>
            </div>
          </div>
          <UButton
            size="2xs"
            color="gray"
            variant="ghost"
            icon="i-lucide:x"
            class="icon-btn"
            @click="closeSwitcher"
          />
        </div>

        <div class="mb-3 inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            class="rounded-full px-3 py-1.5 text-xs font-medium transition"
            :class="
              mode === 'mp'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            "
            @click="switchMode('mp')"
          >
            公众号
          </button>
          <button
            type="button"
            class="rounded-full px-3 py-1.5 text-xs font-medium transition"
            :class="
              mode === 'rss'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            "
            @click="switchMode('rss')"
          >
            RSS
          </button>
        </div>

        <SearchAccountForm v-if="mode === 'mp'" v-model="accountQuery" @search="searchAccount" />

        <form v-else class="space-y-3" @submit.prevent="submitRss">
          <UInput
            v-model="rssUrl"
            icon="i-lucide:rss"
            color="white"
            size="md"
            :trailing="false"
            placeholder="https://example.com/feed.xml 或 rsshub://route"
          />
          <div class="flex items-center gap-2">
            <UButton type="submit" color="gray" :loading="rssLoading" :disabled="rssLoading || !rssUrl.trim()">
              添加订阅
            </UButton>
            <span class="text-[11px] text-slate-500 dark:text-slate-400">兼容标准 RSS / Atom 和 RSSHub 路由</span>
          </div>
        </form>
      </div>

      <div class="flex-1 overflow-y-auto">
        <template v-if="mode === 'mp'">
          <ul class="divide-y divide-slate-100 antialiased dark:divide-slate-800">
            <li
              v-for="account in accountList"
              :key="account.fakeid"
              class="flex cursor-pointer items-center gap-3 px-3 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
              @click="selectAccount(account)"
            >
              <img class="size-16 shrink-0 rounded-2xl object-cover" :src="account.round_head_img" alt="" />
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <p class="truncate font-semibold">{{ account.nickname }}</p>
                  <p class="shrink-0 text-sm font-medium text-sky-500">
                    {{ ACCOUNT_TYPE[account.service_type] }}
                  </p>
                </div>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">微信号 {{ account.alias || '未设置' }}</p>
                <p class="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{{ account.signature }}</p>
              </div>
            </li>
          </ul>

          <p v-if="loading" class="my-2 flex items-center justify-center py-2">
            <Loader :size="28" class="animate-spin text-slate-500" />
          </p>
          <p v-else-if="noMoreData" class="mt-2 py-2 text-center text-slate-400">已全部加载完毕</p>
          <button
            v-else-if="accountList.length > 0"
            type="button"
            class="mx-auto my-3 block h-10 rounded-md border border-slate-200 px-6 font-semibold text-slate-900 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
            @click="loadData"
          >
            加载更多
          </button>
        </template>

        <template v-else>
          <div class="space-y-4 px-3 py-4">
            <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
              <p class="font-medium text-slate-900 dark:text-white">可直接粘贴订阅源地址</p>
              <p class="mt-2">示例：`https://sspai.com/feed`</p>
              <p class="mt-1">示例：`rsshub://zhihu/hot/total`</p>
            </div>
          </div>
        </template>
      </div>
    </div>
  </USlideover>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import { getAccountList, subscribeRssFeed } from '~/apis';
import { ACCOUNT_LIST_PAGE_SIZE, ACCOUNT_TYPE } from '~/config';
import type { MpAccount } from '~/store/v2/info';
import type { AccountInfo } from '~/types/types';

const toast = useToast();
const route = useRoute();
const { navigateToLogin } = useMpAuth();

const isOpen = ref(false);
const mode = ref<'mp' | 'rss'>('mp');
const rssUrl = ref('');
const rssLoading = ref(false);

function openSwitcher() {
  isOpen.value = true;
}

function closeSwitcher() {
  isOpen.value = false;
}

function switchMode(nextMode: 'mp' | 'rss') {
  mode.value = nextMode;
}

const accountQuery = ref('');
const accountList = reactive<AccountInfo[]>([]);
let begin = 0;

async function searchAccount() {
  begin = 0;
  accountList.length = 0;
  noMoreData.value = false;

  await loadData();
}

const loading = ref(false);
const noMoreData = ref(false);

async function loadData() {
  loading.value = true;

  try {
    const [accounts, completed] = await getAccountList(begin, accountQuery.value);
    accountList.push(...accounts);
    begin += ACCOUNT_LIST_PAGE_SIZE;
    noMoreData.value = completed;
  } catch (e: any) {
    if (e.message === 'session expired') {
      void navigateToLogin(route.fullPath);
    } else {
      console.error(e);
      toast.add({
        color: 'rose',
        title: '错误',
        description: e.message,
        icon: 'i-octicon:bell-24',
      });
    }
  } finally {
    loading.value = false;
  }
}

async function submitRss() {
  const value = rssUrl.value.trim();
  if (!value || rssLoading.value) {
    return;
  }

  rssLoading.value = true;
  try {
    const result = await subscribeRssFeed(value);
    rssUrl.value = '';
    isOpen.value = false;
    emit('select:account', result.account);
  } catch (e: any) {
    if (e.message === 'session expired') {
      void navigateToLogin(route.fullPath);
    } else {
      toast.add({
        color: 'rose',
        title: '添加失败',
        description: String(e?.message || '未知错误'),
        icon: 'i-octicon:bell-24',
      });
    }
  } finally {
    rssLoading.value = false;
  }
}

function selectAccount(account: AccountInfo | MpAccount) {
  isOpen.value = false;
  emit('select:account', account);
}

const emit = defineEmits<{
  'select:account': [account: AccountInfo | MpAccount];
}>();

defineExpose({
  open: openSwitcher,
  close: closeSwitcher,
});
</script>
