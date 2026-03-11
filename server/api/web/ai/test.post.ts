import { requestAiCompletionText } from '~/server/utils/ai-summary';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface AiTestRequestBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<AiTestRequestBody>(event);
  const result = await requestAiCompletionText(
    {
      baseUrl: body?.baseUrl,
      apiKey: body?.apiKey,
      model: body?.model,
      systemPrompt: body?.systemPrompt,
    },
    '请只回复“连接成功”。'
  );

  return {
    data: {
      ok: true,
      text: result.text,
    },
  };
});
