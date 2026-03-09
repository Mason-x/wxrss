<template>
  <USlideover
    v-model="isOpen"
    side="left"
    :ui="{
      width: 'w-screen max-w-none sm:max-w-[38rem]',
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
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                支持公众号搜索、RSS 地址直加，以及 RSSHub 路由搜索。
              </p>
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

        <form v-else class="space-y-3" @submit.prevent="handleRssPrimaryAction">
          <div class="flex items-center gap-2">
          <UInput
            v-model="rssQuery"
            icon="i-lucide:rss"
            color="white"
            size="md"
            class="dialog-search-input flex-1"
            :trailing="false"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="输入 RSS 地址、rsshub:// 路由或关键词"
          />
          <UButton
            type="submit"
            color="gray"
            variant="soft"
            icon="i-lucide:search"
            class="search-submit-btn"
            :loading="rssPrimaryLoading"
            :disabled="rssPrimaryLoading || !rssQuery.trim()"
            aria-label="搜索或添加 RSS"
          />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              class="hidden"
              type="submit"
              color="gray"
              :loading="rssPrimaryLoading"
              :disabled="rssPrimaryLoading || !rssQuery.trim()"
            >
              {{ looksLikeDirectRssInput ? '添加订阅' : '搜索添加' }}
            </UButton>
            <span class="text-[11px] text-slate-500 dark:text-slate-400">
              关键词会搜索 RSSHub 路由；地址会直接尝试订阅。
            </span>
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
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  微信号 {{ account.alias || '未设置' }}
                </p>
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
              <p class="font-medium text-slate-900 dark:text-white">支持两种方式</p>
              <p class="mt-2">直接添加：`https://sspai.com/feed` 或 `rsshub://github/issue/follow/follow`</p>
              <p class="mt-1">关键词搜索：输入如 `github issue`、`youtube`、`bilibili`，列出 RSSHub 路由</p>
            </div>

            <div
              v-if="selectedRsshubRoute"
              class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate font-semibold text-slate-900 dark:text-white">
                      {{ selectedRsshubRoute.routeName }}
                    </p>
                    <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {{ selectedRsshubRoute.namespaceName }}
                    </span>
                    <span
                      v-if="selectedRsshubRoute.requiresConfig"
                      class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      需要额外配置
                    </span>
                  </div>
                  <p v-if="selectedRsshubRoute.summary" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {{ selectedRsshubRoute.summary }}
                  </p>
                  <p class="mt-2 break-all text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {{ selectedRsshubRoutePreview }}
                  </p>
                </div>
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:x"
                  class="icon-btn"
                  @click="clearSelectedRsshubRoute"
                />
              </div>

              <div v-if="selectedRsshubRoute.params.length > 0" class="mt-4 space-y-3">
                <div v-for="param in selectedRsshubRoute.params" :key="param.key" class="space-y-1.5">
                  <label class="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {{ param.key }}
                    <span v-if="param.required" class="ml-1 text-rose-500">*</span>
                  </label>

                  <USelectMenu
                    v-if="param.options.length > 0"
                    v-model="rssRouteValues[param.key]"
                    :options="param.options"
                    value-attribute="value"
                    option-attribute="label"
                  />
                  <UInput
                    v-else
                    v-model="rssRouteValues[param.key]"
                    :placeholder="param.defaultValue || (param.required ? '必填参数' : '可选参数')"
                  />

                  <p v-if="param.description" class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ param.description }}
                  </p>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-2">
                <UButton
                  color="gray"
                  :loading="rssLoading"
                  :disabled="rssLoading || (selectedRsshubRoutePreview.startsWith('rsshub://') && !hasRsshubBaseUrl)"
                  @click="submitSelectedRsshubRoute"
                >
                  添加这个 RSSHub 订阅
                </UButton>
                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                  会自动生成 `rsshub://...` 地址后添加。
                </span>
              </div>
              <p
                v-if="selectedRsshubRoutePreview.startsWith('rsshub://') && !hasRsshubBaseUrl"
                class="mt-3 text-[11px] text-amber-600 dark:text-amber-300"
              >
                请先在设置里的 RSSHub 一栏填写可用的服务地址，再添加 RSSHub 路由。
              </p>
            </div>

            <div v-if="rssDiscoverLoading" class="flex items-center justify-center rounded-3xl border border-slate-200 bg-white px-4 py-10 dark:border-slate-800 dark:bg-slate-900">
              <Loader :size="26" class="animate-spin text-slate-500" />
            </div>

            <div v-else-if="rssDiscoverResults.length > 0" class="space-y-3">
              <article
                v-for="item in rssDiscoverResults"
                :key="item.id"
                class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate font-semibold text-slate-900 dark:text-white">{{ item.routeName }}</p>
                      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {{ item.namespaceName }}
                      </span>
                      <span
                        v-if="item.requiresConfig"
                        class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"
                      >
                        需要额外配置
                      </span>
                    </div>
                    <p v-if="item.siteUrl" class="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.siteUrl }}
                    </p>
                    <p class="mt-1 break-all text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {{ item.rsshubUrl }}
                    </p>
                    <p v-if="item.summary" class="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ item.summary }}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <span
                        v-for="category in item.categories.slice(0, 3)"
                        :key="`${item.id}-${category}`"
                        class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {{ category }}
                      </span>
                      <span
                        v-if="item.maintainers.length > 0"
                        class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                      >
                        @{{ item.maintainers[0] }}
                      </span>
                    </div>
                  </div>

                  <div class="flex shrink-0 flex-col gap-2">
                    <UButton
                      v-if="item.params.length === 0"
                      size="2xs"
                      color="gray"
                      :loading="rssLoading && pendingRssUrl === item.rsshubUrl"
                      :disabled="rssLoading || (item.rsshubUrl.startsWith('rsshub://') && !hasRsshubBaseUrl)"
                      @click="submitRssValue(item.rsshubUrl)"
                    >
                      一键添加
                    </UButton>
                    <UButton
                      v-else
                      size="2xs"
                      color="gray"
                      variant="soft"
                      @click="selectRsshubRoute(item)"
                    >
                      填写参数
                    </UButton>
                  </div>
                </div>
              </article>
            </div>

            <div
              v-else-if="rssDiscoverSearched"
              class="rounded-3xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            >
              没找到匹配的 RSSHub 路由，换个关键词试试，或者直接粘贴 RSS 地址。
            </div>

            <div
              v-if="rssDiscoverResults.length > 0 && !hasRsshubBaseUrl"
              class="rounded-3xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
            >
              当前还没有配置 RSSHub 服务地址。搜索结果可以查看，但添加前需要先到设置里填写可用的 RSSHub 地址。
            </div>
          </div>
        </template>
      </div>
    </div>
  </USlideover>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import { getAccountList, searchRsshubRoutes, subscribeRssFeed, type RsshubDiscoverItem } from '~/apis';
