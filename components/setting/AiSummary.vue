<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-xl font-semibold md:text-2xl">AI 功能</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            摘要协议固定为 <code class="font-mono text-xs">label + summary</code>，系统标签由服务端内置，自定义标签和日报筛选在这里配置。
          </p>
        </div>

        <UButton
          size="sm"
          color="gray"
          variant="soft"
          icon="i-lucide:rotate-ccw"
          @click="resetAiDefaults"
        >
          重置默认
        </UButton>
      </div>
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
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">固定摘要协议</p>
          <p class="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
            摘要系统提示词由服务端固定维护，不在前端修改。模型必须只输出一个合法 JSON，并严格使用下面的协议。
          </p>
        </div>

        <div
          class="rounded-[22px] bg-white/80 p-4 text-sm leading-6 ring-1 ring-slate-200/70 dark:bg-slate-950/50 dark:ring-slate-800/70"
        >
          <pre
            v-pre
            class="whitespace-pre-wrap break-all font-mono text-xs text-slate-700 dark:text-slate-200"
          >{
  "label": {
    "quality": "{{featured}}",
    "sponsored": "{{sponsored}}",
    "custom": ["{{custom_tag}}"]
  },
  "summary": "一段高信息密度摘要"
}</pre>
          <ul class="mt-3 space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <li><code class="font-mono">label.quality</code> 固定三选一：<code v-pre class="font-mono">{{featured}}</code> / <code v-pre class="font-mono">{{skim}}</code> / <code v-pre class="font-mono">{{skip}}</code></li>
            <li><code class="font-mono">label.sponsored</code> 只在明显软广时输出</li>
            <li><code class="font-mono">label.custom</code> 只从你配置的自定义标签里选，最多 3 个</li>
            <li><code class="font-mono">summary</code> 会直接用于内容页摘要和 AI 日报</li>
          </ul>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">系统内置标签</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            这 4 个标签由系统固定维护，不可修改。排序优先级依次为：内容质量、软广、自定义标签。
          </p>
        </div>

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div
            v-for="tag in builtinTagDefinitions"
            :key="tag.variable"
            class="rounded-[22px] bg-white/80 p-4 ring-1 ring-slate-200/70 dark:bg-slate-950/50 dark:ring-slate-800/70"
          >
            <span
              class="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold leading-none text-white"
              :style="{ backgroundColor: tag.color }"
            >
              {{ tag.label }}
            </span>
            <p class="mt-3 font-mono text-xs text-slate-600 dark:text-slate-300">{{ tag.variable }}</p>
            <p class="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{{ tag.description }}</p>
          </div>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-slate-100">自定义标签</p>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              这些标签会作为补充标签注入摘要引擎。AI 只能从这里选择，最多输出 3 个。
            </p>
          </div>
          <UButton size="sm" color="gray" variant="soft" icon="i-lucide:plus" @click="addTagDefinition">
            添加标签
          </UButton>
        </div>

        <div class="space-y-3">
          <div
            class="hidden gap-3 px-1 text-xs font-medium text-slate-500 md:grid md:grid-cols-[minmax(0,0.72fr)_minmax(0,0.9fr)_84px_minmax(0,1.58fr)_36px]"
          >
            <span>标签名</span>
            <span>变量名</span>
            <span>颜色</span>
            <span>标签解释</span>
            <span class="text-right">操作</span>
          </div>

          <div
            v-for="(item, index) in customTagDefinitionsDraft"
            :key="`tag-definition-${index}`"
            class="grid gap-3 rounded-[22px] bg-white/80 p-3 ring-1 ring-slate-200/70 dark:bg-slate-950/50 dark:ring-slate-800/70 md:grid-cols-[minmax(0,0.72fr)_minmax(0,0.9fr)_84px_minmax(0,1.58fr)_36px]"
          >
            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">标签名</span>
              <UInput
                :model-value="item.label"
                placeholder="如：AI 投资"
                @update:model-value="updateTagDefinitionField(index, 'label', $event)"
                @blur="syncTagDefinition(index)"
              />
            </label>

            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">变量名</span>
              <UInput
                :model-value="item.variable"
                placeholder="如：{{ai_investment}}"
                class="font-mono"
                @update:model-value="updateTagDefinitionField(index, 'variable', $event)"
                @blur="syncTagDefinition(index)"
              />
            </label>

            <label class="space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">颜色</span>
              <div
                class="flex h-10 items-center justify-center rounded-[16px] border border-slate-200 bg-white px-2 dark:border-slate-800 dark:bg-slate-950/70"
              >
                <input
                  :value="item.color"
                  type="color"
                  class="h-8 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0"
                  @input="updateTagDefinitionField(index, 'color', ($event.target as HTMLInputElement)?.value || '')"
                  @change="syncTagDefinition(index)"
                />
              </div>
            </label>

            <label class="min-w-0 space-y-1.5">
              <span class="text-[11px] font-medium text-slate-500 md:hidden">标签解释</span>
              <UTextarea
                :model-value="item.description"
                :rows="2"
                autoresize
                placeholder="说明这个标签在什么情况下成立"
                class="text-sm"
                @update:model-value="updateTagDefinitionField(index, 'description', $event)"
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

        <p v-if="customTagDefinitionsDraft.length === 0" class="mt-3 text-xs text-slate-500 dark:text-slate-400">
          当前没有自定义标签。系统只会输出内置的内容质量标签和可选软广标签。
        </p>

        <div class="mt-4 flex justify-end">
          <UButton
            color="black"
            icon="i-lucide:save"
            :loading="savingPreferences"
            @click="saveAiSettings"
          >
            保存
          </UButton>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">AI 日报标签筛选</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            AI 日报只会使用命中这些标签的文章摘要生成。默认只包含 <code v-pre class="font-mono text-[11px]">{{featured}}</code>。
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            v-for="tag in availableDailyReportLabels"
            :key="`report-label-${tag.variable}`"
            type="button"
            class="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150"
            :class="
              isDailyReportLabelIncluded(tag.variable)
                ? 'border-transparent text-white shadow-[0_10px_20px_rgba(15,23,42,0.12)]'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white'
            "
            :style="isDailyReportLabelIncluded(tag.variable) ? { backgroundColor: tag.color } : undefined"
            @click="toggleDailyReportIncludedLabel(tag.variable)"
          >
            {{ tag.label }}
          </button>
        </div>
      </section>

      <section class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="mb-3">
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">AI 日报系统提示词</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            日报只消费文章的标题、来源信息、标签和摘要，不会再把原文全文重复发给模型。
          </p>
        </div>

        <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
          <UButton
            size="xs"
            color="gray"
            variant="soft"
            icon="i-lucide:clipboard-paste"
            @click="pasteTextIntoField('aiDailyReportSystemPrompt', 'AI 日报提示词')"
          >
            粘贴
          </UButton>
          <UButton
            size="xs"
            color="gray"
            variant="soft"
            icon="i-lucide:trash-2"
            @click="clearTextField('aiDailyReportSystemPrompt', 'AI 日报提示词')"
          >
            清空
          </UButton>
        </div>

        <UTextarea
          v-model="preferences.aiDailyReportSystemPrompt"
          :rows="8"
          autoresize
          placeholder="输入生成 AI 日报的系统提示词"
          class="font-mono text-sm"
        />
      </section>
    </div>
    <div class="flex justify-end">
      <UButton color="black" icon="i-lucide:save" :loading="savingPreferences" @click="saveAiSettings">
        保存
      </UButton>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { DEFAULT_PREFERENCES } from '#shared/utils/preferences';
