import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import { validateNewrankCookie } from '~/server/utils/newrank';

interface NewrankCookieTestBody {
  cookie?: string;
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<NewrankCookieTestBody>(event);
  const result = await validateNewrankCookie(body?.cookie);

  return {
    data: result,
  };
});
