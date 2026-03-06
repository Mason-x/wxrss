import { request } from '#shared/utils/request';
import type { ArticleMetadata } from '~/utils/download/types';
import { db } from './db';

export type Metadata = ArticleMetadata & {
  fakeid: string;
  url: string;
  title: string;
};

async function putMetadataRemote(metadata: Metadata): Promise<boolean> {
  await request('/api/web/cache/metadata', {
    method: 'POST',
    body: {
      fakeid: metadata.fakeid || '',
      url: metadata.url,
      title: metadata.title || '',
      data: metadata,
    },
  });
  return true;
}

async function getMetadataRemote(url: string): Promise<Metadata | undefined> {
  const resp = await request<{ item: Metadata | null }>('/api/web/cache/metadata', {
    query: { url },
  });
  return resp?.item || undefined;
}

export async function updateMetadataCache(metadata: Metadata): Promise<boolean> {
  await putMetadataRemote(metadata);
  return true;
}

export async function getMetadataCache(url: string): Promise<Metadata | undefined> {
  try {
    const remote = await getMetadataRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.metadata.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putMetadataRemote(local as Metadata);
    await db.metadata.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local as Metadata;
}
