import { load } from 'cheerio';
import { formatAiDailyReportDisplayTitle, normalizeAiDailyReportTopic } from '#shared/utils/ai-daily-report';
import { buildAiDailyReportSystemPrompt, buildAiDailyReportUserPrompt } from '#shared/utils/ai-prompts';
import { BUILTIN_AI_TAG_DEFINITIONS, DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS } from '#shared/utils/ai-tags';
import { DEFAULT_PREFERENCES } from '#shared/utils/preferences';
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
import { enqueueAiTask } from '~/server/utils/ai-queue';
import {
  buildArticleSummaryUserPrompt,
  buildRuntimeSummarySystemPrompt,
  parseAiJsonObject,
  parseStructuredArticleSummary,
  requestAiCompletionText,
  requestAiSummary,
  type StructuredArticleSummary,
} from '~/server/utils/ai-summary';
import { ensureArticleSummarySource } from '~/server/utils/article-summary-source';
import type { AiTagDefinition, Preferences } from '~/types/preferences';

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

interface RunAiDailyDigestOptions {
  forceReport?: boolean;
  bypassAutoSummaryToggle?: boolean;
}

const DAILY_AI_LOCKS = new Map<string, Promise<AiDailyProcessResult>>();

function isAiAutoSummaryOnSyncEnabled(preferences: Pick<Preferences, 'aiAutoSummaryOnSyncEnabled'>): boolean {
  return preferences.aiAutoSummaryOnSyncEnabled !== false;
}

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

function takeMiddleSegment(text: string, size: number): string {
  if (text.length <= size) {
    return text;
  }
  const start = Math.max(0, Math.floor((text.length - size) / 2));
  return text.slice(start, start + size);
}

