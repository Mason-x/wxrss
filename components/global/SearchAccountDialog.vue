<template>
  <USlideover
    v-model="isOpen"
    side="left"
    :ui="{
      width: 'w-screen max-w-none sm:max-w-[38rem]',
      overlay: { background: 'bg-slate-950/45' },
    }"
  >
    <div
      class="flex h-dvh max-h-dvh flex-1 flex-col overflow-hidden bg-white shadow dark:bg-slate-950"
      @touchstart="handleDialogTouchStart"
      @touchmove="handleDialogTouchMove"
      @touchend="handleDialogTouchEnd"
      @touchcancel="resetDialogBackGesture"
    >
      <div class="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
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
              placeholder="输入 RSS 地址、rsshub:// 路由或站点/关键词"
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
            <UPopover :popper="{ placement: 'bottom-end' }">
              <UButton
                type="button"
                color="gray"
                variant="ghost"
                icon="i-heroicons:question-mark-circle-16-solid"
                class="search-help-btn"
                aria-label="RSS 添加说明"
              />
              <template #panel>
                <div class="max-w-[18rem] p-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  支持两种方式：直接添加：`https://sspai.com/feed` 或 `rsshub://github/issue/follow/follow`；关键词搜索：输入如
                  `github issue`、`youtube`、`bilibili`，列出 RSSHub 路由。
                </div>
              </template>
            </UPopover>
          </div>
        </form>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain overscroll-x-none rss-dialog-scroll">
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
          <div class="min-h-full max-w-full rss-dialog-page space-y-4 px-3 py-4" :style="rssDialogPageStyle">
            <div
              v-if="false && selectedRsshubRoute"
              class="max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
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
                  :disabled="!selectedRsshubRouteCanSubmit"
                  @click="submitSelectedRsshubRoute"
                >
                  添加这个 RSSHub 订阅
                </UButton>
                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                  会自动生成 `rsshub://...` 地址后添加。
                </span>
              </div>
              <p
                v-if="selectedRsshubRouteBuildError"
                class="mt-3 text-[11px] text-amber-600 dark:text-amber-300"
              >
                {{ selectedRsshubRouteBuildError }}
              </p>
              <p
                v-if="selectedRsshubRoutePreview.startsWith('rsshub://') && !hasRsshubBaseUrl"
                class="mt-3 text-[11px] text-amber-600 dark:text-amber-300"
              >
                请先在设置里的 RSSHub 一栏填写可用的服务地址，再添加 RSSHub 路由。
              </p>
            </div>

            <div
              v-if="rssDiscoverLoading"
              class="flex items-center justify-center rounded-3xl border border-slate-200 bg-white px-4 py-10 dark:border-slate-800 dark:bg-slate-900"
            >
              <Loader :size="26" class="animate-spin text-slate-500" />
            </div>

            <div v-else-if="showRsshubCategories" class="space-y-3">
              <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
                <button
                  v-for="category in rssCategories"
                  :key="category.id"
                  type="button"
                  class="group relative overflow-hidden rounded-[28px] p-4 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  :style="{ background: `linear-gradient(145deg, ${category.accentFrom}, ${category.accentTo})` }"
                  @click="browseRsshubCategory(category.id)"
                >
                  <div class="absolute right-3 top-3 rounded-full bg-white/14 p-2 text-white/80">
                    <UIcon :name="category.icon" class="size-5" />
                  </div>
                  <div class="relative flex min-h-[8.5rem] flex-col justify-end">
                    <p class="text-lg font-semibold tracking-tight">{{ category.label }}</p>
                    <p class="mt-1 line-clamp-2 text-xs text-white/80">{{ category.description }}</p>
                    <p class="mt-3 text-xs font-medium text-white/85">{{ category.routeCount }} 条路由</p>
                  </div>
                </button>
              </div>
            </div>

            <div v-else-if="isBrowsingRsshubCategory && rssBrowseRouteGroups.length > 0" class="space-y-3">
              <div class="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="min-w-0">
                    <p class="text-sm font-semibold text-slate-900 dark:text-white">
                      {{ selectedRsshubCategory?.label || '分类路由' }}
                    </p>
                    <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {{ selectedRsshubCategory?.description || '按站点分组浏览 RSSHub 路由' }}
                    </p>
                </div>
                <UButton
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  icon="i-lucide:chevron-left"
                  class="icon-btn"
                  @click="exitRsshubCategory"
                />
              </div>

              <article
                v-for="group in rssBrowseRouteGroups"
                :key="group.key"
                class="max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-base font-semibold text-slate-900 dark:text-white">
                        {{ group.namespaceName }}
                      </p>
                      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {{ selectedRsshubCategory?.label || 'RSSHub' }}
                      </span>
                    </div>
                    <p v-if="group.siteUrl" class="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {{ group.siteUrl }}
                    </p>
                  </div>
                  <span class="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                    {{ group.routes.length }} 条
                  </span>
                </div>

                <div class="mt-4 space-y-3">
                  <div
                    v-for="item in group.routes"
                    :key="item.id"
                    class="flex max-w-full items-start justify-between gap-3 overflow-hidden rounded-2xl border border-slate-100 px-3 py-3 dark:border-slate-800"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start gap-2">
                        <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange-400" />
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium text-slate-900 dark:text-white">{{ item.routeName }}</p>
                          <p class="mt-1 break-all text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {{ item.rsshubUrl }}
                          </p>
                          <p v-if="item.summary" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {{ item.summary }}
                          </p>
                          <p v-if="item.maintainers.length > 0" class="mt-2 break-all text-[11px] text-slate-400 dark:text-slate-500">
                            @{{ item.maintainers.slice(0, 3).join(' @') }}
                          </p>
                        </div>
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
                        @click="openRsshubRouteEditor(item)"
                      >
                        填写参数
                      </UButton>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <div v-else-if="rssDiscoverResults.length > 0" class="space-y-3">
              <article
                v-for="item in rssDiscoverResults"
                :key="item.id"
                class="max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
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
                      @click="openRsshubRouteEditor(item)"
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
              当前还没有配置 RSSHub 服务地址。搜索和分类结果可以查看，但添加前需要先到设置里填写可用的 RSSHub 地址。
            </div>
          </div>
        </template>
      </div>

      <UModal
        v-model="rssRouteEditorOpen"
        :ui="{
          width: 'w-[92vw] max-w-[40rem]',
          container: 'flex min-h-full items-end justify-center sm:items-center',
        }"
      >
        <UCard v-if="selectedRsshubRoute" class="w-full">
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-base font-semibold text-slate-900 dark:text-white">
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
          </template>

          <div class="space-y-4">
            <p class="break-all text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {{ selectedRsshubRoutePreview }}
            </p>

            <div v-if="selectedRsshubRoute.params.length > 0" class="space-y-3">
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

            <div class="flex flex-wrap items-center gap-2">
              <UButton
                color="gray"
                :loading="rssLoading"
                :disabled="!selectedRsshubRouteCanSubmit"
                @click="submitSelectedRsshubRoute"
              >
                添加这个 RSSHub 订阅
              </UButton>
              <span class="text-[11px] text-slate-500 dark:text-slate-400">
                会自动生成 `rsshub://...` 地址后添加。
              </span>
            </div>

            <p
              v-if="selectedRsshubRouteBuildError"
              class="text-[11px] text-amber-600 dark:text-amber-300"
            >
              {{ selectedRsshubRouteBuildError }}
            </p>
            <p
              v-if="selectedRsshubRoutePreview.startsWith('rsshub://') && !hasRsshubBaseUrl"
              class="text-[11px] text-amber-600 dark:text-amber-300"
            >
              请先在设置里的 RSSHub 一栏填写可用的服务地址，再添加 RSSHub 路由。
            </p>
          </div>
        </UCard>
      </UModal>
    </div>
  </USlideover>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import {
  getAccountList,
  searchRsshubRoutes,
  subscribeRssFeed,
  type RsshubCategoryItem,
  type RsshubDiscoverItem,
} from '~/apis';
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
const rssRouteEditorOpen = ref(false);
const rssCategories = ref<RsshubCategoryItem[]>([]);
const rssDiscoverResults = ref<RsshubDiscoverItem[]>([]);
const selectedRsshubCategoryId = ref<string | null>(null);
const selectedRsshubRouteId = ref<string | null>(null);
const pendingRssUrl = ref('');
const rssRouteValues = reactive<Record<string, string>>({});

