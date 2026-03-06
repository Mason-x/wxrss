import { request } from '#shared/utils/request';
import { db } from './db';

export interface ResourceMapAsset {
  fakeid: string;
  url: string;
  resources: string[];
}

async function putResourceMapRemote(resourceMap: ResourceMapAsset): Promise<boolean> {
  await request('/api/web/cache/resource-map', {
    method: 'POST',
    body: {
      fakeid: resourceMap.fakeid || '',
      url: resourceMap.url,
      resources: Array.isArray(resourceMap.resources) ? resourceMap.resources : [],
    },
  });
  return true;
}

async function getResourceMapRemote(url: string): Promise<ResourceMapAsset | undefined> {
  const resp = await request<{ item: ResourceMapAsset | null }>('/api/web/cache/resource-map', {
    query: { url },
  });
  return resp?.item || undefined;
}

export async function updateResourceMapCache(resourceMap: ResourceMapAsset): Promise<boolean> {
  await putResourceMapRemote(resourceMap);
  return true;
}

export async function getResourceMapCache(url: string): Promise<ResourceMapAsset | undefined> {
  try {
    const remote = await getResourceMapRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db['resource-map'].get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putResourceMapRemote(local as ResourceMapAsset);
    await db['resource-map'].delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local as ResourceMapAsset;
}
