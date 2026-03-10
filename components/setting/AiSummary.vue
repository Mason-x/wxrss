<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">AI 摘要</h3>
      <p class="text-sm text-slate-500">配置 OpenAI 兼容接口与摘要提示词。</p>
    </template>

    <div class="space-y-5">
      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="space-y-2">
            <span class="text-sm font-medium text-slate-900 dark:text-slate-100">API Base URL</span>
            <UInput
              v-model="preferences.aiSummaryBaseUrl"
              type="url"
              placeholder="https://api.openai.com/v1"
              class="font-mono"
            />
          </label>

          <label class="space-y-2">
            <span class="text-sm font-medium text-slate-900 dark:text-slate-100">模型</span>
            <UInput v-model="preferences.aiSummaryModel" placeholder="gpt-4.1-mini" class="font-mono" />
          </label>
        </div>

        <label class="mt-4 block space-y-2">
          <span class="text-sm font-medium text-slate-900 dark:text-slate-100">API Key</span>
          <UInput
            v-model="preferences.aiSummaryApiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-..."
            class="font-mono"
          />
        </label>

        <div class="mt-4 flex items-center justify-end gap-3">
          <span
            v-if="testStatusText"
            class="text-xs"
            :class="
              testStatus === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : testStatus === 'error'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-500 dark:text-slate-400'
            "
          >
            {{ testStatusText }}
          </span>
          <UButton
            size="sm"
            color="gray"
            variant="soft"
            icon="i-lucide:plug-zap"
            :loading="testing"
            @click="testAiApi"
          >
            测试 API
          </UButton>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">系统提示词</p>
        </div>

        <UTextarea
          v-model="preferences.aiSummarySystemPrompt"
          :rows="6"
          autoresize
          placeholder="输入 AI 摘要的系统提示词"
          class="font-mono text-sm"
        />
      </section>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { request } from '#shared/utils/request';
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testStatusText = ref('');

const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

async function testAiApi() {
  if (testing.value) {
    return;
  }

  testing.value = true;
  testStatus.value = 'idle';
  testStatusText.value = '测试中...';

  try {
    const response = await request<{ data?: { ok?: boolean; text?: string } }>('/api/web/ai/test', {
      method: 'POST',
      body: {
        baseUrl: preferences.value.aiSummaryBaseUrl,
        apiKey: preferences.value.aiSummaryApiKey,
        model: preferences.value.aiSummaryModel,
        systemPrompt: preferences.value.aiSummarySystemPrompt,
      },
    });

    testStatus.value = 'success';
    testStatusText.value = String(response?.data?.text || '连接成功');
  } catch (error: any) {
    testStatus.value = 'error';
    testStatusText.value = String(
      error?.data?.statusMessage || error?.statusMessage || error?.message || 'AI 接口测试失败'
    );
  } finally {
    testing.value = false;
  }
}
</script>
