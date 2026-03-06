import { request } from '#shared/utils/request';
import { db } from './db';

export interface DebugAsset {
  type: string;
  url: string;
  file: Blob;
  title: string;
  fakeid: string;
}

function decodeHeaderValue(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function base64ToBlob(base64: string, mimeType = 'application/octet-stream'): Blob {
  const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function putDebugRemote(item: DebugAsset): Promise<boolean> {
  const form = new FormData();
  form.append('fakeid', item.fakeid || '');
  form.append('url', item.url);
  form.append('title', item.title || '');
  form.append('type', item.type || '');
  form.append('file', item.file, 'debug.bin');

  const response = await fetch('/api/web/cache/debug', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`cache debug upload failed: ${response.status}`);
  }
  return true;
}

async function getDebugRemote(url: string): Promise<DebugAsset | undefined> {
  const response = await fetch(`/api/web/cache/debug?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  });

  if (response.status === 404 || response.status === 401) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`cache debug fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const fakeid = decodeHeaderValue(response.headers.get('x-cache-fakeid-uri'));
  const targetUrl = decodeHeaderValue(response.headers.get('x-cache-url-uri')) || url;
  const title = decodeHeaderValue(response.headers.get('x-cache-title-uri'));
  const type = decodeHeaderValue(response.headers.get('x-cache-type-uri'));
  return {
    fakeid,
    url: targetUrl,
    title,
    type,
    file: blob,
  };
}

export async function updateDebugCache(item: DebugAsset): Promise<boolean> {
  await putDebugRemote(item);
  return true;
}

export async function getDebugCache(url: string): Promise<DebugAsset | undefined> {
  try {
    const remote = await getDebugRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.debug.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putDebugRemote(local as DebugAsset);
    await db.debug.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local as DebugAsset;
}

export async function getDebugInfo(): Promise<DebugAsset[]> {
  try {
    const resp = await request<{
      list: Array<{
        fakeid: string;
        url: string;
        title: string;
        type: string;
        mimeType: string;
        contentBase64?: string;
      }>;
    }>('/api/web/cache/debug-list', {
      query: {
        limit: 1000,
        includeContent: 1,
      },
    });

    const rows = Array.isArray(resp?.list) ? resp.list : [];
    return rows
      .filter(row => Boolean(row?.url))
      .map(row => ({
        fakeid: row.fakeid || '',
        url: row.url || '',
        title: row.title || '',
        type: row.type || '',
        file: base64ToBlob(row.contentBase64 || '', row.mimeType || 'application/octet-stream'),
      }));
  } catch {
    return db.debug.toArray();
  }
}
