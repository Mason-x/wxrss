import {
  buildAiCustomTagDefinitionPrompt,
  buildAiSummaryArticlePrompt,
  FIXED_AI_SUMMARY_SYSTEM_PROMPT as CLEAN_FIXED_AI_SUMMARY_SYSTEM_PROMPT,
} from '#shared/utils/ai-prompts';
import { BUILTIN_AI_QUALITY_TAG_DEFINITIONS, BUILTIN_AI_SPONSORED_TAG_DEFINITION } from '#shared/utils/ai-tags';
import type { AiTagDefinition } from '~/types/preferences';

export interface AiSummaryConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export interface StructuredSummaryLabelObject {
  quality: string;
  sponsored?: string;
  custom: string[];
}

export interface StructuredArticleSummary {
  label: StructuredSummaryLabelObject;
  summary: string;
  tags: string[];
  rating: string;
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

const QUALITY_TAGS = BUILTIN_AI_QUALITY_TAG_DEFINITIONS.map(item => item.variable);
const QUALITY_TAG_SET = new Set(QUALITY_TAGS);
const SPONSORED_TAG = BUILTIN_AI_SPONSORED_TAG_DEFINITION.variable;

function normalizeTagVariable(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const plain = raw
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .trim()
    .toLowerCase();
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

export function buildRuntimeSummarySystemPrompt(tagDefinitions: AiTagDefinition[]): string {
  return [CLEAN_FIXED_AI_SUMMARY_SYSTEM_PROMPT, buildAiCustomTagDefinitionPrompt(tagDefinitions)]
    .filter(Boolean)
    .join('\n\n');
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
  content?: string;
  account?: string;
  author?: string;
  publishedAt?: number | string;
  url?: string;
}): string {
  return buildAiSummaryArticlePrompt({
    ...input,
    content: normalizeArticleContent(input.content),
  });
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
      statusMessage: 'Bad Gateway',
      message: 'AI 接口返回的 JSON 无法解析',
    });
  }
}

function normalizeUniqueTags(input: unknown[], allowSet?: Set<string>): string[] {
  return Array.from(
    new Set(
      input
        .map(item => normalizeTagVariable(item))
        .filter(Boolean)
        .filter(tag => !allowSet || allowSet.has(tag))
    )
  );
}

function normalizeLegacyTags(inputTags: unknown[], allowedCustomLabels: string[]): StructuredSummaryLabelObject | null {
  const normalized = normalizeUniqueTags(inputTags);
  if (normalized.length === 0) {
    return null;
  }

  const quality = normalized.find(tag => QUALITY_TAG_SET.has(tag)) || '';
  if (!quality) {
    return null;
  }

  const sponsored = normalized.includes(SPONSORED_TAG) ? SPONSORED_TAG : undefined;
  const customAllowSet =
    allowedCustomLabels.length > 0
      ? new Set(allowedCustomLabels.map(item => normalizeTagVariable(item)).filter(Boolean))
      : undefined;
  const custom = normalized
    .filter(tag => !QUALITY_TAG_SET.has(tag) && tag !== SPONSORED_TAG)
    .filter(tag => !customAllowSet || customAllowSet.has(tag))
    .slice(0, 3);

  return {
    quality,
    ...(sponsored ? { sponsored } : {}),
    custom,
  };
}

function normalizeStructuredSummaryLabelObject(
  payload: any,
  allowedCustomLabels: string[] = []
): StructuredSummaryLabelObject | null {
  const labelPayload = payload?.label;
  const customAllowSet =
    allowedCustomLabels.length > 0
      ? new Set(allowedCustomLabels.map(item => normalizeTagVariable(item)).filter(Boolean))
      : undefined;

  if (labelPayload && typeof labelPayload === 'object' && !Array.isArray(labelPayload)) {
    const quality = normalizeTagVariable(labelPayload.quality);
    if (!QUALITY_TAG_SET.has(quality)) {
      return null;
    }

    const sponsored = normalizeTagVariable(labelPayload.sponsored);
    const custom = normalizeUniqueTags(
      Array.isArray(labelPayload.custom) ? labelPayload.custom : [],
      customAllowSet
    ).slice(0, 3);

    return {
      quality,
      ...(sponsored === SPONSORED_TAG ? { sponsored: SPONSORED_TAG } : {}),
      custom,
    };
  }

  const singleLabel = normalizeTagVariable(labelPayload);
  if (singleLabel && QUALITY_TAG_SET.has(singleLabel)) {
    return {
      quality: singleLabel,
      custom: [],
    };
  }

  const legacyInput = Array.isArray(payload?.tags)
    ? payload.tags
    : payload?.rating
      ? [payload.rating]
      : singleLabel
        ? [singleLabel]
        : [];

  return normalizeLegacyTags(legacyInput, allowedCustomLabels);
}

function flattenStructuredSummaryTags(label: StructuredSummaryLabelObject): string[] {
  return [label.quality, ...(label.sponsored ? [label.sponsored] : []), ...label.custom].filter(Boolean);
}

export function parseStructuredArticleSummary(
  raw: string,
  allowedCustomLabels: string[] = []
): StructuredArticleSummary | null {
  try {
    const payload = parseAiJsonObject<any>(raw);
    const label = normalizeStructuredSummaryLabelObject(payload, allowedCustomLabels);
    const summary = String(payload?.summary || payload?.summaryText || '').trim();

    if (!label || !summary) {
      return null;
    }

    return {
      label,
      summary,
      tags: flattenStructuredSummaryTags(label),
      rating: label.quality,
      highlights: [],
    };
  } catch {
    return null;
  }
}

function isH3ErrorLike(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error);
}

function isFetchTimeoutError(error: unknown): boolean {
  const name = String((error as any)?.name || '').trim();
  const message = String((error as any)?.message || '').trim();
  return name === 'AbortError' || name === 'TimeoutError' || /aborted/i.test(message) || /timeout/i.test(message);
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
  const requestOptions = options ?? {};

  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请先在设置里填写 AI API Key',
    });
  }

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请先在设置里填写 AI 模型',
    });
  }

  const endpoint = normalizeChatCompletionsUrl(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: Number.isFinite(requestOptions.temperature) ? requestOptions.temperature : 0.2,
        messages: [
          {
            role: 'system',
            content: normalizeSystemPrompt(requestOptions.systemPrompt || config.systemPrompt),
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(1000, Number(requestOptions.timeoutMs) || 60000)),
    });
  } catch (error) {
    if (isH3ErrorLike(error)) {
      throw error;
    }

    if (isFetchTimeoutError(error)) {
      throw createError({
        statusCode: 504,
        statusMessage: 'Gateway Timeout',
        message: 'AI 请求超时，请稍后重试或更换更快的模型/接口',
      });
    }

    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: String((error as Error)?.message || 'AI 请求失败'),
    });
  }

  const rawText = await response.text();
  let payload: ChatCompletionResponse = {};

  try {
    payload = JSON.parse(rawText || '{}') as ChatCompletionResponse;
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `AI 接口返回了无法解析的内容：${rawText.slice(0, 200)}`,
    });
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status || 502,
      statusMessage: response.status === 400 ? 'Bad Request' : 'Bad Gateway',
      message: String(payload?.error?.message || 'AI 请求失败'),
    });
  }

  const text = readCompletionText(payload);
  if (!text) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'AI 接口没有返回有效内容',
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
