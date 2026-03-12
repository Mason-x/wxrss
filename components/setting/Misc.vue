<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">其他选项</h3>
      <p class="text-sm text-slate-500">同步节奏、缓存行为和列表显示规则。</p>
    </template>

    <div class="space-y-5">
      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-4">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">内容与缓存</p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">控制文章列表和内容抓取时的缓存策略。</p>
        </div>

        <div class="space-y-3">
          <div class="flex gap-2">
            <UCheckbox v-model="preferences.hideDeleted" name="hideDeleted" label="隐藏已删除文章" />
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[300px] p-3 text-sm text-gray-500">
                  是否在文章列表中显示已删除文章。开启后会过滤掉已删除文章。
                </p>
              </template>
              <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="mt-0.5 size-5" />
            </UPopover>
          </div>

          <div class="flex gap-2">
            <UCheckbox
              v-model="preferences.downloadConfig.forceDownloadContent"
              name="forceDownloadContent"
              label="强制重新下载文章内容"
            />
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[300px] p-3 text-sm text-gray-500">
                  抓取文章内容时忽略本地缓存，始终拉取最新内容。
                </p>
              </template>
              <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="mt-0.5 size-5" />
            </UPopover>
          </div>

          <div class="flex gap-2">
            <UCheckbox
              v-model="preferences.downloadConfig.metadataOverrideContent"
              name="metadataOverrideContent"
              label="抓取阅读量时覆盖文章内容缓存"
            />
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[300px] p-3 text-sm text-gray-500">
                  抓取阅读量时同步更新文章内容缓存，会增加存储占用。
                </p>
              </template>
              <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="mt-0.5 size-5" />
            </UPopover>
          </div>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-4">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">同步节奏</p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">控制单个公众号翻页同步时的请求间隔。</p>
        </div>

        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div class="max-w-md">
            <p class="flex items-center gap-1 text-sm">
              <span>公众号同步随机间隔</span>
              <UPopover mode="hover" :popper="{ placement: 'top' }">
                <template #panel>
                  <p class="max-w-[300px] p-3 text-sm text-gray-500">
                    全量同步单个公众号时，每次请求之间会在这个秒数区间内随机等待。区间越小越快，但风控风险越高，建议最小值不小于 3 秒。
                  </p>
                </template>
                <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
              </UPopover>
            </p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">每次翻页抓取都会在这个范围内随机等待，避免固定节奏过于明显。</p>
          </div>

          <div class="grid w-full gap-3 md:w-auto md:grid-cols-[minmax(0,9rem)_auto_minmax(0,9rem)] md:items-center">
            <UInput
              type="number"
              v-model="preferences.accountSyncMinSeconds"
              placeholder="最小秒数"
              class="w-full font-mono md:w-36"
            >
              <template #trailing>
                <span class="text-xs text-gray-500 dark:text-gray-400">秒</span>
              </template>
            </UInput>

            <span class="text-center text-sm text-slate-400">~</span>

            <UInput
              type="number"
              v-model="preferences.accountSyncMaxSeconds"
              placeholder="最大秒数"
              class="w-full font-mono md:w-36"
            >
              <template #trailing>
                <span class="text-xs text-gray-500 dark:text-gray-400">秒</span>
              </template>
            </UInput>
          </div>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-4">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">RSSHub</p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            用于 `rsshub://...` 订阅和 RSSHub 搜索结果添加，建议填写你自己的 RSSHub 服务地址。
          </p>
        </div>

        <div class="space-y-3">
          <UInput
            v-model="preferences.rsshubBaseUrl"
            type="url"
            placeholder="https://rsshub.example.com"
            class="font-mono"
          />
          <p class="text-sm text-slate-500 dark:text-slate-400">
            留空时仍可直接添加普通 RSS 地址，但 `rsshub://...` 路由不会再使用默认公共实例。
          </p>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-4">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">新榜推荐</p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            用于“添加订阅 → 公众号”里的新榜月榜推荐。填写你在新榜官网登录后的完整 Cookie 后，系统会按分类拉取公众号指数榜月榜并支持一键添加。
          </p>
        </div>

        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-end gap-2">
            <UButton size="xs" color="gray" variant="soft" icon="i-lucide:clipboard-paste" @click="pasteNewrankCookie">
              粘贴
            </UButton>
            <UButton size="xs" color="gray" variant="soft" icon="i-lucide:trash-2" @click="clearNewrankCookie">
              清空
            </UButton>
          </div>

          <UTextarea
            v-model="preferences.newrankCookie"
            :rows="3"
            autoresize
            placeholder="示例：acw_tc=...; Hm_lvt_xxx=...; token=...;"
            class="font-mono"
          />
          <p class="text-sm text-slate-500 dark:text-slate-400">
            建议直接粘贴浏览器里复制出的完整 Cookie。Cookie 过期后，新榜推荐会返回空榜单或提示重新配置。
          </p>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <span
              v-if="newrankCookieStatusText"
              class="text-xs"
              :class="
                newrankCookieStatus === 'success'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : newrankCookieStatus === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500 dark:text-slate-400'
              "
            >
              {{ newrankCookieStatusText }}
            </span>
            <UButton
              size="sm"
              color="gray"
              variant="soft"
              icon="i-lucide:badge-check"
              :loading="testingNewrankCookie"
              @click="verifyNewrankCookie"
            >
              检测 Cookie
            </UButton>
          </div>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-slate-100">同步时间范围</p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">限制同步公众号时向历史回溯的时间窗口。</p>
          </div>
          <span
            class="inline-flex items-center rounded-full border border-sky-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-sky-700 shadow-[0_10px_20px_rgba(14,165,233,0.08)] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
          >
            实际范围：{{ getActualDateRange() }}
          </span>
        </div>

        <div class="mt-4 flex flex-col gap-3">
          <USelectMenu
            class="w-full"
            v-model="preferences.syncDateRange"
            :options="DURATION_OPTIONS"
            value-attribute="value"
            option-attribute="label"
          />
          <UPopover v-if="preferences.syncDateRange === 'point'" :popper="{ placement: 'bottom-start' }">
            <UButton color="gray" class="rounded-full" icon="i-heroicons-calendar-days-20-solid" :label="formatDate()" />

            <template #panel="{ close }">
              <BaseDatePicker v-model="preferences.syncDatePoint" is-required @close="close" />
            </template>
          </UPopover>
        </div>
      </section>
      <div class="flex justify-end">
        <UButton color="black" icon="i-lucide:save" :loading="savingPreferences" @click="saveMiscSettings">
          保存
        </UButton>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import { testNewrankCookie } from '~/apis';
