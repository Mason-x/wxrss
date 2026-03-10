export interface AiSummaryConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
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

export async function requestAiSummary(
  config: AiSummaryConfig,
  userPrompt: string,
  options?: {
    temperature?: number;
  }
): Promise<{ summary: string; model: string }> {
  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || '').trim();

  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: '请先在设置中填写 AI API Key',
    });
  }

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: '请先在设置中填写 AI 模型',
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
      temperature: Number.isFinite(options?.temperature) ? options?.temperature : 0.3,
      messages: [
        {
          role: 'system',
          content: String(config.systemPrompt || '').trim(),
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
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

  const summary = readCompletionText(payload);
  if (!summary) {
    throw createError({
      statusCode: 502,
      statusMessage: 'AI 接口没有返回有效内容',
    });
  }

  return {
    summary,
    model,
  };
}
