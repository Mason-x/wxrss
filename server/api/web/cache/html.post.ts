import { upsertHtmlCache } from '~/server/repositories/cache';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

function getTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string {
  const part = parts?.find(item => item.name === name);
  if (!part?.data) return '';
  return Buffer.from(part.data).toString('utf8');
}

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const parts = await readMultipartFormData(event);
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'multipart form data is required' });
  }

  const filePart = parts.find(item => item.name === 'file');
  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: 'file is required' });
  }

  const url = getTextField(parts, 'url').trim();
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' });
  }

  await upsertHtmlCache(authKey, {
    fakeid: getTextField(parts, 'fakeid').trim(),
    url,
    title: getTextField(parts, 'title'),
    commentID: getTextField(parts, 'commentID') || null,
    mimeType: filePart.type || 'text/html; charset=utf-8',
    content: Buffer.from(filePart.data),
  });

  return { ok: true };
});
