import { load } from 'cheerio';
import {
  DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT,
  DEFAULT_AI_TAG_SYSTEM_PROMPT,
} from '#shared/utils/preferences';
import type { AiTagDefinition } from '~/types/preferences';
import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import {
  getAiDailyReport,
  listAccountAiProcessingArticles,
  listAiProcessingArticles,
  type ReaderAiProcessingArticle,
  updateArticleAiSummary,
  updateArticleAiTags,
  upsertAiDailyReport,
} from '~/server/repositories/reader';
import {
  buildArticleSummaryUserPrompt,
  buildRuntimeSummarySystemPrompt,
  parseAiJsonObject,
  parseStructuredArticleSummary,
  requestAiCompletionText,
  requestAiSummary,
  type StructuredArticleSummary,
} from '~/server/utils/ai-summary';

interface AiDailyPayload {
  report_title?: string;
  report_html?: string;
}

interface PreparedAiArticle extends ReaderAiProcessingArticle {
  summaryPayload: StructuredArticleSummary;
}

export interface AiDailyProcessResult {
  processed: boolean;
  reportDate: string;
  taggedCount: number;
  reportUpdated: boolean;
  summarizedCount?: number;
  reason?: string;
}

export interface AiAccountBootstrapResult {
  processed: boolean;
  fakeid: string;
  taggedCount: number;
  summarizedCount: number;
  reason?: string;
}

const DAILY_AI_LOCKS = new Map<string, Promise<AiDailyProcessResult>>();

function getShanghaiDateKey(input = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(input);
}

function getShanghaiDayRange(dateKey = getShanghaiDateKey()): { dateKey: string; startTime: number; endTime: number } {
  const normalized = String(dateKey || '').trim() || getShanghaiDateKey();
  const start = new Date(`${normalized}T00:00:00+08:00`);
  const startTime = Math.floor(start.getTime() / 1000);
  return {
    dateKey: normalized,
    startTime,
    endTime: startTime + 24 * 60 * 60,
  };
}