import useSavePreferences from '~/composables/useSavePreferences';
import toastFactory from '~/composables/toast';
import type { Preferences } from '~/types/preferences';

const { getActualDateRange, getSelectOptions } = useSyncDeadline();

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const { saveNow, saving: savingPreferences } = useSavePreferences();
const toast = toastFactory();
const testingNewrankCookie = ref(false);
const newrankCookieStatus = ref<'idle' | 'success' | 'error'>('idle');
const newrankCookieStatusText = ref('');
const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

const DURATION_OPTIONS = getSelectOptions();

function formatDate() {
  return dayjs.unix(preferences.value.syncDatePoint).format('YYYY-MM-DD');
}

async function pasteNewrankCookie() {
  try {
    preferences.value.newrankCookie = await navigator.clipboard.readText();
    toast.success('已粘贴 Cookie', '新榜 Cookie 已从剪贴板填入。');
  } catch (error: any) {
    toast.warning('无法读取剪贴板', String(error?.message || '请检查浏览器剪贴板权限。'));
  }
}

function clearNewrankCookie() {
  preferences.value.newrankCookie = '';
  newrankCookieStatus.value = 'idle';
  newrankCookieStatusText.value = '';
  toast.info('已清空 Cookie', '新榜 Cookie 已清空。');
}

async function saveMiscSettings() {
  try {
    await saveNow();
    toast.success('已保存');
  } catch (error: any) {
    toast.error(String(
      error?.data?.statusMessage || error?.statusMessage || error?.message || '保存失败'
    ));
  }
}

async function verifyNewrankCookie() {
  if (testingNewrankCookie.value) {
    return;
  }

  testingNewrankCookie.value = true;
  newrankCookieStatus.value = 'idle';
  newrankCookieStatusText.value = '检测中...';

  try {
    const result = await testNewrankCookie(String(preferences.value.newrankCookie || '').trim());
    newrankCookieStatus.value = result.ok ? 'success' : 'error';
    newrankCookieStatusText.value = result.text || (result.ok ? 'Cookie 有效' : 'Cookie 无效');
  } catch (error: any) {
    newrankCookieStatus.value = 'error';
    newrankCookieStatusText.value = String(
      error?.data?.statusMessage || error?.statusMessage || error?.message || '新榜 Cookie 检测失败'
    );
  } finally {
    testingNewrankCookie.value = false;
  }
}

watch(
  () => preferences.value.newrankCookie,
  () => {
    newrankCookieStatus.value = 'idle';
    newrankCookieStatusText.value = '';
  }
);
</script>


