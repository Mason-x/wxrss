import { request } from '#shared/utils/request';
import { db } from './db';

export interface CommentAsset {
  fakeid: string;
  url: string;
  title: string;
  data: any;
}

async function putCommentRemote(comment: CommentAsset): Promise<boolean> {
  await request('/api/web/cache/comment', {
    method: 'POST',
    body: {
      fakeid: comment.fakeid || '',
      url: comment.url,
      title: comment.title || '',
      data: comment.data ?? null,
    },
  });
  return true;
}

async function getCommentRemote(url: string): Promise<CommentAsset | undefined> {
  const resp = await request<{ item: CommentAsset | null }>('/api/web/cache/comment', {
    query: { url },
  });
  return resp?.item || undefined;
}

export async function updateCommentCache(comment: CommentAsset): Promise<boolean> {
  await putCommentRemote(comment);
  return true;
}

export async function getCommentCache(url: string): Promise<CommentAsset | undefined> {
  try {
    const remote = await getCommentRemote(url);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.comment.get(url);
  if (!local) {
    return undefined;
  }

  try {
    await putCommentRemote(local);
    await db.comment.delete(url);
  } catch {
    // ignore lazy migration failure
  }

  return local;
}