import { ACCOUNT_LIST_PAGE_SIZE, ACCOUNT_TYPE } from '~/config';
import type { MpAccount } from '~/store/v2/info';
import type { Preferences } from '~/types/preferences';
import type { AccountInfo } from '~/types/types';

const toast = useToast();
const route = useRoute();
const { navigateToLogin } = useMpAuth();
const preferences = usePreferences() as unknown as Ref<Preferences>;

const isOpen = ref(false);
const mode = ref<'mp' | 'rss'>('mp');
const rssQuery = ref('');
const rssLoading = ref(false);
const rssDiscoverLoading = ref(false);
const rssDiscoverSearched = ref(false);
const rssDiscoverResults = ref<RsshubDiscoverItem[]>([]);
const selectedRsshubRouteId = ref<string | null>(null);
const pendingRssUrl = ref('');
const rssRouteValues = reactive<Record<string, string>>({});

const looksLikeDirectRssInput = computed(() => /^(https?:\/\/|rsshub:\/\/)/i.test(rssQuery.value.trim()));
const hasRsshubBaseUrl = computed(() => /^https?:\/\//i.test(String(preferences.value.rsshubBaseUrl || '').trim()));
const rssPrimaryLoading = computed(() => rssLoading.value || rssDiscoverLoading.value);
const selectedRsshubRoute = computed(
  () => rssDiscoverResults.value.find(item => item.id === selectedRsshubRouteId.value) || null
);
const selectedRsshubRoutePreview = computed(() => {
  const item = selectedRsshubRoute.value;
  if (!item) {
    return '';
  }
  try {
    return buildRsshubRouteUrl(item, rssRouteValues);
  } catch {
    return item.rsshubUrl;
  }
});

function normalizeRouteValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function describeRequestError(error: any): string {
  return String(error?.data?.statusMessage || error?.statusMessage || error?.data?.message || error?.message || '未知错误');
}

function buildRsshubRouteUrl(item: RsshubDiscoverItem, values: Record<string, string>): string {
  const builtSegments = item.routePath
    .split('/')
    .filter(Boolean)
    .flatMap(segment => {
      const match = /^:([A-Za-z0-9_]+)(?:\{[^}]+\})?(\?)?$/.exec(segment);
      if (!match) {
        return [segment];
      }

      const key = match[1];
      const optional = Boolean(match[2]);
      const value = normalizeRouteValue(String(values[key] || ''));
      if (!value) {
        if (optional) {
          return [];
        }
        throw new Error(`参数 ${key} 不能为空`);
      }
      return value.split('/').filter(Boolean);
    });

  return `rsshub://${item.namespace}/${builtSegments.join('/')}`.replace(/\/+$/, '');
}

