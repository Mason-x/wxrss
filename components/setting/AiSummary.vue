<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">AI 功能</h3>
      <p class="text-sm text-slate-500">
        同步时会先为当天新文章生成结构化摘要，再基于摘要内容自动打标签并生成 AI 日报。
      </p>
    </template>

    <div class="ai-settings-form space-y-5">
      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">接口连接</p>
        </div>

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
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">文章摘要系统提示词</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            摘要模型必须只返回 JSON。当前标签定义会在服务端自动拼接进这段提示词，所以修改标签变量或解释后，摘要判定也会自动更新。
          </p>
        </div>

        <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:clipboard-paste" @click="pasteTextIntoField('aiSummarySystemPrompt', '文章摘要提示词')">
            粘贴
          </UButton>
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:trash-2" @click="clearTextField('aiSummarySystemPrompt', '文章摘要提示词')">
            清空
          </UButton>
        </div>

        <UTextarea
          v-model="preferences.aiSummarySystemPrompt"
          :rows="16"
          autoresize
          placeholder="输入文章摘要使用的系统提示词"
          class="font-mono text-sm"
        />
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-slate-100">AI 标签定义</p>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              摘要 JSON 的 <code>tags</code> 会直接写入文章标签。默认是阅读价值四档，你也可以继续扩展自己的标签池。
            </p>
          </div>
          <UButton size="sm" color="gray" variant="soft" icon="i-lucide:plus" @click="addTagDefinition">
            添加标签
          </UButton>
        </div>

        <div class="space-y-3">
          <div
            class="hidden gap-3 px-1 text-xs font-medium text-slate-500 md:grid md:grid-cols-[minmax(0,0.76fr)_minmax(0,0.9fr)_84px_minmax(0,1.4fr)_36px]"
          >
            <span>标签名</span>
            <span>变量名</span>
            <span>颜色</span>
            <span>标签解释</span>
            <span class="text-right">操作</span>
          </div>

          <div
            v-for="(item, index) in preferences.aiTagDefinitions"
            :key="`tag-definition-${index}`"
            class="grid gap-3 rounded-[22px] bg-white/75 p-3 ring-1 ring-slate-200/70 dark:bg-slate-950/40 dark:ring-slate-800/70 md:grid-cols-[minmax(0,0.76fr)_minmax(0,0.9fr)_84px_minmax(0,1.4fr)_36px]"
          >
            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">标签名</span>
              <UInput v-model="item.label" placeholder="如：精华" @blur="syncTagDefinition(index)" />
            </label>

            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">变量名</span>
              <UInput
                v-model="item.variable"
                placeholder="如：{{featured}}"
                class="font-mono"
                @blur="syncTagDefinition(index)"
              />
            </label>

            <label class="space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">颜色</span>
              <div class="flex h-10 items-center justify-center rounded-[16px] border border-slate-200 bg-white px-2 dark:border-slate-800 dark:bg-slate-950/70">
                <input
                  v-model="item.color"
                  type="color"
                  class="h-8 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0"
                  @change="syncTagDefinition(index)"
                />
              </div>
            </label>

            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">标签解释</span>
              <UTextarea
                v-model="item.description"
                :rows="2"
                autoresize
                placeholder="描述这个标签命中的标准，例如：信息密度高、值得进入日报。"
                class="text-sm"
              />
            </label>

            <div class="flex justify-end md:pt-7">
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                icon="i-lucide:trash-2"
                @click="removeTagDefinition(index)"
              />
            </div>
          </div>
        </div>

        <p v-if="preferences.aiTagDefinitions.length === 0" class="mt-3 text-xs text-slate-500 dark:text-slate-400">
          还没有标签定义。可以先添加 `精华 / 略读 / 不读 / 软广`。
        </p>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">标签判定补充提示词</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            这段内容会拼接到摘要提示词后面，用来补充 “tags 应该如何判断”，不会额外触发一次模型调用。
          </p>
        </div>

        <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:clipboard-paste" @click="pasteTextIntoField('aiTagSystemPrompt', '标签判定提示词')">
            粘贴
          </UButton>
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:trash-2" @click="clearTextField('aiTagSystemPrompt', '标签判定提示词')">
            清空
          </UButton>
        </div>

        <UTextarea
          v-model="preferences.aiTagSystemPrompt"
          :rows="6"
          autoresize
          placeholder="输入标签判定的补充规则，例如：商业转化意图明显时在主标签之外追加 {{sponsored}}。"
          class="font-mono text-sm"
        />
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">AI 日报系统提示词</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            AI 日报只消费当天文章的结构化摘要字段，不会再次把原文整篇发给模型。
          </p>
        </div>

        <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:clipboard-paste" @click="pasteTextIntoField('aiDailyReportSystemPrompt', 'AI 日报提示词')">
            粘贴
          </UButton>
          <UButton size="xs" color="gray" variant="soft" icon="i-lucide:trash-2" @click="clearTextField('aiDailyReportSystemPrompt', 'AI 日报提示词')">
            清空
          </UButton>
        </div>

        <UTextarea
          v-model="preferences.aiDailyReportSystemPrompt"
          :rows="8"
          autoresize
          placeholder="输入给 AI 的日报系统提示词"
          class="font-mono text-sm"
        />
      </section>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { request } from '#shared/utils/request';
