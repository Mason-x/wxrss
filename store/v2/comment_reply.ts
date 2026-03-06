import { request } from '#shared/utils/request';
import { db } from './db';

export interface CommentReplyAsset {
  fakeid: string;
  url: string;
  title: string;
  data: any;
  contentID: string;
}

async function putCommentReplyRemote(reply: CommentReplyAsset): Promise<boolean> {
  await request('/api/web/cache/comment-reply', {
    method: 'POST',
    body: {
      fakeid: reply.fakeid || '',
      url: reply.url,
      title: reply.title || '',
      contentID: reply.contentID,
      data: reply.data ?? null,
    },
  });
  return true;
}

async function getCommentReplyRemote(url: string, contentID: string): Promise<CommentReplyAsset | undefined> {
  const resp = await request<{ item: CommentReplyAsset | null }>('/api/web/cache/comment-reply', {
    query: {
      url,
      contentID,
    },
  });
  return resp?.item || undefined;
}

export async function updateCommentReplyCache(reply: CommentReplyAsset): Promise<boolean> {
  await putCommentReplyRemote(reply);
  return true;
}

export async function getCommentReplyCache(url: string, contentID: string): Promise<CommentReplyAsset | undefined> {
  try {
    const remote = await getCommentReplyRemote(url, contentID);
    if (remote) {
      return remote;
    }
  } catch {
    // fallback to legacy IndexedDB cache
  }

  const local = await db.comment_reply.get(`${url}:${contentID}`);
  if (!local) {
    return undefined;
  }

  try {
    await putCommentReplyRemote(local as CommentReplyAsset);
    await db.comment_reply.delete(`${url}:${contentID}`);
  } catch {
    // ignore lazy migration failure
  }

  return local as CommentReplyAsset;
}
