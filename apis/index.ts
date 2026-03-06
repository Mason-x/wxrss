import { request } from '#shared/utils/request';
import { ACCOUNT_LIST_PAGE_SIZE, ARTICLE_LIST_PAGE_SIZE } from '~/config';
import { upsertArticlePage } from '~/store/v2/article';
import { type MpAccount, updateLastUpdateTime } from '~/store/v2/info';
import type { CommentResponse } from '~/types/comment';
import type {
  AccountInfo,
  AppMsgEx,
  BaseResp,
  GetAuthKeyResult,
  PublishInfo,
  PublishPage,
  SearchBizResponse,
} from '~/types/types';
import type { ParsedCredential } from '~/types/credential';
import type { ParsedProfileGetMsg, ProfileGetMsgResponse } from '~/types/profile_getmsg';

const loginAccount = useLoginAccount();
const credentials = useLocalStorage<ParsedCredential[]>('auto-detect-credentials:credentials', []);

interface AppMsgPublishLiteResponse {
  base_resp: BaseResp;
  articles?: AppMsgEx[];
  completed?: boolean;
  total_count?: number;
  page_message_count?: number;
  publish_page?: string;
}

const FIRST_PAGE_PROBE_SIZE = 1;
const MIN_SAFE_ARTICLE_PAGE_SIZE = 1;
const MAX_OOM_RETRY_TIMES = 3;

function isMemoryPressureMessage(message: string): boolean {
  return message.includes('heap pressure') || message.includes('内存接近上限');
}

function normalizeMpErrorMessage(message: string): string {
  if (isWorkerOutOfMemoryError({ message })) {
    return '服务进程内存不足，请重启开发服务并使用 yarn dev --no-fork';
  }
  if (isMemoryPressureMessage(message)) {
    return '服务进程内存接近上限，已自动停止同步，请稍后重试或重启开发服务';
  }
  return message;
}

function isWorkerOutOfMemoryError(error: unknown): boolean {
  const message = String((error as any)?.message || '');
  return (
    message.includes('ERR_WORKER_OUT_OF_MEMORY')
    || message.includes('Worker terminated due to reaching memory limit')
    || message.includes('JS heap out of memory')
  );
}

