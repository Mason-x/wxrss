import { request } from '#shared/utils/request';
import { db } from './db';

export interface HtmlAsset {
  fakeid: string;
  url: string;
  file: Blob;
  title: string;
  commentID: string | null;
}

function decodeHeaderValue(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function putHtmlRemote(html: HtmlAsset): Promise<boolean> {
  const form = new FormData();
  form.append('fakeid', html.fakeid || '');
  form.append('url', html.url);
  form.append('title', html.title || '');
  form.append('commentID', html.commentID || '');
  form.append('file', html.file, 'article.html');

  const response = await fetch('/api/web/cache/html', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`cache html upload failed: ${response.status}`);
  }
  return true;
}

async function getHtmlRemote(url: string): Promise<HtmlAsset | undefined> {
  const response = await fetch(`/api/web/cache/html?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  });

  if (response.status === 404 || response.status === 401) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`cache html fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const fakeid = decodeHeaderValue(response.headers.get('x-cache-fakeid-uri'));
  const targetUrl = decodeHeaderValue(response.headers.get('x-cache-url-uri')) || url;
  const title = decodeHeaderValue(response.headers.get('x-cache-title-uri'));
  const commentID = decodeHeaderValue(response.headers.get('x-cache-comment-id-uri')) || null;

  return {
    fakeid,
    url: targetUrl,
    title,
    commentID,
    file: blob,
  };
}

export async function updateHtmlCache(html: HtmlAsset): Promise<boolean> {
  await putHtmlRemote(html);
  return true;
}

export async function getHtmlCache(url: string): Promise<HtmlAsset | undefined> {
  try {
    const remote = await getHtmlRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.html.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putHtmlRemote(local);
    await db.html.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local;
}

export async function deleteHtmlCache(url: string): Promise<boolean> {
  try {
    await request('/api/web/cache/html-delete', {
      method: 'POST',
      body: {
        url,
      },
    });
  } finally {
    await db.html.delete(url);
  }
  return true;
}