function resetRssRouteValues() {
  Object.keys(rssRouteValues).forEach(key => {
    delete rssRouteValues[key];
  });
}

function clearSelectedRsshubRoute() {
  selectedRsshubRouteId.value = null;
  resetRssRouteValues();
}

function selectRsshubRoute(item: RsshubDiscoverItem) {
  selectedRsshubRouteId.value = item.id;
  resetRssRouteValues();
  item.params.forEach(param => {
    rssRouteValues[param.key] = param.defaultValue || param.options[0]?.value || '';
  });
}

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
        description: describeRequestError(e),
        icon: 'i-octicon:bell-24',
      });
    }
  } finally {
    loading.value = false;
  }
}

async function submitRssValue(value: string) {
  const normalized = value.trim();
  if (!normalized || rssLoading.value) {
    return;
  }

  rssLoading.value = true;
  pendingRssUrl.value = normalized;
  try {
    const result = await subscribeRssFeed(normalized);
    rssQuery.value = '';
    rssDiscoverSearched.value = false;
    rssDiscoverResults.value = [];
    clearSelectedRsshubRoute();
    isOpen.value = false;
    emit('select:account', result.account);
  } catch (e: any) {
    if (e.message === 'session expired') {
      void navigateToLogin(route.fullPath);
    } else {
      toast.add({
        color: 'rose',
        title: '添加失败',
        description: describeRequestError(e),
        icon: 'i-octicon:bell-24',
      });
    }
  } finally {
    rssLoading.value = false;
    pendingRssUrl.value = '';
  }
}

async function discoverRsshubRoutes() {
  const keyword = rssQuery.value.trim();
  if (!keyword || rssDiscoverLoading.value) {
    return;
  }

  rssDiscoverLoading.value = true;
  rssDiscoverSearched.value = false;
  clearSelectedRsshubRoute();
  try {
    rssDiscoverResults.value = await searchRsshubRoutes(keyword);
    rssDiscoverSearched.value = true;
  } catch (e: any) {
    toast.add({
      color: 'rose',
      title: '搜索失败',
      description: describeRequestError(e),
      icon: 'i-octicon:bell-24',
    });
  } finally {
    rssDiscoverLoading.value = false;
  }
}

async function handleRssPrimaryAction() {
  if (looksLikeDirectRssInput.value) {
    await submitRssValue(rssQuery.value);
    return;
  }
  await discoverRsshubRoutes();
}

async function submitSelectedRsshubRoute() {
  const item = selectedRsshubRoute.value;
  if (!item) {
    return;
  }

  try {
    await submitRssValue(buildRsshubRouteUrl(item, rssRouteValues));
  } catch (error: any) {
    toast.add({
      color: 'amber',
      title: '参数未完成',
      description: String(error?.message || '请先补全 RSSHub 路由参数'),
      icon: 'i-octicon:alert-24',
    });
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

<style scoped>
.icon-btn {
  @apply !inline-flex size-7 !p-0 !gap-0 items-center justify-center leading-none rounded-full border border-slate-200
    bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900
    dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white;
}

.dialog-search-input :deep(input) {
  font-size: 16px;
}

@media (min-width: 768px) {
  .dialog-search-input :deep(input) {
    font-size: 14px;
  }
}

.search-submit-btn {
  @apply !inline-flex h-10 w-10 shrink-0 items-center justify-center !p-0;
}
</style>
