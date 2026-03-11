import type { AiTagDefinition } from '~/types/preferences';

export interface AiSummaryConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export interface StructuredArticleSummary {
  tags: string[];
  rating: string;
  summary: string;
  highlights: string[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

const DEFAULT_READING_TIER_TAGS = new Set(['{{featured}}', '{{skim}}', '{{skip}}']);
const SPONSORED_TAG = '{{sponsored}}';

function normalizeTagVariable(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const plain = raw.replace(/^\{\{\s*|\s*\}\}$/g, '').trim().toLowerCase();
  if (!plain) {
    return '';
  }

  const normalized = plain
    .replace(/[^a-z0-9_\-\s]+/g, ' ')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return normalized ? `{{${normalized}}}` : '';
}

function normalizeSystemPrompt(input?: string): string {
  return String(input || '').trim();
}

function stripCodeFence(text: string): string {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function formatPublishedAt(value?: number | string): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value * 1000));
  }

  const text = String(value || '').trim();
  return text || '';
}

function buildDynamicTagDefinitionBlock(tagDefinitions: AiTagDefinition[]): string {
  if (!Array.isArray(tagDefinitions) || tagDefinitions.length === 0) {
    return '';
  }

  const variables = tagDefinitions
    .map(definition => normalizeTagVariable(definition.variable))
    .filter(Boolean);
  const exclusiveReadingTags = variables.filter(tag => DEFAULT_READING_TIER_TAGS.has(tag));
  const hasSponsoredTag = variables.includes(SPONSORED_TAG);

  return [
    '以下标签定义来自当前设置，请严格以它们为准。',
    '输出要求：tags 数组必须包含 1 到 2 个变量标签。',
    exclusiveReadingTags.length > 0
      ? `互斥规则：${exclusiveReadingTags.join('、')} 最多只能出现一个。`
      : '',
    hasSponsoredTag && exclusiveReadingTags.length > 0
      ? `${SPONSORED_TAG} 可以和其中一个同时出现。`
      : '',
    ...tagDefinitions.map(definition => `- ${definition.label} -> ${definition.variable}：${definition.description}`),
  ].join('\n');
}

