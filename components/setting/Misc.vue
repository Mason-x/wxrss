<template>
  <UCard class="mx-4 mt-10 flex-1">
    <template #header>
      <h3 class="text-2xl font-semibold">其他</h3>
    </template>

    <div class="flex">
      <div class="flex-1 flex flex-col space-y-3">
        <div class="flex gap-1">
          <UCheckbox v-model="preferences.hideDeleted" name="hideDeleted" label="隐藏已删除文章" />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm text-gray-500">
                是否在文章列表中显示已删除文章。开启后会过滤掉已删除文章。
              </p>
            </template>
            <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
          </UPopover>
        </div>

        <div class="flex gap-1">
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
            <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
          </UPopover>
        </div>

        <div class="flex gap-1">
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
            <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
          </UPopover>
        </div>
      </div>

      <div class="flex-1 space-y-5">
        <div>
          <p class="flex items-center gap-1">
            <span class="text-sm">公众号同步频率：</span>
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[300px] p-3 text-sm text-gray-500">
                  全量同步单个公众号时的请求间隔秒数。数值越小越快，但风控风险越高，建议不小于 3 秒。
                </p>
              </template>
              <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
            </UPopover>
          </p>
          <UInput
            type="number"
            v-model="preferences.accountSyncSeconds"
            placeholder="配置公众号同步频率"
            class="w-52 font-mono"
          >
            <template #trailing>
              <span class="text-gray-500 dark:text-gray-400 text-xs">秒</span>
            </template>
          </UInput>
        </div>

        <div class="space-y-3">
          <div class="flex gap-1 items-center">
            <UCheckbox
              v-model="preferences.dailySyncEnabled"
              name="dailySyncEnabled"
              label="每日自动同步全部公众号"
            />
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[320px] p-3 text-sm text-gray-500">
                  每天按设定时间自动执行一次“全部公众号同步”。由服务端执行，页面无需打开。
                </p>
              </template>
              <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
            </UPopover>
          </div>

          <div>
            <p class="text-sm mb-1">执行时间</p>
            <UInput
              v-model="preferences.dailySyncTime"
              type="time"
              class="w-52 font-mono"
              :disabled="!preferences.dailySyncEnabled"
              @blur="normalizeDailySyncTime"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="border border-slate-200 p-3 rounded-md mt-5">
      <p class="flex justify-between items-center mb-3">
        <span class="text-xl font-medium">同步时间范围：</span>
        <span class="text-sm text-blue-500 font-medium">实际同步范围：{{ getActualDateRange() }}</span>
      </p>

      <div class="flex gap-3">
        <USelectMenu
          class="w-1/2"
          v-model="preferences.syncDateRange"
          :options="DURATION_OPTIONS"
          value-attribute="value"
          option-attribute="label"
        />
        <UPopover v-if="preferences.syncDateRange === 'point'" :popper="{ placement: 'bottom-start' }">
          <UButton color="gray" icon="i-heroicons-calendar-days-20-solid" :label="formatDate()" />

          <template #panel="{ close }">
            <BaseDatePicker v-model="preferences.syncDatePoint" is-required @close="close" />
          </template>
        </UPopover>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import type { Preferences } from '~/types/preferences';

const { getActualDateRange, getSelectOptions } = useSyncDeadline();

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const DURATION_OPTIONS = getSelectOptions();

function formatDate() {
  return dayjs.unix(preferences.value.syncDatePoint).format('YYYY-MM-DD');
}

function normalizeDailySyncTime() {
  const raw = String(preferences.value.dailySyncTime || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  preferences.value.dailySyncTime = match ? `${match[1]}:${match[2]}` : '06:00';
}
</script>