function htmlToPlainText(html: string): string {
  const source = String(html || '').trim();
  if (!source) {
    return '';
  }

  try {
    const $ = load(source);
    $('script, style, noscript, iframe, svg').remove();
    return String($.root().text() || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  } catch {
    return source
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function takeMiddleSegment(text: string, size: number): string {
  if (text.length <= size) {
    return text;
  }
  const start = Math.max(0, Math.floor((text.length - size) / 2));
  return text.slice(start, start + size);
}

function buildSummarySourceText(article: ReaderAiProcessingArticle): string {
  const plainText = htmlToPlainText(article.cachedHtml);
  const digest = String(article.digest || '').trim();
  const source = plainText || digest;

  if (!source) {
    return '';
  }

  if (source.length <= 18000) {
    return source;
  }

  const head = source.slice(0, 8000);
  const middle = takeMiddleSegment(source, 5000);
  const tail = source.slice(-5000);
  return [head, middle, tail].filter(Boolean).join('\n\n');
}

function buildTagDefinitionLines(definitions: AiTagDefinition[]): string[] {
  if (!definitions.length) {
    return ['- 当前未配置标签定义。'];
  }

  return definitions.map(definition => `- ${definition.label} | ${definition.variable} | ${definition.description}`);
}

function buildRuntimeDailyReportSystemPrompt(basePrompt: string, tagDefinitions: AiTagDefinition[]): string {
  const definitionsBlock = [
    '当前标签定义：',
    ...buildTagDefinitionLines(tagDefinitions),
    'report_html 只能基于这些标签和结构化摘要写作，不要假装看过原文。',
  ].join('\n');

  return [String(basePrompt || '').trim() || DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT, definitionsBlock]
    .filter(Boolean)
    .join('\n\n');
}

function buildDailyPrompt(options: {
  dateKey: string;
  articles: PreparedAiArticle[];
}): string {
  const articleLines = options.articles.map(article =>
    JSON.stringify({
      link: article.link,
      title: article.title,
      account: article.accountName,
      author: article.authorName,
      published_at: article.updateTime || article.createTime,
      tags: article.summaryPayload.tags,
      summary: article.summaryPayload.summary,
      highlights: article.summaryPayload.highlights,
    })
  );

  return [
    `北京时间日期：${options.dateKey}`,
    '请返回一个 JSON 对象，结构如下：',
    '{',
    '  "report_title": "YYYY-MM-DD AI日报",',
    '  "report_html": "<section>...</section>"',
    '}',
    '补充要求：',
    '- 只输出 JSON，不要解释。',
    '- report_html 使用简洁 HTML 片段，不要输出 markdown，也不要包含 html/body 标签。',
    '- 如果当天没有值得写进日报的内容，report_html 返回空字符串。',
    '结构化摘要列表：',
    ...articleLines,
  ].join('\n');
}

async function ensureArticleSummaries(
  authKey: string,
  preferences: Awaited<ReturnType<typeof getStoredPreferencesByAuthKey>>['preferences'],
  tagDefinitions: AiTagDefinition[],
  articles: ReaderAiProcessingArticle[]
): Promise<{ summarizedCount: number; taggedCount: number; preparedArticles: PreparedAiArticle[] }> {
  const preparedArticles: PreparedAiArticle[] = [];
  let summarizedCount = 0;
  let taggedCount = 0;

  const allowedVariables = tagDefinitions.map(item => item.variable);
  const summarySystemPrompt = buildRuntimeSummarySystemPrompt(
    String(preferences.aiSummarySystemPrompt || '').trim(),
    tagDefinitions,
    String((preferences as any).aiTagSystemPrompt || '').trim() || DEFAULT_AI_TAG_SYSTEM_PROMPT
  );

  for (const article of articles) {
    let rawSummary = String(article.aiSummary || '').trim();
    let parsedSummary = parseStructuredArticleSummary(rawSummary, allowedVariables);

    if (!parsedSummary) {
      const sourceText = buildSummarySourceText(article);
      if (!sourceText) {
        continue;
      }

      try {
        const result = await requestAiSummary(
          {
            baseUrl: preferences.aiSummaryBaseUrl,
            apiKey: preferences.aiSummaryApiKey,
            model: preferences.aiSummaryModel,
            systemPrompt: preferences.aiSummarySystemPrompt,
          },
          buildArticleSummaryUserPrompt({
            title: article.title,
            account: article.accountName,
            author: article.authorName,
            publishedAt: article.updateTime || article.createTime,
            content: sourceText,
          }),
          {
            temperature: 0.2,
            systemPrompt: summarySystemPrompt,
            timeoutMs: 90000,
          }
        );

        rawSummary = String(result.summary || '').trim();
        parsedSummary = parseStructuredArticleSummary(rawSummary, allowedVariables);
        if (!parsedSummary) {
          continue;
        }

        await updateArticleAiSummary(authKey, article.link, rawSummary);
        article.aiSummary = rawSummary;
        summarizedCount += 1;
      } catch (error) {
        console.warn('AI summary generation failed:', article.link, error);
        continue;
      }
    }

    const nextTags = parsedSummary?.tags || [];
    const currentTags = Array.isArray(article.aiTags) ? article.aiTags : [];
    const tagsChanged = JSON.stringify(currentTags) !== JSON.stringify(nextTags);
    if (nextTags.length > 0 && tagsChanged) {
      try {
        await updateArticleAiTags(authKey, article.link, nextTags);
        article.aiTags = [...nextTags];
        taggedCount += 1;
      } catch (error) {
        console.warn('AI tag update failed:', article.link, error);
      }
    }

    preparedArticles.push({
      ...article,
      summaryPayload: parsedSummary,
    });
  }

  return {
    summarizedCount,
    taggedCount,
    preparedArticles,
  };
}

async function resolveAiPreferences(authKey: string) {
  const { preferences } = await getStoredPreferencesByAuthKey(authKey);
  const apiKey = String(preferences.aiSummaryApiKey || '').trim();
  const model = String(preferences.aiSummaryModel || '').trim();
  const baseUrl = String(preferences.aiSummaryBaseUrl || '').trim();

  return {
    preferences,
    configured: Boolean(apiKey && model && baseUrl),
  };
}

export async function runAiAccountBootstrap(
  authKey: string,
  fakeid: string,
  limit = 10
): Promise<AiAccountBootstrapResult> {
  const normalizedFakeid = String(fakeid || '').trim();
  if (!normalizedFakeid) {
    return {
      processed: false,
      fakeid: '',
      summarizedCount: 0,
      taggedCount: 0,
      reason: 'missing-fakeid',
    };
  }

  const { preferences, configured } = await resolveAiPreferences(authKey);
  if (!configured) {
    return {
      processed: false,
      fakeid: normalizedFakeid,
      summarizedCount: 0,
      taggedCount: 0,
      reason: 'not-configured',
    };
  }

  const articles = await listAccountAiProcessingArticles(authKey, normalizedFakeid, { limit });
  if (articles.length === 0) {
    return {
      processed: false,
      fakeid: normalizedFakeid,
      summarizedCount: 0,
      taggedCount: 0,
      reason: 'no-articles',
    };
  }

  const tagDefinitions = Array.isArray(preferences.aiTagDefinitions) ? preferences.aiTagDefinitions : [];
  const { summarizedCount, taggedCount } = await ensureArticleSummaries(authKey, preferences, tagDefinitions, articles);

  return {
    processed: summarizedCount > 0 || taggedCount > 0,
    fakeid: normalizedFakeid,
    summarizedCount,
    taggedCount,
    reason: summarizedCount > 0 || taggedCount > 0 ? undefined : 'up-to-date',
  };
}

async function runAiDailyDigestInternal(authKey: string, dateKey?: string): Promise<AiDailyProcessResult> {
  const { preferences, configured } = await resolveAiPreferences(authKey);
  if (!configured) {
    return {
      processed: false,
      reportDate: getShanghaiDateKey(),
      taggedCount: 0,
      reportUpdated: false,
      summarizedCount: 0,
      reason: 'not-configured',
    };
  }

  const range = getShanghaiDayRange(dateKey);
  const todayArticles = await listAiProcessingArticles(authKey, {
    startTime: range.startTime,
    endTime: range.endTime,
    limit: 80,
  });

  if (todayArticles.length === 0) {
    return {
      processed: false,
      reportDate: range.dateKey,
      taggedCount: 0,
      reportUpdated: false,
      summarizedCount: 0,
      reason: 'no-articles',
    };
  }

  const tagDefinitions = Array.isArray(preferences.aiTagDefinitions) ? preferences.aiTagDefinitions : [];
  const { summarizedCount, taggedCount, preparedArticles } = await ensureArticleSummaries(
    authKey,
    preferences,
    tagDefinitions,
    todayArticles
  );

  if (preparedArticles.length === 0) {
    return {
      processed: false,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated: false,
      summarizedCount,
      reason: 'no-valid-summaries',
    };
  }

  const currentReport = await getAiDailyReport(authKey, range.dateKey);
  const shouldRefreshReport = !currentReport || summarizedCount > 0 || taggedCount > 0;

  if (!shouldRefreshReport) {
    return {
      processed: taggedCount > 0 || summarizedCount > 0,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated: false,
      summarizedCount,
      reason: taggedCount > 0 || summarizedCount > 0 ? undefined : 'up-to-date',
    };
  }

  try {
    const result = await requestAiCompletionText(
      {
        baseUrl: preferences.aiSummaryBaseUrl,
        apiKey: preferences.aiSummaryApiKey,
        model: preferences.aiSummaryModel,
      },
      buildDailyPrompt({
        dateKey: range.dateKey,
        articles: preparedArticles,
      }),
      {
        temperature: 0.2,
        timeoutMs: 90000,
        systemPrompt: buildRuntimeDailyReportSystemPrompt(
          String(preferences.aiDailyReportSystemPrompt || '').trim() || DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT,
          tagDefinitions
        ),
      }
    );

    const payload = parseAiJsonObject<AiDailyPayload>(result.text);
    const reportHtml = String(payload.report_html || '').trim();
    let reportUpdated = false;

    if (reportHtml) {
      await upsertAiDailyReport(authKey, {
        reportDate: range.dateKey,
        title: String(payload.report_title || `${range.dateKey} AI日报`).trim() || `${range.dateKey} AI日报`,
        contentHtml: reportHtml,
        sourceCount: preparedArticles.length,
      });
      reportUpdated = true;
    }

    return {
      processed: summarizedCount > 0 || taggedCount > 0 || reportUpdated,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated,
      summarizedCount,
    };
  } catch (error) {
    console.warn('AI daily digest failed:', error);
    return {
      processed: summarizedCount > 0 || taggedCount > 0,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated: false,
      summarizedCount,
      reason: 'ai-error',
    };
  }
}

export async function runAiDailyDigest(authKey: string, dateKey?: string): Promise<AiDailyProcessResult> {
  const range = getShanghaiDayRange(dateKey);
  const lockKey = `${authKey}:${range.dateKey}`;
  const running = DAILY_AI_LOCKS.get(lockKey);
  if (running) {
    return await running;
  }

  const task = runAiDailyDigestInternal(authKey, range.dateKey).finally(() => {
    DAILY_AI_LOCKS.delete(lockKey);
  });
  DAILY_AI_LOCKS.set(lockKey, task);
  return await task;
}
