import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { getArticleByLink, updateArticleAiSummary, updateArticleAiTags } from '~/server/repositories/reader';
import {
  buildArticleSummaryUserPrompt,
  buildRuntimeSummarySystemPrompt,
  normalizeArticleContent,
  parseStructuredArticleSummary,
  requestAiSummary,
} from '~/server/utils/ai-summary';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleSummaryRequestBody {
  url?: string;
  title?: string;
  content?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ArticleSummaryRequestBody>(event);
  const url = String(body?.url || '').trim();
  const title = String(body?.title || '').trim();
  const content = normalizeArticleContent(body?.content);

  if (!title) {
    throw createError({
      statusCode: 400,
      statusMessage: '文章标题不能为空',
    });
  }

  if (!content) {
    throw createError({
      statusCode: 400,
      statusMessage: '文章正文不能为空',
    });
  }

  const { preferences } = await getStoredPreferencesByAuthKey(authKey);
  const allowedVariables = preferences.aiTagDefinitions.map(item => item.variable);

  if (url) {
    const existing = await getArticleByLink(authKey, url);
    const cachedSummary = String(existing?.ai_summary || '').trim();
    if (cachedSummary) {
      const parsedCached = parseStructuredArticleSummary(cachedSummary, allowedVariables);
      const currentTags = Array.isArray(existing?.ai_tags) ? existing.ai_tags : [];
      const cachedTags = parsedCached?.tags || [];
      if (cachedTags.length > 0 && JSON.stringify(currentTags) !== JSON.stringify(cachedTags)) {
        await updateArticleAiTags(authKey, url, cachedTags);
      }
      return {
        data: {
          summary: cachedSummary,
          model: 'cached',
          cached: true,
          tags: parsedCached?.tags || [],
          rating: parsedCached?.rating || '',
          summaryText: parsedCached?.summary || '',
          highlights: parsedCached?.highlights || [],
        },
      };
    }
  }

  const result = await requestAiSummary(
    {
      baseUrl: preferences.aiSummaryBaseUrl,
      apiKey: preferences.aiSummaryApiKey,
      model: preferences.aiSummaryModel,
      systemPrompt: preferences.aiSummarySystemPrompt,
    },
    buildArticleSummaryUserPrompt({
      title,
      content,
    }),
    {
      temperature: 0.2,
      systemPrompt: buildRuntimeSummarySystemPrompt(
        preferences.aiSummarySystemPrompt,
        preferences.aiTagDefinitions,
        preferences.aiTagSystemPrompt
      ),
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
