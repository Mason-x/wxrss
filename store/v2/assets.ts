import { db } from './db';

interface Asset {
  url: string;
  file: Blob;
  fakeid: string;
}

export type { Asset };

function decodeHeaderValue(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function putAssetRemote(asset: Asset): Promise<boolean> {
  const form = new FormData();
  form.append('fakeid', asset.fakeid || '');
  form.append('url', asset.url);
  form.append('file', asset.file, 'asset.bin');

  const response = await fetch('/api/web/cache/asset', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`cache asset upload failed: ${response.status}`);
  }
  return true;
}

async function getAssetRemote(url: string): Promise<Asset | undefined> {
  const response = await fetch(`/api/web/cache/asset?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  });

  if (response.status === 404 || response.status === 401) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`cache asset fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const fakeid = decodeHeaderValue(response.headers.get('x-cache-fakeid-uri'));
  const targetUrl = decodeHeaderValue(response.headers.get('x-cache-url-uri')) || url;
  return {
    url: targetUrl,
    file: blob,
    fakeid,
  };
}

export async function updateAssetCache(asset: Asset): Promise<boolean> {
  await putAssetRemote(asset);
  return true;
}

export async function getAssetCache(url: string): Promise<Asset | undefined> {
  try {
    const remote = await getAssetRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.asset.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putAssetRemote(local as Asset);
    await db.asset.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local as Asset;
}