function buildSummarySourceText(content: string): string {
  const source = String(content || '').trim();

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

function buildAvailableTagDefinitions(customDefinitions: AiTagDefinition[]): AiTagDefinition[] {
  return [...BUILTIN_AI_TAG_DEFINITIONS, ...customDefinitions];
}

function normalizeDailyReportIncludedLabels(input: unknown, customDefinitions: AiTagDefinition[]): string[] {
  const allowed = new Set<string>([
    ...BUILTIN_AI_TAG_DEFINITIONS.map(item => item.variable),
    ...customDefinitions.map(item => item.variable),
  ]);

  const normalized = Array.isArray(input)
    ? Array.from(
        new Set(
          input
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .filter(item => allowed.has(item))
        )
      )
    : [];

  return normalized.length > 0 ? normalized : DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS.filter(item => allowed.has(item));
}

function buildRuntimeDailyReportSystemPrompt(
  basePrompt: string,
  definitions: AiTagDefinition[],
  includedLabels: string[]
): string {
  return buildAiDailyReportSystemPrompt(basePrompt, definitions, includedLabels);
}

function buildDailyPrompt(options: {
  dateKey: string;
  articles: PreparedAiArticle[];
  includedLabels: string[];
}): string {
  return buildAiDailyReportUserPrompt({
    dateKey: options.dateKey,
    includedLabels: options.includedLabels,
    articles: options.articles.map(article => ({
      link: article.link,
      title: article.title,
      account: article.accountName,
      author: article.authorName,
      publishedAt: article.updateTime || article.createTime,
      label: article.summaryPayload.label,
      summary: article.summaryPayload.summary,
    })),
  });
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDailyReportSourceTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const valueByType = new Map(parts.map(part => [part.type, part.value]));
  const year = valueByType.get('year') || '0000';
  const month = valueByType.get('month') || '00';
  const day = valueByType.get('day') || '00';
  const hour = valueByType.get('hour') || '00';
  const minute = valueByType.get('minute') || '00';
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function buildDailyReportSourceMeta(article: PreparedAiArticle): string {
  const segments = [
    String(article.accountName || '').trim(),
    formatDailyReportSourceTime(Number(article.updateTime || article.createTime || 0)),
  ].filter(Boolean);

  return segments.join(' · ');
}

const AI_DAILY_REPORT_ALLOWED_TAGS = new Set([
  'section',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'blockquote',
  'code',
  'pre',
  'hr',
  'br',
]);

function normalizeHeadingText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeAiDailyReportBodyHtml(html: string, topic: string): string {
  const rawHtml = String(html || '').trim();
  if (!rawHtml) {
    return '';
  }

  const $ = load(`<div data-ai-daily-report-root="true">${rawHtml}</div>`, null, false);
  const root = $('[data-ai-daily-report-root="true"]');
  root.find('script, style, iframe, object, embed, form, button, input, textarea, select, svg, canvas').remove();

  root.find('*').each((_, element) => {
    const $element = $(element);
    let tagName = String(element.tagName || '').toLowerCase();

    if (!tagName) {
      return;
    }

    if (tagName === 'a') {
      $element.replaceWith($element.text());
      return;
    }

    if (tagName === 'h1') {
      element.tagName = 'h2';
      tagName = 'h2';
    }

    if (!AI_DAILY_REPORT_ALLOWED_TAGS.has(tagName)) {
      $element.replaceWith($element.contents());
      return;
    }

    Object.keys(element.attribs || {}).forEach(attribute => {
      $element.removeAttr(attribute);
    });
  });

  const reportTitle = formatAiDailyReportDisplayTitle(topic);
  const firstHeading = root.find('h1, h2, h3, h4').first();
  const firstHeadingText = normalizeHeadingText(firstHeading.text());
  if (
    firstHeadingText &&
    (firstHeadingText === reportTitle ||
      firstHeadingText === topic ||
      /^(今日聚焦|AI日报|AI 日报)/u.test(firstHeadingText))
  ) {
    firstHeading.remove();
  }

  root.find('section').each((_, element) => {
    const heading = $(element).children('h1, h2, h3, h4').first();
    const headingText = normalizeHeadingText(heading.text());
    if (/^(信息来源|来源列表|参考来源)$/u.test(headingText)) {
      $(element).remove();
    }
  });

  root.find('p, h2, h3, h4, li, blockquote').each((_, element) => {
    if (!normalizeHeadingText($(element).text())) {
      $(element).remove();
    }
  });

  root.find('ul, ol').each((_, element) => {
    if ($(element).children('li').length === 0) {
      $(element).remove();
    }
  });

  root.find('section').each((_, element) => {
    if (!normalizeHeadingText($(element).text()) && $(element).find('pre, hr').length === 0) {
      $(element).remove();
    }
  });

  return root.html()?.trim() || '';
}

function buildDailyReportHeaderHtml(dateKey: string, topic: string, sourceCount: number): string {
  return `
    <header class="ai-daily-report-header">
      <h1 class="ai-daily-report-title">${escapeHtml(formatAiDailyReportDisplayTitle(topic, dateKey))}</h1>
      <p class="ai-daily-report-meta">${escapeHtml(dateKey)} · ${sourceCount} 篇信息来源</p>
    </header>
  `.trim();
}

function buildDailyReportBodyHtml(bodyHtml: string): string {
  const normalizedBody = String(bodyHtml || '').trim();
  return `
    <section class="ai-daily-report-body">
      ${normalizedBody || '<p class="ai-daily-report-empty">AI 日报内容为空。</p>'}
    </section>
  `.trim();
}

function buildDailyReportSourcesHtml(articles: PreparedAiArticle[]): string {
  const uniqueArticles = Array.from(new Map(articles.map(article => [article.link, article])).values());
  if (uniqueArticles.length === 0) {
    return '';
  }

  return `
    <section class="ai-daily-report-sources">
      <h2>信息来源</h2>
      <ol class="ai-daily-report-source-list">
        ${uniqueArticles
          .map(article => {
            const sourceMeta = buildDailyReportSourceMeta(article);
            return `
              <li class="ai-daily-report-source-item">
                <a
                  class="ai-daily-report-source-link"
                  href="${escapeHtml(article.link || '#')}"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(article.title || '无标题')}
                </a>
                ${sourceMeta ? `<p class="ai-daily-report-source-meta">${escapeHtml(sourceMeta)}</p>` : ''}
              </li>
            `.trim();
          })
          .join('\n')}
      </ol>
    </section>
  `.trim();
}

function buildFinalDailyReportHtml(options: {
  dateKey: string;
  topic: string;
  bodyHtml: string;
  articles: PreparedAiArticle[];
}): string {
  const topic = normalizeAiDailyReportTopic(options.topic, options.dateKey);
  const bodyHtml = sanitizeAiDailyReportBodyHtml(options.bodyHtml, topic);
  const sourcesHtml = buildDailyReportSourcesHtml(options.articles);
  const sourceCount = new Set(options.articles.map(article => article.link)).size;

  return [
    buildDailyReportHeaderHtml(options.dateKey, topic, sourceCount),
    buildDailyReportBodyHtml(bodyHtml),
    sourcesHtml,
  ]
    .filter(Boolean)
    .join('\n');
}

function shouldIncludeArticleInDailyReport(article: PreparedAiArticle, includedLabels: string[]): boolean {
  if (!includedLabels.length) {
    return false;
  }
  return article.summaryPayload.tags.some(tag => includedLabels.includes(tag));
}

function needsDailyReportTemplateRefresh(report: Awaited<ReturnType<typeof getAiDailyReport>> | null): boolean {
  if (!report) {
    return true;
  }

  const title = String(report.title || '').trim();
  const contentHtml = String(report.contentHtml || '').trim();

  return (
    !title ||
    /AI日报|AI 日报/u.test(title) ||
    contentHtml.includes('ai-daily-report-entry') ||
    !contentHtml.includes('ai-daily-report-header') ||
    !contentHtml.includes('ai-daily-report-sources')
  );
}

async function ensureArticleSummaries(
  authKey: string,
  preferences: Preferences,
  customTagDefinitions: AiTagDefinition[],
  articles: ReaderAiProcessingArticle[]
): Promise<{ summarizedCount: number; taggedCount: number; preparedArticles: PreparedAiArticle[] }> {
  const preparedArticles: PreparedAiArticle[] = [];
  let summarizedCount = 0;
  let taggedCount = 0;

  const allowedCustomLabels = customTagDefinitions.map(item => item.variable);
  const summarySystemPrompt = buildRuntimeSummarySystemPrompt(customTagDefinitions);

  for (const article of articles) {
    let rawSummary = String(article.aiSummary || '').trim();
    let parsedSummary = parseStructuredArticleSummary(rawSummary, allowedCustomLabels);

    if (!parsedSummary) {
      const summarySource = await ensureArticleSummarySource(authKey, {
        fakeid: article.fakeid,
        link: article.link,
        title: article.title,
        digest: article.digest,
        cachedHtml: article.cachedHtml,
      });
      if (summarySource.refreshed && summarySource.html) {
        article.cachedHtml = summarySource.html;
      }
      const sourceText = buildSummarySourceText(summarySource.contentForPrompt);
      if (!sourceText) {
        continue;
      }

      try {
        const result = await requestAiSummary(
          {
            baseUrl: preferences.aiSummaryBaseUrl,
            apiKey: preferences.aiSummaryApiKey,
            model: preferences.aiSummaryModel,
          },
          buildArticleSummaryUserPrompt({
            title: article.title,
            account: article.accountName,
            author: article.authorName,
            publishedAt: article.updateTime || article.createTime,
            url: article.link,
            content: sourceText,
          }),
          {
            temperature: 0.2,
            systemPrompt: summarySystemPrompt,
            timeoutMs: 90000,
          }
        );

        rawSummary = String(result.summary || '').trim();
        parsedSummary = parseStructuredArticleSummary(rawSummary, allowedCustomLabels);
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

    const nextTags = parsedSummary.tags || [];
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

async function runAiAccountBootstrapInternal(
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
  if (!isAiAutoSummaryOnSyncEnabled(preferences)) {
    return {
      processed: false,
      fakeid: normalizedFakeid,
      summarizedCount: 0,
      taggedCount: 0,
      reason: 'disabled',
    };
  }
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

  const customTagDefinitions = Array.isArray(preferences.aiTagDefinitions) ? preferences.aiTagDefinitions : [];
  const { summarizedCount, taggedCount } = await ensureArticleSummaries(
    authKey,
    preferences,
    customTagDefinitions,
    articles
  );

  return {
    processed: summarizedCount > 0 || taggedCount > 0,
    fakeid: normalizedFakeid,
    summarizedCount,
    taggedCount,
    reason: summarizedCount > 0 || taggedCount > 0 ? undefined : 'up-to-date',
  };
}

async function runAiDailyDigestInternal(
  authKey: string,
  dateKey?: string,
  options: RunAiDailyDigestOptions = {}
): Promise<AiDailyProcessResult> {
  const range = getShanghaiDayRange(dateKey);
  const { preferences, configured } = await resolveAiPreferences(authKey);
  if (!options.bypassAutoSummaryToggle && !isAiAutoSummaryOnSyncEnabled(preferences)) {
    return {
      processed: false,
      reportDate: range.dateKey,
      taggedCount: 0,
      reportUpdated: false,
      summarizedCount: 0,
      reason: 'disabled',
    };
  }
  if (!configured) {
    return {
      processed: false,
      reportDate: range.dateKey,
      taggedCount: 0,
      reportUpdated: false,
      summarizedCount: 0,
      reason: 'not-configured',
    };
  }

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

  const customTagDefinitions = Array.isArray(preferences.aiTagDefinitions) ? preferences.aiTagDefinitions : [];
  const { summarizedCount, taggedCount, preparedArticles } = await ensureArticleSummaries(
    authKey,
    preferences,
    customTagDefinitions,
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

  const includedLabels = normalizeDailyReportIncludedLabels(
    preferences.aiDailyReportIncludedLabels,
    customTagDefinitions
  );
  const reportArticles = preparedArticles.filter(article => shouldIncludeArticleInDailyReport(article, includedLabels));

  if (reportArticles.length === 0) {
    return {
      processed: summarizedCount > 0 || taggedCount > 0,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated: false,
      summarizedCount,
      reason: 'no-report-articles',
    };
  }

  const currentReport = await getAiDailyReport(authKey, range.dateKey);
  const shouldRefreshReport =
    options.forceReport === true ||
    needsDailyReportTemplateRefresh(currentReport) ||
    summarizedCount > 0 ||
    taggedCount > 0;

  if (!shouldRefreshReport) {
    return {
      processed: false,
      reportDate: range.dateKey,
      taggedCount,
      reportUpdated: false,
      summarizedCount,
      reason: 'up-to-date',
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
        articles: reportArticles,
        includedLabels,
      }),
      {
        temperature: 0.2,
        timeoutMs: 90000,
        systemPrompt: buildRuntimeDailyReportSystemPrompt(
          String(preferences.aiDailyReportSystemPrompt || '').trim() || DEFAULT_PREFERENCES.aiDailyReportSystemPrompt,
          buildAvailableTagDefinitions(customTagDefinitions),
          includedLabels
        ),
      }
    );

    const payload = parseAiJsonObject<AiDailyPayload>(result.text);
    const reportTopic = normalizeAiDailyReportTopic(String(payload.report_title || '').trim(), range.dateKey);
    const sourceCount = new Set(reportArticles.map(article => article.link)).size;
    const reportHtml = buildFinalDailyReportHtml({
      dateKey: range.dateKey,
      topic: reportTopic,
      bodyHtml: String(payload.report_html || '').trim(),
      articles: reportArticles,
    });
    let reportUpdated = false;

    if (reportHtml) {
      await upsertAiDailyReport(authKey, {
        reportDate: range.dateKey,
        title: reportTopic,
        contentHtml: reportHtml,
        sourceCount,
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
    if (options.forceReport === true) {
      throw error;
    }

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

export async function runAiAccountBootstrap(
  authKey: string,
  fakeid: string,
  limit = 10
): Promise<AiAccountBootstrapResult> {
  return await enqueueAiTask(authKey, async () => await runAiAccountBootstrapInternal(authKey, fakeid, limit), {
    priority: 'background',
  });
}

export async function runAiDailyDigest(
  authKey: string,
  dateKey?: string,
  options: RunAiDailyDigestOptions = {}
): Promise<AiDailyProcessResult> {
  return await enqueueAiTask(
    authKey,
    async () => {
      const range = getShanghaiDayRange(dateKey);
      const lockKey = `${authKey}:${range.dateKey}`;
      const running = DAILY_AI_LOCKS.get(lockKey);
      if (running) {
        return await running;
      }

      const task = runAiDailyDigestInternal(authKey, range.dateKey, options).finally(() => {
        DAILY_AI_LOCKS.delete(lockKey);
      });

      DAILY_AI_LOCKS.set(lockKey, task);
      return await task;
    },
    {
      priority: 'background',
    }
  );
}
