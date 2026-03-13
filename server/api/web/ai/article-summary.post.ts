import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { getArticleByLink, updateArticleAiSummary, updateArticleAiTags } from '~/server/repositories/reader';
import {
  buildArticleSummaryUserPrompt,
  buildRuntimeSummarySystemPrompt,
  parseStructuredArticleSummary,
  requestAiSummary,
} from '~/server/utils/ai-summary';
import { enqueueAiTask } from '~/server/utils/ai-queue';
import {
  ensureArticleSummarySource,
  extractArticleSummaryContent,
  isArticleSummaryContentUsable,
} from '~/server/utils/article-summary-source';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleSummaryRequestBody {
  url?: string;
  title?: string;
  content?: string;
  force?: boolean;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  return await enqueueAiTask(authKey, async () => {
    const body = await readBody<ArticleSummaryRequestBody>(event);
    const url = String(body?.url || '').trim();
    const force = Boolean(body?.force);
    const existing = url ? await getArticleByLink(authKey, url) : null;
    const title = String(body?.title || existing?.title || '').trim();
    const providedContent = extractArticleSummaryContent(body?.content);
    const source = isArticleSummaryContentUsable(providedContent, {
      title,
      digest: String(existing?.digest || '').trim(),
    })
      ? {
          content: providedContent,
        }
      : await ensureArticleSummarySource(authKey, {
          fakeid: existing?.fakeid,
          link: url,
          title,
          digest: String(existing?.digest || '').trim(),
          cachedHtml: String(existing?.cachedHtml || ''),
        }, {
          preferredHtml: String(body?.content || ''),
          preferredContent: providedContent,
        });
    const content = String(source?.content || '').trim();

    if (!title) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '文章标题不能为空',
      });
    }

    if (!content) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '当前文章正文还未缓存，请先同步或打开正文后再生成摘要',
      });
    }

    const { preferences } = await getStoredPreferencesByAuthKey(authKey);
    const allowedVariables = preferences.aiTagDefinitions.map(item => item.variable);

    if (existing && !force) {
      const cachedSummary = String(existing.ai_summary || '').trim();
      if (cachedSummary) {
        const parsedCached = parseStructuredArticleSummary(cachedSummary, allowedVariables);
        if (parsedCached) {
          const currentTags = Array.isArray(existing.ai_tags) ? existing.ai_tags : [];
          const cachedTags = parsedCached.tags || [];
          if (cachedTags.length > 0 && JSON.stringify(currentTags) !== JSON.stringify(cachedTags)) {
            await updateArticleAiTags(authKey, url, cachedTags);
          }

          return {
            data: {
              summary: cachedSummary,
              model: 'cached',
              cached: true,
              tags: parsedCached.tags || [],
              rating: parsedCached.rating || '',
              summaryText: parsedCached.summary || '',
              highlights: parsedCached.highlights || [],
            },
          };
        }
      }
    }

    const result = await requestAiSummary(
      {
        baseUrl: preferences.aiSummaryBaseUrl,
        apiKey: preferences.aiSummaryApiKey,
        model: preferences.aiSummaryModel,
      },
      buildArticleSummaryUserPrompt({
        title,
        account: existing?.accountName,
        author: existing?.author_name,
        publishedAt: existing?.update_time || existing?.create_time,
        url: url || existing?.link,
        content,
      }),
      {
        temperature: 0.2,
        systemPrompt: buildRuntimeSummarySystemPrompt(preferences.aiTagDefinitions),
      }
    );

    const parsed = parseStructuredArticleSummary(result.summary, allowedVariables);

    if (url) {
      await updateArticleAiSummary(authKey, url, result.summary);
      if (parsed?.tags?.length) {
        await updateArticleAiTags(authKey, url, parsed.tags);
      }
    }

    return {
      data: {
        summary: result.summary,
        model: result.model,
        cached: false,
        tags: parsed?.tags || [],
        rating: parsed?.rating || '',
        summaryText: parsed?.summary || '',
        highlights: parsed?.highlights || [],
      },
    };
  });
});