import { request } from '#shared/utils/request';
import {
  BUILTIN_AI_TAG_DEFINITIONS,
  DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS,
} from '#shared/utils/ai-tags';
import useSavePreferences from '~/composables/useSavePreferences';
import toastFactory from '~/composables/toast';
import type { AiTagDefinition, Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const { saveNow, saving: savingPreferences } = useSavePreferences();
const toast = toastFactory();
const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testStatusText = ref('');
const draftSyncing = ref(false);
const customTagDefinitionsDraft = ref<AiTagDefinition[]>([]);
const dailyReportIncludedLabelsDraft = ref<string[]>([]);
const hasUnsavedPreferenceChanges = useState<boolean>('preferences-sync-dirty', () => false);

const builtinTagDefinitions = BUILTIN_AI_TAG_DEFINITIONS;
const CLEAN_DEFAULT_AI_SUMMARY_PROMPT =
  '内置固定摘要协议：服务端会自动注入标签定义，并要求模型只输出 {"label": {...}, "summary": "..."}。';
const CLEAN_DEFAULT_AI_TAG_PROMPT =
  '内置固定标签协议：标签语义、标签数量、标签说明和判定标准均由系统根据当前标签定义动态注入。';
const CLEAN_DEFAULT_AI_DAILY_REPORT_PROMPT = [
  '你是一名中文内容编辑，负责基于当天文章的结构化摘要生成 AI 日报。',
  '日报只参考文章标题、来源信息、label 和 summary，不要假设自己读过原文。',
  '优先使用高价值标签的内容作为主线；对明显低价值或明显推广的内容保持克制，不要写成日报重点。',
  '如果某篇内容带有宣传导向，但仍有信息价值，可以引用其信息点，但不要写成推荐口吻。',
  '日报目标是帮助用户快速了解当天最值得读的内容、值得跟进的话题和关键观点。',
  '输出内容要克制、清晰、有主题分组，不要写成流水账，也不要使用营销口吻。',
  'report_html 请使用简洁的 HTML 片段，不要输出 markdown，也不要包含 html/body 标签。',
  '如果当天没有足够值得整理的内容，可以返回简短日报，但不要杜撰观点或细节。',
].join('\n');

const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

const availableDailyReportLabels = computed(() => {
  const customDefinitions = normalizeLocalTagDefinitions(customTagDefinitionsDraft.value, {
    dropEmpty: false,
  });
  const definitions = [
    ...builtinTagDefinitions,
    ...customDefinitions,
  ];

  const map = new Map<string, AiTagDefinition>();
  for (const item of definitions) {
    const variable = String(item?.variable || '').trim();
    if (variable && !map.has(variable)) {
      map.set(variable, item);
    }
  }

  return Array.from(map.values());
});

function looksCorruptedPromptText(value: unknown) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  const stripped = text.replace(/[\s\n\r\t.,:;!'"()[\]{}\-_/\\|<>`~@#$%^&*+=]+/g, '');
  const placeholderMatches = stripped.match(/[?？�]/g) || [];
  const placeholderRatio = stripped.length > 0 ? placeholderMatches.length / stripped.length : 0;

  return placeholderMatches.length >= 6
    || placeholderRatio >= 0.25
    || /label\s*\?\s*summary/i.test(text)
    || /report_html\s+\?{2,}/i.test(text)
    || text.includes('???? AI ???')
    || text.includes('???????');
}

function sanitizePromptFieldsInPlace() {
  if (looksCorruptedPromptText(preferences.value.aiSummarySystemPrompt)) {
    preferences.value.aiSummarySystemPrompt = CLEAN_DEFAULT_AI_SUMMARY_PROMPT;
  }
  if (looksCorruptedPromptText(preferences.value.aiTagSystemPrompt)) {
    preferences.value.aiTagSystemPrompt = CLEAN_DEFAULT_AI_TAG_PROMPT;
  }
  if (looksCorruptedPromptText(preferences.value.aiDailyReportSystemPrompt)) {
    preferences.value.aiDailyReportSystemPrompt = CLEAN_DEFAULT_AI_DAILY_REPORT_PROMPT;
  }
}

function cloneDefaultCustomTagDefinitions(): AiTagDefinition[] {
  return DEFAULT_PREFERENCES.aiTagDefinitions.map(item => ({ ...item }));
}

function markDraftDirty() {
  if (!draftSyncing.value) {
    hasUnsavedPreferenceChanges.value = true;
  }
}

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

  const plain = (raw || fallbackText)
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .slice(0, 48);

  return plain ? `{{${plain}}}` : '';
}

function normalizeTagColor(color: string, fallback = '#94a3b8') {
  const value = String(color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function ensureCustomTagDefinitions() {
  if (!Array.isArray(customTagDefinitionsDraft.value)) {
    customTagDefinitionsDraft.value = [];
  }
}

function updateTagDefinitionField(
  index: number,
  field: keyof AiTagDefinition,
  value: string
) {
  ensureCustomTagDefinitions();
  const target = customTagDefinitionsDraft.value[index];
  if (!target) {
    return;
  }

  target[field] = String(value || '');
  markDraftDirty();
}

function makeUniqueTagVariable(variable: string, seen: Set<string>) {
  const normalized = slugifyTagVariable(variable);
  if (!normalized) {
    return '';
  }

  if (!seen.has(normalized)) {
    seen.add(normalized);
    return normalized;
  }

  const base = normalized.replace(/^\{\{\s*|\s*\}\}$/g, '');
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `{{${base}_${index}}}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
  }

  return normalized;
}

function normalizeLocalTagDefinitions(
  definitions: unknown,
  options: {
    dropEmpty: boolean;
  }
) {
  const source = Array.isArray(definitions) ? definitions : [];
  const seen = new Set<string>();

  return source.flatMap(item => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const sourceItem = item as Partial<AiTagDefinition>;
    const label = String(sourceItem.label || '').trim().slice(0, 32);
    const description = String(sourceItem.description || '').trim().slice(0, 240);
    const color = normalizeTagColor(sourceItem.color || '', '#94a3b8');

    if (!label) {
      return options.dropEmpty ? [] : [{
        label: '',
        variable: '',
        description,
        color,
      }];
    }

    const variable = makeUniqueTagVariable(slugifyTagVariable(String(sourceItem.variable || ''), label), seen);

    return [{
      label,
      variable,
      description,
      color,
    }];
  });
}

function normalizeDailyReportIncludedLabelsSelection(value: unknown) {
  const allowed = new Set(availableDailyReportLabels.value.map(item => item.variable));
  const normalized = Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter(item => allowed.has(item))
    )
  );

  return normalized.length > 0
    ? normalized
    : DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS.filter(item => allowed.has(item));
}

function syncDraftFromPreferences() {
  sanitizePromptFieldsInPlace();
  draftSyncing.value = true;
  customTagDefinitionsDraft.value = normalizeLocalTagDefinitions(preferences.value.aiTagDefinitions, {
    dropEmpty: false,
  });
  dailyReportIncludedLabelsDraft.value = normalizeDailyReportIncludedLabelsSelection(
    preferences.value.aiDailyReportIncludedLabels
  );
  nextTick(() => {
    draftSyncing.value = false;
  });
}

function syncTagDefinition(index: number) {
  ensureCustomTagDefinitions();
  const normalizedDefinitions = normalizeLocalTagDefinitions(customTagDefinitionsDraft.value, {
    dropEmpty: false,
  });
  customTagDefinitionsDraft.value = normalizedDefinitions;
  const target = normalizedDefinitions[index];
  if (!target) {
    return;
  }

  target.label = String(target.label || '').trim();
  target.variable = slugifyTagVariable(target.variable, target.label);
  target.description = String(target.description || '').trim();
  target.color = normalizeTagColor(target.color, '#94a3b8');
  dailyReportIncludedLabelsDraft.value = normalizeDailyReportIncludedLabelsSelection(
    dailyReportIncludedLabelsDraft.value
  );
  markDraftDirty();
}

function addTagDefinition() {
  ensureCustomTagDefinitions();
  customTagDefinitionsDraft.value.push({
    label: '',
    variable: '',
    description: '',
    color: '#94a3b8',
  });
  markDraftDirty();
}

function removeTagDefinition(index: number) {
  ensureCustomTagDefinitions();
  customTagDefinitionsDraft.value.splice(index, 1);
  dailyReportIncludedLabelsDraft.value = normalizeDailyReportIncludedLabelsSelection(
    dailyReportIncludedLabelsDraft.value
  );
  markDraftDirty();
}

function isDailyReportLabelIncluded(variable: string) {
  return dailyReportIncludedLabelsDraft.value.includes(variable);
}

function toggleDailyReportIncludedLabel(variable: string) {
  const current = new Set(dailyReportIncludedLabelsDraft.value || []);
  if (current.has(variable)) {
    current.delete(variable);
  } else {
    current.add(variable);
  }

  dailyReportIncludedLabelsDraft.value = normalizeDailyReportIncludedLabelsSelection(Array.from(current));
  markDraftDirty();
}

function resetAiDefaults() {
  preferences.value.aiSummarySystemPrompt = CLEAN_DEFAULT_AI_SUMMARY_PROMPT;
  preferences.value.aiTagSystemPrompt = CLEAN_DEFAULT_AI_TAG_PROMPT;
  preferences.value.aiDailyReportSystemPrompt = CLEAN_DEFAULT_AI_DAILY_REPORT_PROMPT;
  customTagDefinitionsDraft.value = cloneDefaultCustomTagDefinitions();
  dailyReportIncludedLabelsDraft.value = [...DEFAULT_PREFERENCES.aiDailyReportIncludedLabels];
  markDraftDirty();
  testStatus.value = 'idle';
  testStatusText.value = '';
  toast.success('已恢复默认 AI 设置');
}

async function saveAiSettings() {
  try {
    if (import.meta.client && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
      await nextTick();
      await new Promise(resolve => window.setTimeout(resolve, 16));
    }
    preferences.value.aiTagDefinitions = normalizeLocalTagDefinitions(customTagDefinitionsDraft.value, {
      dropEmpty: true,
    });
    preferences.value.aiDailyReportIncludedLabels = normalizeDailyReportIncludedLabelsSelection(
      dailyReportIncludedLabelsDraft.value
    );
    await saveNow();
    syncDraftFromPreferences();
    toast.success('已保存');
  } catch (error: any) {
    toast.error(String(error?.data?.statusMessage || error?.statusMessage || error?.message || '保存失败'));
  }
}

async function pasteTextIntoField(field: 'aiDailyReportSystemPrompt', label: string) {
  if (!navigator.clipboard?.readText) {
    toast.error('当前环境不支持读取剪贴板');
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    preferences.value[field] = text;
    toast.success(`已粘贴${label}`);
  } catch {
    toast.error(`粘贴${label}失败`);
  }
}

function clearTextField(field: 'aiDailyReportSystemPrompt', label: string) {
  preferences.value[field] = '';
  toast.success(`已清空${label}`);
}

async function testAiApi() {
  if (!preferences.value.aiSummaryBaseUrl || !preferences.value.aiSummaryApiKey || !preferences.value.aiSummaryModel) {
    testStatus.value = 'error';
    testStatusText.value = '请先填写 Base URL、API Key 和模型';
    return;
  }

  testing.value = true;
  testStatus.value = 'idle';
  testStatusText.value = '';

  try {
    await request('/api/web/ai/test', {
      method: 'POST',
      body: {
        baseUrl: preferences.value.aiSummaryBaseUrl,
        apiKey: preferences.value.aiSummaryApiKey,
        model: preferences.value.aiSummaryModel,
      },
    });
    testStatus.value = 'success';
    testStatusText.value = '连接成功';
  } catch (error: any) {
    testStatus.value = 'error';
    testStatusText.value = String(error?.data?.message || error?.message || '连接失败');
  } finally {
    testing.value = false;
  }
}

watch(
  () => [preferences.value.aiTagDefinitions, preferences.value.aiDailyReportIncludedLabels],
  () => {
    if (!draftSyncing.value) {
      syncDraftFromPreferences();
    }
  },
  { deep: true, immediate: true }
);

watch(
  () => [
    preferences.value.aiSummarySystemPrompt,
    preferences.value.aiTagSystemPrompt,
    preferences.value.aiDailyReportSystemPrompt,
  ],
  () => {
    if (!draftSyncing.value) {
      sanitizePromptFieldsInPlace();
    }
  },
  { immediate: true }
);

watch(
  [customTagDefinitionsDraft, dailyReportIncludedLabelsDraft],
  () => {
    if (!draftSyncing.value) {
      hasUnsavedPreferenceChanges.value = true;
    }
  },
  { deep: true }
);
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