export function buildRuntimeSummarySystemPrompt(
  basePrompt: string,
  tagDefinitions: AiTagDefinition[],
  extraGuidance?: string
): string {
  const sections = [normalizeSystemPrompt(basePrompt)];
  const tagBlock = buildDynamicTagDefinitionBlock(tagDefinitions);
  if (tagBlock) {
    sections.push(tagBlock);
  }

  const guidance = normalizeSystemPrompt(extraGuidance);
  if (guidance) {
    sections.push(`标签判定补充规则：\n${guidance}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

export function normalizeChatCompletionsUrl(input?: string): string {
  const fallback = 'https://api.openai.com/v1';
  const trimmed = String(input || fallback).trim() || fallback;
  if (/\/chat\/completions\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  return `${trimmed.replace(/\/+$/, '')}/chat/completions`;
}

export function normalizeArticleContent(input?: string): string {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 24000);
}

export function buildArticleSummaryUserPrompt(input: {
  title: string;
  content: string;
  account?: string;
  author?: string;
  publishedAt?: number | string;
}): string {
  const lines = [`文章标题：${String(input.title || '').trim() || '无标题'}`];
  const account = String(input.account || '').trim();
  const author = String(input.author || '').trim();
  const publishedAt = formatPublishedAt(input.publishedAt);

  if (account) {
    lines.push(`来源账号：${account}`);
  }
  if (author) {
    lines.push(`作者：${author}`);
  }
  if (publishedAt) {
    lines.push(`发布时间：${publishedAt}`);
  }

  lines.push('', '文章内容：', normalizeArticleContent(input.content));
  return lines.join('\n');
}

export function readCompletionText(payload: ChatCompletionResponse): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map(item => String(item?.text || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

export function parseAiJsonObject<T = Record<string, any>>(raw: string): T {
  const normalized = stripCodeFence(raw);
  try {
    return JSON.parse(normalized) as T;
  } catch {
    const match = normalized.match(/\{[\s\S]*\}$/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'AI 接口返回的 JSON 无法解析',
    });
  }
}

function normalizeStructuredSummaryTags(payload: any, allowedVariables: string[] = []): string[] {
  const allowSet = new Set(
    allowedVariables
      .map(variable => normalizeTagVariable(variable))
      .filter(Boolean)
  );

  const inputTags = Array.isArray(payload?.tags)
    ? payload.tags
    : payload?.rating
      ? [payload.rating]
      : [];

  const normalized = Array.from(
    new Set(
      inputTags
        .map((item: unknown) => normalizeTagVariable(item))
        .filter(Boolean)
        .filter(tag => allowSet.size === 0 || allowSet.has(tag))
    )
  );

  if (normalized.length === 0) {
    return [];
  }

  const primaryReadingTag = normalized.find(tag => DEFAULT_READING_TIER_TAGS.has(tag)) || '';
  const firstNonSponsoredTag = normalized.find(tag => !DEFAULT_READING_TIER_TAGS.has(tag) && tag !== SPONSORED_TAG) || '';
  const sponsoredTag = normalized.includes(SPONSORED_TAG) ? SPONSORED_TAG : '';

  return [primaryReadingTag || firstNonSponsoredTag, sponsoredTag || (primaryReadingTag ? firstNonSponsoredTag : '')]
    .filter(Boolean)
    .slice(0, 2);
}

export function parseStructuredArticleSummary(
  raw: string,
  allowedVariables: string[] = []
): StructuredArticleSummary | null {
  try {
    const payload = parseAiJsonObject<any>(raw);
    const tags = normalizeStructuredSummaryTags(payload, allowedVariables);
    const summary = String(payload?.summary || '').trim();
    const highlights = Array.isArray(payload?.highlights)
      ? payload.highlights
          .map((item: unknown) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];

    if (tags.length === 0 || !summary || highlights.length === 0) {
      return null;
    }

    return {
      tags,
      rating: tags[0],
      summary,
      highlights,
    };
  } catch {
    return null;
  }
}

export async function requestAiCompletionText(
  config: AiSummaryConfig,
  userPrompt: string,
  options?: {
    temperature?: number;
    systemPrompt?: string;
    timeoutMs?: number;
  }
): Promise<{ text: string; model: string }> {
  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || '').trim();

  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: '请先在设置里填写 AI API Key',
    });
  }

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: '请先在设置里填写 AI 模型',
    });
  }

  const endpoint = normalizeChatCompletionsUrl(config.baseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: Number.isFinite(options?.temperature) ? options.temperature : 0.2,
      messages: [
        {
          role: 'system',
          content: normalizeSystemPrompt(options?.systemPrompt || config.systemPrompt),
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(Math.max(1000, Number(options?.timeoutMs) || 60000)),
  });

  const rawText = await response.text();
  let payload: ChatCompletionResponse = {};

  try {
    payload = JSON.parse(rawText || '{}') as ChatCompletionResponse;
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: `AI 接口返回了无法解析的内容：${rawText.slice(0, 200)}`,
    });
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status || 502,
      statusMessage: String(payload?.error?.message || 'AI 请求失败'),
    });
  }

  const text = readCompletionText(payload);
  if (!text) {
    throw createError({
      statusCode: 502,
      statusMessage: 'AI 接口没有返回有效内容',
    });
  }

  return {
    text,
    model,
  };
}

export async function requestAiSummary(
  config: AiSummaryConfig,
  userPrompt: string,
  options?: {
    temperature?: number;
    systemPrompt?: string;
    timeoutMs?: number;
  }
): Promise<{ summary: string; model: string }> {
  const result = await requestAiCompletionText(config, userPrompt, options);
  return {
    summary: result.text,
    model: result.model,
  };
}
