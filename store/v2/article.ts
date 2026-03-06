import { request } from '#shared/utils/request';
import type { AppMsgEx, AppMsgExWithFakeID, PublishInfo, PublishPage } from '~/types/types';
import type { MpAccount } from './info';

export type ArticleAsset = AppMsgExWithFakeID;
export interface ArticleCacheSummary {
  cachedRows: number;
  cachedMessageCount: number;
  cachedAppmsgCount: number;
  oldestCreateTime: number;
}

export interface ArticleUpsertResult {
  inserted: number;
  totalCount: number;
}

function compactArticlePayload(article: Partial<AppMsgEx>): AppMsgEx {
  return {
    aid: String(article?.aid || ''),
    appmsgid: Number(article?.appmsgid) || 0,
    itemidx: Number(article?.itemidx) || 0,
    link: String(article?.link || ''),
    title: String(article?.title || ''),
    digest: String(article?.digest || ''),
    author_name: String(article?.author_name || ''),
    cover: String((article as any)?.cover || ''),
    create_time: Number(article?.create_time) || 0,
    update_time: Number(article?.update_time) || 0,
    item_show_type: Number(article?.item_show_type) || 0,
    media_duration: String((article as any)?.media_duration || ''),
    appmsg_album_infos: Array.isArray((article as any)?.appmsg_album_infos) ? (article as any).appmsg_album_infos : [],
    copyright_stat: Number((article as any)?.copyright_stat) || 0,
    copyright_type: Number((article as any)?.copyright_type) || 0,
    is_deleted: Boolean((article as any)?.is_deleted),
    _status: String((article as any)?._status || ''),
  } as unknown as AppMsgEx;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function buildArticleStorageKey(
  fakeid: string,
  article: Pick<AppMsgEx, 'aid' | 'appmsgid' | 'itemidx' | 'link' | 'create_time' | 'update_time' | 'title'>
): string {
  const aid = (article.aid || '').trim();
  if (aid) {
    return `${fakeid}:${aid}`;
  }

  if (Number.isFinite(article.appmsgid) && Number(article.appmsgid) > 0) {
    return `${fakeid}:appmsg:${article.appmsgid}:${article.itemidx || 0}`;
  }

  const link = (article.link || '').trim();
  if (link) {
    return `${fakeid}:link:${hashString(link)}`;
  }

  const fallback = `${fakeid}:${article.create_time || 0}:${article.update_time || 0}:${article.title || ''}`;
  return `${fakeid}:fallback:${hashString(fallback)}`;
}

function buildArticleUpsertPayload(
  account: MpAccount,
  articles: AppMsgEx[],
  totalCount?: number,
  completed = false,
  messageCountDelta?: number
) {
  const payload: Record<string, any> = {
    account: {
      fakeid: account.fakeid,
      nickname: account.nickname,
      round_head_img: account.round_head_img,
      category: account.category || '',
      focused: Boolean(account.focused),
      total_count: Number.isFinite(totalCount) ? Number(totalCount) : account.total_count,
    },
    articles: Array.isArray(articles) ? articles.map(compactArticlePayload) : [],
    totalCount: Number.isFinite(totalCount) ? Number(totalCount) : account.total_count,
    completed: Boolean(completed),
  };
  if (Number.isFinite(messageCountDelta)) {
    payload.messageCountDelta = Number(messageCountDelta);
  }
  return payload;
}

export async function upsertArticlePage(
  account: MpAccount,
  articles: AppMsgEx[],
  totalCount?: number,
  completed = false,
  messageCountDelta?: number
): Promise<ArticleUpsertResult> {
  const resp = await request<{ data?: { inserted?: number; totalCount?: number } }>('/api/web/reader/article-upsert', {
    method: 'POST',
    body: buildArticleUpsertPayload(account, articles, totalCount, completed, messageCountDelta),
  });
  return {
    inserted: Number(resp?.data?.inserted) || 0,
    totalCount: Number(resp?.data?.totalCount) || Number(totalCount) || 0,
  };
}

/**
 * 更新文章缓存
 * @param account
 * @param publish_page
 */
export async function updateArticleCache(account: MpAccount, publish_page: PublishPage, messageCountDelta?: number) {
  const publish_list = publish_page.publish_list.filter(item => !!item.publish_info);
  const articles = publish_list.flatMap(item => {
    const publish_info: PublishInfo = JSON.parse(item.publish_info);
    return publish_info.appmsgex.map(compactArticlePayload);
  });
  await upsertArticlePage(
    account,
    articles,
    publish_page.total_count,
    publish_list.length === 0,
    Number.isFinite(messageCountDelta) ? Number(messageCountDelta) : undefined
  );
}

/**
 * 检查是否存在指定时间之前的缓存
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function hitCache(fakeid: string, create_time: number): Promise<boolean> {
  const resp = await request<{ hit: boolean }>('/api/web/reader/article-hit', {
    query: {
      fakeid,
      create_time,
    },
  });
  return Boolean(resp.hit);
}

/**
 * 读取缓存中的指定时间之前的历史文章
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function getArticleCache(fakeid: string, create_time: number): Promise<AppMsgExWithFakeID[]> {
  const resp = await request<{ list: AppMsgExWithFakeID[] }>('/api/web/reader/article-list', {
    query: {
      fakeid,
      create_time,
      limit: 5000,
    },
  });
  return Array.isArray(resp.list) ? resp.list : [];
}

export async function getArticleCacheSummary(fakeid: string, create_time: number): Promise<ArticleCacheSummary> {
  const resp = await request<{ summary: ArticleCacheSummary }>('/api/web/reader/article-cache-summary', {
    query: {
      fakeid,
      create_time,
    },
  });
  return {
    cachedRows: Number(resp?.summary?.cachedRows) || 0,
    cachedMessageCount: Number(resp?.summary?.cachedMessageCount) || 0,
    cachedAppmsgCount: Number(resp?.summary?.cachedAppmsgCount) || 0,
    oldestCreateTime: Number(resp?.summary?.oldestCreateTime) || 0,
  };
}

/**
 * 根据 url 获取文章对象
 * @param url
 */
export async function getArticleByLink(url: string): Promise<AppMsgExWithFakeID> {
  const resp = await request<{ article: AppMsgExWithFakeID | null }>('/api/web/reader/article-by-link', {
    query: {
      url,
    },
  });
  if (!resp.article) {
    throw new Error(`Article(${url}) does not exist`);
  }
  return resp.article;
}

/**
 * 文章被删除
 * @param url
 * @param is_deleted
 */
export async function articleDeleted(url: string, is_deleted = true): Promise<void> {
  await request('/api/web/reader/article-deleted', {
    method: 'POST',
    body: {
      url,
      is_deleted,
    },
  });
}

/**
 * 更新文章状态
 * @param url
 * @param status
 */
export async function updateArticleStatus(url: string, status: string): Promise<void> {
  await request('/api/web/reader/article-status', {
    method: 'POST',
    body: {
      url,
      status,
    },
  });
}

export async function upsertArticlesFromRemote(
  account: MpAccount,
  articles: AppMsgEx[],
  totalCount?: number
): Promise<void> {
  await upsertArticlePage(account, articles, totalCount, false);
}