async function requestArticleListPage(
  account: MpAccount,
  begin: number,
  keyword: string,
  pageSizeHint = ARTICLE_LIST_PAGE_SIZE
): Promise<AppMsgPublishLiteResponse> {
  let pageSize = Math.max(MIN_SAFE_ARTICLE_PAGE_SIZE, Number(pageSizeHint) || ARTICLE_LIST_PAGE_SIZE);

  for (let attempt = 0; attempt <= MAX_OOM_RETRY_TIMES; attempt++) {
    try {
      return await request<AppMsgPublishLiteResponse>('/api/web/mp/appmsgpublish', {
        query: {
          id: account.fakeid,
          begin,
          size: pageSize,
          keyword,
        },
      });
    } catch (error) {
      if (!isWorkerOutOfMemoryError(error)) {
        throw error;
      }

      const canRetry = attempt < MAX_OOM_RETRY_TIMES && pageSize > MIN_SAFE_ARTICLE_PAGE_SIZE;
      if (!canRetry) {
        throw error;
      }

      pageSize = Math.max(MIN_SAFE_ARTICLE_PAGE_SIZE, Math.floor(pageSize / 2));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  throw new Error('failed to request article list');
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

async function hasValidAuthKey() {
  try {
    const resp = await request<GetAuthKeyResult>('/api/public/v1/authkey');
    return resp.code === 0;
  } catch {
    return false;
  }
}

async function handleMpSessionError() {
  const authKeyValid = await hasValidAuthKey();
  if (!authKeyValid) {
    loginAccount.value = null;
    throw new Error('session expired');
  }

  // 寰俊鎺ュ彛杩斿洖 200003 浣?auth-key 浠嶅瓨鍦ㄦ椂锛岄€氬父鏄井淇＄浼氳瘽寮傚父鎴栭鎺э紝涓嶅簲鐩存帴娓呯┖鏈湴鐧诲綍鎬併€?  throw new Error('寰俊浼氳瘽寮傚父(200003)锛岃绋嶅悗閲嶈瘯');
}

/**
 * 鑾峰彇鏂囩珷鍒楄〃
 * @param account
 * @param begin
 * @param keyword
 * @return [鏂囩珷鍒楄〃, 鏄惁鍔犺浇瀹屾瘯, 鏂囩珷鎬绘暟, 褰撳墠椤甸潰娑堟伅鏁?, 鏂板鏂囩珷鏁?]
 */
export async function getArticleList(
  account: MpAccount,
  begin = 0,
  keyword = ''
): Promise<[AppMsgEx[], boolean, number, number, number]> {
  const pageSizeHint = begin === 0 && !keyword ? FIRST_PAGE_PROBE_SIZE : ARTICLE_LIST_PAGE_SIZE;
  const resp = await requestArticleListPage(account, begin, keyword, pageSizeHint);

  if (resp.base_resp.ret === 0) {
    let articles: AppMsgEx[] = [];
    let isCompleted = false;
    let totalCount = 0;
    let pageMessageCount = 0;
    let inserted = 0;

    if (Array.isArray(resp.articles)) {
      articles = resp.articles.map(compactArticlePayload);
      isCompleted = Boolean(resp.completed);
      totalCount = Number(resp.total_count) || 0;
      pageMessageCount = Number(resp.page_message_count) || 0;
    } else {
      const publish_page: PublishPage = JSON.parse(resp.publish_page || '{}');
      const publish_list = Array.isArray(publish_page.publish_list)
        ? publish_page.publish_list.filter(item => !!item.publish_info)
        : [];
      pageMessageCount = publish_list.length;
      isCompleted = publish_list.length === 0;
      totalCount = Number(publish_page.total_count) || 0;
      articles = publish_list.flatMap(item => {
        const publish_info: PublishInfo = JSON.parse(item.publish_info);
        return publish_info.appmsgex.map(compactArticlePayload);
      });
    }

    if (!keyword) {
      try {
        const upsertResult = await upsertArticlePage(account, articles, totalCount, isCompleted);
        inserted = Number(upsertResult.inserted) || 0;

        if (begin === 0 && inserted > 0) {
          await updateLastUpdateTime(account.fakeid);
        }
      } catch (e) {
        console.error('写入文章缓存失败:', e);
      }
    }

    return [articles, isCompleted, totalCount, pageMessageCount, inserted];
  } else if (resp.base_resp.ret === 200003) {
    await handleMpSessionError();
  } else {
    const errMsg = normalizeMpErrorMessage(String(resp.base_resp.err_msg || 'unknown error'));
    throw new Error(`${resp.base_resp.ret}:${errMsg}`);
  }
  throw new Error('failed to load article list');
}

/**
 * 鑾峰彇鍏紬鍙峰垪琛?
 * @param begin
 * @param keyword
 */
export async function getAccountList(begin = 0, keyword = ''): Promise<[AccountInfo[], boolean]> {
  const resp = await request<SearchBizResponse>('/api/web/mp/searchbiz', {
    query: {
      begin: begin,
      size: ACCOUNT_LIST_PAGE_SIZE,
      keyword: keyword,
    },
  });

  if (resp.base_resp.ret === 0) {
    // 鍏紬鍙峰垽鏂槸鍚︾粨鏉熺殑閫昏緫涓庢枃绔犱笉澶竴鏍?
    // 褰撶涓€椤电殑缁撴灉灏卞皯浜?涓垯缁撴潫锛屽惁鍒欏彧鏈夊綋鎼滅储缁撴灉涓虹┖鎵嶈〃绀虹粨鏉?
    const isCompleted = begin === 0 ? resp.total < ACCOUNT_LIST_PAGE_SIZE : resp.total === 0;

    return [resp.list, isCompleted];
  } else if (resp.base_resp.ret === 200003) {
    await handleMpSessionError();
  } else {
    throw new Error(`${resp.base_resp.ret}:${resp.base_resp.err_msg}`);
  }
  throw new Error('failed to load account list');
}

/**
 * 鑾峰彇璇勮
 * @param commentId
 */
export async function getComment(commentId: string) {
  try {
    // 鏈湴璁剧疆鐨?credentials
    const credentials = JSON.parse(window.localStorage.getItem('credentials')!);
    if (!credentials || !credentials.__biz || !credentials.pass_ticket || !credentials.key || !credentials.uin) {
      console.warn('credentials not set');
      return null;
    }
    const response = await request<CommentResponse>('/api/web/misc/comment', {
      query: {
        comment_id: commentId,
        ...credentials,
      },
    });
    if (response.base_resp.ret === 0) {
      return response;
    } else {
      return null;
    }
  } catch (e) {
    console.warn('credentials parse error', e);
    return null;
  }
}

/**
 * 鑾峰彇鍏紬鍙锋枃绔犲垪琛?
 * @description 璇ユ帴鍙ｉ噰鐢ㄥ井淇℃帴鍙ｏ紝鑰岄潪鍏紬鍙峰钩鍙版帴鍙ｏ紝鍥犳闇€瑕佸厛鑾峰彇 Credentials
 * @param fakeid
 * @param begin
 */
export async function getArticleListWithCredential(fakeid: string, begin = 0) {
  const targetCredential = credentials.value.find(item => item.biz === fakeid);
  if (!targetCredential) {
    throw new Error('target account credential not configured');
  }

  const resp = await request<ProfileGetMsgResponse>('/api/web/mp/profile_ext_getmsg', {
    query: {
      id: fakeid,
      begin: begin,
      size: 10,
      uin: targetCredential.uin,
      key: targetCredential.key,
      pass_ticket: targetCredential.pass_ticket,
    },
  });
  if (resp.ret === 0) {
    return JSON.parse(resp.general_msg_list) as ParsedProfileGetMsg[];
  } else {
    throw new Error(`${resp.ret}:${resp.errmsg}`);
  }
}