const looksLikeDirectRssInput = computed(() => /^(https?:\/\/|rsshub:\/\/)/i.test(rssQuery.value.trim()));
const hasRsshubBaseUrl = computed(() => /^https?:\/\//i.test(String(preferences.value.rsshubBaseUrl || '').trim()));
const rssPrimaryLoading = computed(() => rssLoading.value || rssDiscoverLoading.value);
const selectedRsshubCategory = computed(
  () => rssCategories.value.find(item => item.id === selectedRsshubCategoryId.value) || null
);
const selectedRsshubRoute = computed(
  () => rssDiscoverResults.value.find(item => item.id === selectedRsshubRouteId.value) || null
);
const showRsshubCategories = computed(
  () =>
    mode.value === 'rss' &&
    !rssDiscoverLoading.value &&
    !selectedRsshubCategoryId.value &&
    !rssDiscoverSearched.value &&
    rssCategories.value.length > 0
);
const isBrowsingRsshubCategory = computed(() => Boolean(selectedRsshubCategoryId.value) && !rssQuery.value.trim());
const rssBrowseRouteGroups = computed(() => {
  if (!isBrowsingRsshubCategory.value) {
    return [];
  }

  const groups = new Map<
    string,
    {
      key: string;
      namespaceName: string;
      namespace: string;
      siteUrl: string;
      routes: RsshubDiscoverItem[];
    }
  >();

  for (const item of rssDiscoverResults.value) {
    const existing = groups.get(item.namespace);
    if (existing) {
      existing.routes.push(item);
      continue;
    }
    groups.set(item.namespace, {
      key: item.namespace,
      namespaceName: item.namespaceName,
      namespace: item.namespace,
      siteUrl: item.siteUrl,
      routes: [item],
    });
  }

  return Array.from(groups.values());
});
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
const selectedRsshubRouteBuildError = computed(() => {
  const item = selectedRsshubRoute.value;
  if (!item) {
    return '';
  }

  try {
    buildRsshubRouteUrl(item, rssRouteValues);
    return '';
  } catch (error: any) {
    return String(error?.message || '请先补全 RSSHub 路由参数');
  }
});
const selectedRsshubRouteCanSubmit = computed(
  () =>
    Boolean(selectedRsshubRoute.value) &&
    !rssLoading.value &&
    !selectedRsshubRouteBuildError.value &&
    !(selectedRsshubRoutePreview.value.startsWith('rsshub://') && !hasRsshubBaseUrl.value)
);
const dialogBackGesture = reactive({
  active: false,
  edge: false,
  axis: null as 'x' | 'y' | null,
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  offsetX: 0,
  animating: false,
});

const emit = defineEmits<{
  'select:account': [account: AccountInfo | MpAccount];
}>();

const accountQuery = ref('');
const accountList = reactive<AccountInfo[]>([]);
const loading = ref(false);
const noMoreData = ref(false);
let begin = 0;
const DIALOG_EDGE_BACK_DIRECTION_RATIO = 1.15;
const DIALOG_ANYWHERE_BACK_TRIGGER_PX = 56;
const DIALOG_BACK_MAX_OFFSET_RATIO = 0.9;
const DIALOG_BACK_RESET_MS = 180;
let dialogBackResetTimer: ReturnType<typeof setTimeout> | null = null;

const canSwipeBackInsideRssPage = computed(
  () =>
    mode.value === 'rss' &&
    Boolean(
      selectedRsshubCategoryId.value ||
        rssDiscoverSearched.value
    )
);

const rssDialogPageStyle = computed(() => ({
  transform: dialogBackGesture.offsetX > 0 ? `translate3d(${dialogBackGesture.offsetX}px, 0, 0)` : 'translate3d(0, 0, 0)',
  transition: dialogBackGesture.animating ? `transform ${DIALOG_BACK_RESET_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
}));

function normalizeRouteValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function encodeRouteValue(value: string): string {
  return normalizeRouteValue(value)
    .split('/')
    .map(segment => encodeURIComponent(segment.trim()))
    .filter(Boolean)
    .join('/');
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
      const value = encodeRouteValue(String(values[key] || ''));
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
  rssRouteEditorOpen.value = false;
  selectedRsshubRouteId.value = null;
  resetRssRouteValues();
}

function resetRsshubBrowseState() {
  selectedRsshubCategoryId.value = null;
  rssDiscoverSearched.value = false;
  rssDiscoverResults.value = [];
  clearSelectedRsshubRoute();
}

function selectRsshubRoute(item: RsshubDiscoverItem) {
  selectedRsshubRouteId.value = item.id;
  resetRssRouteValues();
  item.params.forEach(param => {
    rssRouteValues[param.key] = param.defaultValue || param.options[0]?.value || '';
  });
}

function openRsshubRouteEditor(item: RsshubDiscoverItem) {
  selectRsshubRoute(item);
  rssRouteEditorOpen.value = true;
}

function openSwitcher() {
  isOpen.value = true;
  if (mode.value === 'rss') {
    void ensureRsshubCategoriesLoaded();
  }
}

function closeSwitcher() {
  rssRouteEditorOpen.value = false;
  isOpen.value = false;
}

function resetDialogBackGesture() {
  if (dialogBackResetTimer) {
    clearTimeout(dialogBackResetTimer);
    dialogBackResetTimer = null;
  }
  dialogBackGesture.active = false;
  dialogBackGesture.edge = false;
  dialogBackGesture.axis = null;
  dialogBackGesture.startX = 0;
  dialogBackGesture.startY = 0;
  dialogBackGesture.deltaX = 0;
  dialogBackGesture.deltaY = 0;
  dialogBackGesture.offsetX = 0;
  dialogBackGesture.animating = false;
}

function shouldEnableDialogEdgeBack() {
  return import.meta.client && window.innerWidth < 768 && isOpen.value && canSwipeBackInsideRssPage.value;
}

function clampDialogBackOffset(deltaX: number) {
  if (!import.meta.client) {
    return Math.max(0, deltaX);
  }
  return Math.max(0, Math.min(deltaX, Math.round(window.innerWidth * DIALOG_BACK_MAX_OFFSET_RATIO)));
}

function animateDialogBackReset() {
  if (dialogBackGesture.offsetX <= 0) {
    resetDialogBackGesture();
    return;
  }

  if (dialogBackResetTimer) {
    clearTimeout(dialogBackResetTimer);
  }

  dialogBackGesture.animating = true;
  dialogBackGesture.offsetX = 0;
  dialogBackResetTimer = setTimeout(() => {
    dialogBackResetTimer = null;
    resetDialogBackGesture();
  }, DIALOG_BACK_RESET_MS);
}

function navigateBackInDialog() {
  if (selectedRsshubRouteId.value) {
    clearSelectedRsshubRoute();
    return;
  }

  if (selectedRsshubCategoryId.value) {
    exitRsshubCategory();
    return;
  }

  if (rssDiscoverSearched.value) {
    rssQuery.value = '';
    rssDiscoverSearched.value = false;
    rssDiscoverResults.value = [];
    clearSelectedRsshubRoute();
    return;
  }

  if (mode.value === 'rss' && rssQuery.value.trim()) {
    rssQuery.value = '';
    rssDiscoverResults.value = [];
    clearSelectedRsshubRoute();
    return;
  }

  closeSwitcher();
}

function handleDialogTouchStart(event: TouchEvent) {
  resetDialogBackGesture();

  if (!shouldEnableDialogEdgeBack()) {
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  dialogBackGesture.active = true;
  dialogBackGesture.edge = true;
  dialogBackGesture.startX = touch.clientX;
  dialogBackGesture.startY = touch.clientY;
}

function handleDialogTouchMove(event: TouchEvent) {
  if (!dialogBackGesture.active || !dialogBackGesture.edge) {
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  const deltaX = touch.clientX - dialogBackGesture.startX;
  const deltaY = touch.clientY - dialogBackGesture.startY;
  dialogBackGesture.deltaX = deltaX;
  dialogBackGesture.deltaY = deltaY;

  if (!dialogBackGesture.axis) {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (absX < 8 && absY < 8) {
      return;
    }
    dialogBackGesture.axis = deltaX > 0 && absX > absY * DIALOG_EDGE_BACK_DIRECTION_RATIO ? 'x' : 'y';
  }

  if (dialogBackGesture.axis === 'x' && deltaX > 0) {
    dialogBackGesture.animating = false;
    dialogBackGesture.offsetX = clampDialogBackOffset(deltaX);
    event.preventDefault();
  }
}

function handleDialogTouchEnd() {
  if (
    dialogBackGesture.active &&
    dialogBackGesture.edge &&
    dialogBackGesture.axis === 'x' &&
    dialogBackGesture.deltaX >= DIALOG_ANYWHERE_BACK_TRIGGER_PX
  ) {
    navigateBackInDialog();
    resetDialogBackGesture();
    return;
  }

  animateDialogBackReset();
}

function switchMode(nextMode: 'mp' | 'rss') {
  mode.value = nextMode;
  if (nextMode === 'rss') {
    if (!rssQuery.value.trim() && !selectedRsshubCategoryId.value) {
      rssDiscoverSearched.value = false;
      rssDiscoverResults.value = [];
    }
    void ensureRsshubCategoriesLoaded();
  }
}

async function searchAccount() {
  begin = 0;
  accountList.length = 0;
  noMoreData.value = false;
  await loadData();
}

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
      return;
    }

    toast.add({
      color: 'rose',
      title: '搜索失败',
      description: describeRequestError(e),
      icon: 'i-octicon:bell-24',
    });
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
    resetRsshubBrowseState();
    isOpen.value = false;
    emit('select:account', result.account);
  } catch (e: any) {
    if (e.message === 'session expired') {
      void navigateToLogin(route.fullPath);
      return;
    }

    toast.add({
      color: 'rose',
      title: '添加失败',
      description: describeRequestError(e),
      icon: 'i-octicon:bell-24',
    });
  } finally {
    rssLoading.value = false;
    pendingRssUrl.value = '';
  }
}

async function updateRsshubCatalog(options: { keyword?: string; category?: string; limit?: number }) {
  const result = await searchRsshubRoutes({
    keyword: options.keyword || '',
    category: options.category || '',
    limit: options.limit || 20,
  });
  rssCategories.value = result.categories;
  rssDiscoverResults.value = result.routes;
}

async function ensureRsshubCategoriesLoaded() {
  if (rssCategories.value.length > 0 || rssDiscoverLoading.value) {
    return;
  }

  rssDiscoverLoading.value = true;
  try {
    await updateRsshubCatalog({ limit: 120 });
  } finally {
    rssDiscoverLoading.value = false;
  }
}

async function discoverRsshubRoutes() {
  const keyword = rssQuery.value.trim();
  if (!keyword || rssDiscoverLoading.value) {
    return;
  }

  rssDiscoverLoading.value = true;
  selectedRsshubCategoryId.value = null;
  rssDiscoverSearched.value = false;
  clearSelectedRsshubRoute();
  try {
    await updateRsshubCatalog({
      keyword,
      limit: 24,
    });
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

async function browseRsshubCategory(categoryId: string) {
  if (!categoryId || rssDiscoverLoading.value) {
    return;
  }

  rssQuery.value = '';
  rssDiscoverLoading.value = true;
  selectedRsshubCategoryId.value = categoryId;
  rssDiscoverSearched.value = false;
  clearSelectedRsshubRoute();
  try {
    await updateRsshubCatalog({
      category: categoryId,
      limit: categoryId === 'all' ? 160 : 120,
    });
  } catch (e: any) {
    selectedRsshubCategoryId.value = null;
    toast.add({
      color: 'rose',
      title: '加载分类失败',
      description: describeRequestError(e),
      icon: 'i-octicon:bell-24',
    });
  } finally {
    rssDiscoverLoading.value = false;
  }
}

function exitRsshubCategory() {
  resetRsshubBrowseState();
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

  if (selectedRsshubRouteBuildError.value) {
    toast.add({
      color: 'amber',
      title: '参数未完成',
      description: selectedRsshubRouteBuildError.value,
      icon: 'i-octicon:alert-24',
    });
    return;
  }

  try {
    await submitRssValue(buildRsshubRouteUrl(item, rssRouteValues));
  } catch (error: any) {
    toast.add({
      color: 'amber',
      title: '添加失败',
      description: String(error?.message || '请检查 RSSHub 路由参数'),
      icon: 'i-octicon:alert-24',
    });
  }
}

function selectAccount(account: AccountInfo | MpAccount) {
  isOpen.value = false;
  emit('select:account', account);
}

defineExpose({
  open: openSwitcher,
  close: closeSwitcher,
});

watch(
  () => [isOpen.value, mode.value] as const,
  ([open, currentMode]) => {
    if (open && currentMode === 'rss') {
      void ensureRsshubCategoriesLoaded();
    }
  }
);

watch(rssQuery, value => {
  if (value.trim() || selectedRsshubCategoryId.value) {
    return;
  }
  rssDiscoverSearched.value = false;
  rssDiscoverResults.value = [];
});

watch(rssRouteEditorOpen, open => {
  if (!open && selectedRsshubRouteId.value) {
    clearSelectedRsshubRoute();
  }
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

.search-help-btn {
  @apply !inline-flex h-10 w-10 shrink-0 items-center justify-center !p-0 rounded-full;
}

.rss-dialog-scroll {
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.rss-dialog-page {
  width: 100%;
  overflow-x: hidden;
  will-change: transform;
  touch-action: pan-y;
}
</style>
