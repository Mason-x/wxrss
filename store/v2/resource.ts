import { db } from './db';

export interface ResourceAsset {
  fakeid: string;
  url: string;
  file: Blob;
}

function decodeHeaderValue(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function putResourceRemote(resource: ResourceAsset): Promise<boolean> {
  const form = new FormData();
  form.append('fakeid', resource.fakeid || '');
  form.append('url', resource.url);
  form.append('file', resource.file, 'resource.bin');

  const response = await fetch('/api/web/cache/resource', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`cache resource upload failed: ${response.status}`);
  }
  return true;
}

async function getResourceRemote(url: string): Promise<ResourceAsset | undefined> {
  const response = await fetch(`/api/web/cache/resource?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  });

  if (response.status === 404 || response.status === 401) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`cache resource fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const fakeid = decodeHeaderValue(response.headers.get('x-cache-fakeid-uri'));
  const targetUrl = decodeHeaderValue(response.headers.get('x-cache-url-uri')) || url;

  return {
    fakeid,
    url: targetUrl,
    file: blob,
  };
}

export async function updateResourceCache(resource: ResourceAsset): Promise<boolean> {
  await putResourceRemote(resource);
  return true;
}

export async function getResourceCache(url: string): Promise<ResourceAsset | undefined> {
  try {
    const remote = await getResourceRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.resource.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putResourceRemote(local);
    await db.resource.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local;
}