import toastFactory from '~/composables/toast';
import type { AiTagDefinition, Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const toast = toastFactory();
const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testStatusText = ref('');

const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

function slugifyTagVariable(value: string, fallback = ''): string {
  const raw = String(value || '').trim();
  const fallbackText = String(fallback || '').trim();
  const source = String(raw || fallbackText)
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9_\-\s]+/g, ' ')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  if (normalized) {
    return `{{${normalized}}}`;
  }

  const plain = String(raw || fallbackText)
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .slice(0, 48);
  return plain ? `{{${plain}}}` : '';
}

function ensureTagDefinitions() {
  if (!Array.isArray(preferences.value.aiTagDefinitions)) {
    preferences.value.aiTagDefinitions = [];
  }
}

function normalizeTagColor(value: string): string {
  const matched = /^#([0-9a-fA-F]{6})$/.exec(String(value || '').trim());
  return matched ? `#${matched[1].toLowerCase()}` : '#94a3b8';
}

function syncTagDefinition(index: number) {
  ensureTagDefinitions();
  const current = preferences.value.aiTagDefinitions[index];
  if (!current) {
    return;
  }

  preferences.value.aiTagDefinitions[index] = {
    label: String(current.label || '').trim(),
    variable: slugifyTagVariable(current.variable, current.label),
    description: String(current.description || '').trim(),
    color: normalizeTagColor(current.color),
  };
}

function addTagDefinition() {
  ensureTagDefinitions();
  preferences.value.aiTagDefinitions.push({
    label: '',
    variable: '',
    description: '',
    color: '#94a3b8',
  } as AiTagDefinition);
}

function removeTagDefinition(index: number) {
  ensureTagDefinitions();
  preferences.value.aiTagDefinitions.splice(index, 1);
}

async function pasteTextIntoField(key: 'aiSummarySystemPrompt' | 'aiTagSystemPrompt' | 'aiDailyReportSystemPrompt', label: string) {
  try {
    const text = await navigator.clipboard.readText();
    preferences.value[key] = text;
    toast.success('已粘贴内容', `${label} 已从剪贴板填入。`);
  } catch (error: any) {
    toast.warning('无法读取剪贴板', String(error?.message || '请检查浏览器剪贴板权限。'));
  }
}

function clearTextField(key: 'aiSummarySystemPrompt' | 'aiTagSystemPrompt' | 'aiDailyReportSystemPrompt', label: string) {
  preferences.value[key] = '';
  toast.info('已清空内容', `${label} 已清空。`);
}

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

<style scoped>
.ai-settings-form :deep(input),
.ai-settings-form :deep(textarea),
.ai-settings-form :deep(button[role='combobox']) {
  font-size: 16px !important;
}

@media (min-width: 768px) {
  .ai-settings-form :deep(input),
  .ai-settings-form :deep(textarea),
  .ai-settings-form :deep(button[role='combobox']) {
    font-size: 14px !important;
  }
}
</style>
