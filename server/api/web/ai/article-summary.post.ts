import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';
import { normalizeArticleContent, requestAiSummary } from '~/server/utils/ai-summary';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface ArticleSummaryRequestBody {
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
  const result = await requestAiSummary(
    {
      baseUrl: preferences.aiSummaryBaseUrl,
      apiKey: preferences.aiSummaryApiKey,
      model: preferences.aiSummaryModel,
      systemPrompt: preferences.aiSummarySystemPrompt,
    },
    `文章标题：${title}\n\n文章正文：\n${content}`
  );

  return {
    data: result,
  };
});
