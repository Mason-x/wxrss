import { isArticleListPageCompleted } from '#shared/utils/account-profile';
import type {
  app_msg_item,
  ParsedProfileGetMsg,
  ProfileGetMsg_app_msg_ext_info,
  ProfileGetMsgGeneralList,
  ProfileGetMsgResponse,
} from '~/types/profile_getmsg';
import type { AppMsgEx } from '~/types/types';

export interface ParsedProfileArticlePage {
  articles: AppMsgEx[];
  completed: boolean;
  messageCount: number;
  nextOffset: number;
}

function decodeHtmlUrl(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .trim();
}

function normalizeArticleUrl(value: string): string {
  const decoded = decodeHtmlUrl(value);
  if (!decoded) {
    return '';
  }
  if (decoded.startsWith('//')) {
    return `https:${decoded}`;
  }
  if (decoded.startsWith('/')) {
    return `https://mp.weixin.qq.com${decoded}`;
  }
  return decoded;
}

function getUrlNumber(url: string, key: string): number {
  try {
    return Number(new URL(url).searchParams.get(key)) || 0;
  } catch {
    return 0;
  }
}

function toArticle(
  item: app_msg_item | ProfileGetMsg_app_msg_ext_info,
  fakeid: string,
  message: ParsedProfileGetMsg,
  fallbackItemidx: number
): AppMsgEx | null {
  const link = normalizeArticleUrl(item?.content_url || '');
  const title = String(item?.title || '').trim();
  if (!link || !title) {
    return null;
  }

  const appmsgid = getUrlNumber(link, 'mid') || Number(message?.comm_msg_info?.id) || 0;
  const itemidx = getUrlNumber(link, 'idx') || fallbackItemidx;
  const createTime = Number(message?.comm_msg_info?.datetime) || 0;

  return {
    aid: appmsgid > 0 ? `${fakeid}_${appmsgid}_${itemidx}` : '',
    appmsgid,
    itemidx,
    link,
    title,
    digest: String(item?.digest || ''),
    author_name: String(item?.author || ''),
    cover: normalizeArticleUrl(item?.cover || ''),
    create_time: createTime,
    update_time: createTime,
    item_show_type: Number(item?.item_show_type) || 0,
    media_duration: String(item?.duration || ''),
    appmsg_album_infos: [],
    copyright_stat: Number(item?.copyright_stat) || 0,
    copyright_type: 0,
    // getmsg 的 del_flag 对正常已发布文章通常是 1，不是删除标记。
    is_deleted: false,
    _status: '',
  } as unknown as AppMsgEx;
}

export function parseProfileGeneralMessageList(value: string): ParsedProfileGetMsg[] {
  if (!String(value || '').trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as ProfileGetMsgGeneralList | ParsedProfileGetMsg[];
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return Array.isArray(parsed?.list) ? parsed.list : [];
}

export function parseProfileArticlePage(
  response: ProfileGetMsgResponse,
  fakeid: string,
  offset = 0,
  requestedSize = 0
): ParsedProfileArticlePage {
  const messages = parseProfileGeneralMessageList(response?.general_msg_list || '');
  const articles: AppMsgEx[] = [];

  for (const message of messages) {
    const root = message?.app_msg_ext_info;
    if (!root) {
      continue;
    }

    const main = toArticle(root, fakeid, message, 1);
    if (main) {
      articles.push(main);
    }

    const children = Array.isArray(root.multi_app_msg_item_list) ? root.multi_app_msg_item_list : [];
    children.forEach((child, index) => {
      const article = toArticle(child, fakeid, message, index + 2);
      if (article) {
        articles.push(article);
      }
    });
  }

  const messageCount = Math.max(0, Number(response?.msg_count) || messages.length);
  const nextOffset = Math.max(offset + messageCount, Number(response?.next_offset) || 0);
  return {
    articles,
    completed: isArticleListPageCompleted(Number(response?.can_msg_continue), messageCount, requestedSize),
    messageCount,
    nextOffset,
  };
}
