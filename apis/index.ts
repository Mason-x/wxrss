import { extractAccountProfileFromHtml } from '#shared/utils/account-profile';
import { parseProfileArticlePage } from '#shared/utils/profile-getmsg';
import { request } from '#shared/utils/request';
import { ACCOUNT_LIST_PAGE_SIZE, ARTICLE_LIST_PAGE_SIZE, CREDENTIAL_LIVE_MINUTES } from '~/config';
import type { ReaderArticle } from '~/server/repositories/reader';
import { getArticleCache, upsertArticlePage } from '~/store/v2/article';
import { getHtmlCache, getHtmlCacheByFakeid } from '~/store/v2/html';
import { type MpAccount, updateLastUpdateTime } from '~/store/v2/info';
import type { CommentResponse } from '~/types/comment';
import type { ParsedCredential } from '~/types/credential';
import type { ProfileGetMsgResponse } from '~/types/profile_getmsg';
import type { AccountInfo, AppMsgEx, BaseResp, GetAuthKeyResult, SearchBizResponse } from '~/types/types';

const loginAccount = useLoginAccount();
const credentials = useLocalStorage<ParsedCredential[]>('auto-detect-credentials:credentials', []);

export interface RssSyncResult {
  account: MpAccount;
  inserted: number;
  totalCount: number;
  sourceUrl: string;
}



export interface RsshubDiscoverParamOption {
  label: string;
  value: string;
}

export interface RsshubDiscoverParam {
  key: string;
  description: string;
  required: boolean;
  defaultValue: string;
  options: RsshubDiscoverParamOption[];
}

export interface RsshubDiscoverItem {
  id: string;
  namespace: string;
  namespaceName: string;
  routeName: string;
  routePath: string;
  rsshubUrl: string;
  siteUrl: string;
  summary: string;
  categories: string[];
  maintainers: string[];
  params: RsshubDiscoverParam[];
  requiresConfig: boolean;
}

export interface RsshubCategoryItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  accentFrom: string;
  accentTo: string;
  routeCount: number;
}

export interface ArticleSummaryResult {
  summary: string;
  model: string;
  cached?: boolean;
  tags?: string[];
  rating?: string;
  summaryText?: string;
  highlights?: string[];
  debug?: {
    source: 'preferred' | 'cache' | 'fetched' | 'unavailable';
    contentFormat: 'markdown' | 'text' | null;
    promptLength: number;
    markdownLength: number;
    textLength: number;
    refreshed: boolean;
  };
}

export interface AiDailyProcessResult {
  processed: boolean;
  reportDate: string;
  taggedCount: number;
  reportUpdated: boolean;
  summarizedCount?: number;
  reason?: string;
}

export interface AiAccountBootstrapResult {
  processed: boolean;
  fakeid: string;
  taggedCount: number;
  summarizedCount: number;
  reason?: string;
  daily?: AiDailyProcessResult;
}

export interface AiDailyReportItem {
  reportDate: string;
  title: string;
  contentHtml: string;
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
}

const FIRST_PAGE_PROBE_SIZE = 1;
export const INITIAL_SUBSCRIBE_PAGE_SIZE = 20;
const MIN_SAFE_ARTICLE_PAGE_SIZE = 1;

function isCredentialFresh(item?: ParsedCredential | null): boolean {
  return Boolean(
    item?.uin &&
      item?.key &&
      item?.pass_ticket &&
      Date.now() < Number(item.timestamp || 0) + 1000 * 60 * CREDENTIAL_LIVE_MINUTES
  );
}

export function hasValidCredential(fakeid: string): boolean {
  const target = credentials.value.find(item => item.biz === fakeid);
  const valid = isCredentialFresh(target);
  if (target) {
    target.valid = valid;
  }
  return valid;
}

export function hasAnyValidCredential(): boolean {
  return credentials.value.some(item => isCredentialFresh(item));
}

function getValidCredential(fakeid: string): ParsedCredential {
  const target = credentials.value.find(item => item.biz === fakeid);
  if (!target || !isCredentialFresh(target)) {
    if (target) {
      target.valid = false;
    }
    throw new Error('目标公众号的 Credential 缺失或已过期，请重新抓取后再同步');
  }
  target.valid = true;
  return target;
}

async function requestProfileArticleListPage(fakeid: string, begin: number, size: number) {
  const target = getValidCredential(fakeid);
  const resp = await request<ProfileGetMsgResponse>('/api/web/mp/profile_ext_getmsg', {
    method: 'POST',
    body: {
      id: fakeid,
      begin,
      size: Math.min(10, Math.max(1, Number(size) || ARTICLE_LIST_PAGE_SIZE)),
      uin: target.uin,
      key: target.key,
      pass_ticket: target.pass_ticket,
    },
  });
  if (Number(resp.ret) !== 0) {
    throw new Error(`${resp.ret}:${resp.errmsg || 'Credential 已失效，请重新抓取'}`);
  }
  return parseProfileArticlePage(
    resp,
    fakeid,
    begin,
    Math.min(10, Math.max(1, Number(size) || ARTICLE_LIST_PAGE_SIZE))
  );
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

  throw new Error('微信会话异常(200003)，请稍后重试；如果持续失败，请重新登录公众号后台');
}

/**
 * 鑾峰彇鏂囩珷鍒楄〃
 * @param account
 * @param begin
 * @param keyword
 * @return [鏂囩珷鍒楄〃, 鏄惁鍔犺浇瀹屾瘯, 鏂囩珷鎬绘暟, 褰撳墠椤甸潰娑堟伅鏁?, 鏂板鏂囩珷鏁?]
 */
function hasAccountProfile(account: Pick<MpAccount, 'nickname' | 'round_head_img'>): boolean {
  return Boolean(String(account.nickname || '').trim() && String(account.round_head_img || '').trim());
}

async function fetchAccountProfileByCredential(
  fakeid: string,
  articleUrl = ''
): Promise<{ nickname: string; round_head_img: string } | null> {
  try {
    const target = getValidCredential(fakeid);
    const resp = await request<{ nickname?: string; round_head_img?: string }>('/api/web/mp/profile_ext_home', {
      method: 'POST',
      body: {
        id: fakeid,
        uin: target.uin,
        key: target.key,
        pass_ticket: target.pass_ticket,
        url: articleUrl || '',
      },
    });
    const nickname = String(resp?.nickname || '').trim();
    const roundHeadImg = String(resp?.round_head_img || '').trim();
    if (!nickname && !roundHeadImg) {
      return null;
    }
    return {
      nickname,
      round_head_img: roundHeadImg,
    };
  } catch {
    return null;
  }
}

export async function resolveAccountProfile(
  fakeid: string,
  articleUrl = ''
): Promise<{ nickname: string; round_head_img: string } | null> {
  const normalizedFakeid = String(fakeid || '').trim();
  if (!normalizedFakeid) {
    return null;
  }

  const credentialProfile = await fetchAccountProfileByCredential(normalizedFakeid, articleUrl);
  if (credentialProfile?.nickname || credentialProfile?.round_head_img) {
    return credentialProfile;
  }

  try {
    const [accounts] = await getAccountList(0, normalizedFakeid);
    const matched = accounts.find(item => String(item.fakeid || '') === normalizedFakeid);
    if (matched && (matched.nickname || matched.round_head_img)) {
      return {
        nickname: String(matched.nickname || '').trim(),
        round_head_img: String(matched.round_head_img || '').trim(),
      };
    }
  } catch {
    // ignore search failures and fall back to the article page
  }

  const url = String(articleUrl || '').trim();
  if (!url) {
    return null;
  }

  try {
    const resp = await request<{ nickname?: string; round_head_img?: string }>('/api/web/misc/account-profile', {
      query: {
        url,
      },
    });
    const nickname = String(resp?.nickname || '').trim();
    const roundHeadImg = String(resp?.round_head_img || '').trim();
    if (!nickname && !roundHeadImg) {
      return null;
    }
    return {
      nickname,
      round_head_img: roundHeadImg,
    };
  } catch {
    return null;
  }
}

export async function enrichMpAccountProfile(account: MpAccount, articleUrl = ''): Promise<MpAccount> {
  if (hasAccountProfile(account)) {
    return account;
  }

  const profile = await resolveAccountProfile(account.fakeid, articleUrl);
  if (!profile) {
    return account;
  }

  return {
    ...account,
    nickname: String(account.nickname || '').trim() || profile.nickname || account.nickname,
    round_head_img: String(account.round_head_img || '').trim() || profile.round_head_img || account.round_head_img,
  };
}

export async function refreshMissingAccountProfile(account: MpAccount): Promise<MpAccount> {
  if (hasAccountProfile(account)) {
    return account;
  }

  let nextAccount = await enrichMpAccountProfile(account);
  if (!hasAccountProfile(nextAccount)) {
    const cachedByFakeid = await getHtmlCacheByFakeid(account.fakeid);
    if (cachedByFakeid) {
      const extracted = extractAccountProfileFromHtml(await cachedByFakeid.file.text());
      if (extracted.nickname || extracted.round_head_img) {
        nextAccount = {
          ...nextAccount,
          nickname: String(nextAccount.nickname || '').trim() || extracted.nickname,
          round_head_img: String(nextAccount.round_head_img || '').trim() || extracted.round_head_img,
        };
      }
    }
  }
  if (!hasAccountProfile(nextAccount)) {
    const articles = await getArticleCache(account.fakeid, Math.floor(Date.now() / 1000) + 24 * 3600);
    const link = articles.find(item => item.link)?.link || '';
    if (link) {
      nextAccount = await enrichMpAccountProfile(nextAccount, link);
      if (!hasAccountProfile(nextAccount)) {
        const cached = await getHtmlCache(link);
        if (cached) {
          const extracted = extractAccountProfileFromHtml(await cached.file.text());
          if (extracted.nickname || extracted.round_head_img) {
            nextAccount = {
              ...nextAccount,
              nickname: String(nextAccount.nickname || '').trim() || extracted.nickname,
              round_head_img: String(nextAccount.round_head_img || '').trim() || extracted.round_head_img,
            };
          }
        }
      }
    }
  }

  if (
    String(nextAccount.nickname || '') !== String(account.nickname || '') ||
    String(nextAccount.round_head_img || '') !== String(account.round_head_img || '')
  ) {
    try {
      await upsertArticlePage(nextAccount, [], nextAccount.total_count, Boolean(nextAccount.completed));
    } catch (error) {
      console.error('回写公众号资料失败:', error);
    }
  }

  return nextAccount;
}

export async function getArticleList(
  account: MpAccount,
  begin = 0,
  keyword = '',
  options: {
    initialPageSize?: number;
    pageSize?: number;
  } = {}
): Promise<[AppMsgEx[], boolean, number, number, number]> {
  if (keyword) {
    throw new Error('Credential 抓取模式暂不支持微信端关键词搜索');
  }
  const initialPageSize = Math.max(MIN_SAFE_ARTICLE_PAGE_SIZE, Number(options.initialPageSize) || 0);
  const rawExplicitPageSize = Number(options.pageSize) || 0;
  const explicitPageSize = rawExplicitPageSize > 0 ? Math.max(MIN_SAFE_ARTICLE_PAGE_SIZE, rawExplicitPageSize) : 0;
  const pageSizeHint =
    explicitPageSize || (begin === 0 && !keyword ? initialPageSize || FIRST_PAGE_PROBE_SIZE : ARTICLE_LIST_PAGE_SIZE);
  let syncedAccount = hasAccountProfile(account) ? account : await enrichMpAccountProfile(account);
  const page = await requestProfileArticleListPage(account.fakeid, begin, pageSizeHint);
  const totalCount = page.completed
    ? page.nextOffset
    : Math.max(Number(account.total_count) || 0, Number(account.count) || 0);
  if (!hasAccountProfile(syncedAccount) && page.articles[0]?.link) {
    syncedAccount = await enrichMpAccountProfile(syncedAccount, page.articles[0].link);
  }
  let inserted = 0;

  try {
    const upsertResult = await upsertArticlePage(syncedAccount, page.articles, totalCount, page.completed);
    inserted = Number(upsertResult.inserted) || 0;
    if (begin === 0 && inserted > 0) {
      await updateLastUpdateTime(account.fakeid);
    }
  } catch (e) {
    console.error('写入文章缓存失败:', e);
  }

  return [page.articles, page.completed, totalCount, page.messageCount, inserted];
}

export async function subscribeRssFeed(url: string): Promise<RssSyncResult> {
  const resp = await request<{ data: RssSyncResult }>('/api/web/reader/rss-subscribe', {
    method: 'POST',
    body: {
      url,
    },
  });
  return resp.data;
}

export async function syncRssFeed(payload: {
  fakeid?: string;
  url?: string;
  history?: boolean;
}): Promise<RssSyncResult> {
  const resp = await request<{ data: RssSyncResult }>('/api/web/reader/rss-sync', {
    method: 'POST',
    body: {
      fakeid: payload.fakeid || '',
      url: payload.url || '',
      history: Boolean(payload.history),
    },
  });
  return resp.data;
}

export async function searchRsshubRoutes(options: { keyword?: string; category?: string; limit?: number }): Promise<{
  categories: RsshubCategoryItem[];
  routes: RsshubDiscoverItem[];
}> {
  const resp = await request<{ categories?: RsshubCategoryItem[]; routes?: RsshubDiscoverItem[] }>(
    '/api/web/reader/rss-discover',
    {
      query: {
        keyword: options.keyword || '',
        category: options.category || '',
        limit: options.limit || 20,
      },
    }
  );
  return {
    categories: Array.isArray(resp.categories) ? resp.categories : [],
    routes: Array.isArray(resp.routes) ? resp.routes : [],
  };
}

export async function generateArticleSummary(payload: {
  url?: string;
  title: string;
  content?: string;
  contentHtml?: string;
  force?: boolean;
}): Promise<ArticleSummaryResult> {
  const resp = await request<{ data: ArticleSummaryResult }>('/api/web/ai/article-summary', {
    method: 'POST',
    body: {
      url: payload.url,
      title: payload.title,
      ...(payload.content ? { content: payload.content } : {}),
      ...(payload.contentHtml ? { contentHtml: payload.contentHtml } : {}),
      ...(payload.force ? { force: true } : {}),
    },
  });
  return resp.data;
}

export async function getReaderArticleByLink(url: string): Promise<ReaderArticle | null> {
  const resp = await request<{ article: ReaderArticle | null }>('/api/web/reader/article-by-link', {
    query: {
      url,
    },
  });
  return resp.article || null;
}

export async function refreshAiDailyDigest(
  options: { date?: string; force?: boolean } = {}
): Promise<AiDailyProcessResult> {
  const resp = await request<{ data: AiDailyProcessResult }>('/api/web/ai/daily-refresh', {
    method: 'POST',
    body: {
      date: options.date,
      force: options.force === true,
    },
  });
  return resp.data;
}

export async function bootstrapAccountAi(fakeid: string, limit = 10): Promise<AiAccountBootstrapResult> {
  const resp = await request<{ data: AiAccountBootstrapResult }>('/api/web/ai/bootstrap-account', {
    method: 'POST',
    body: {
      fakeid,
      limit,
    },
  });
  return resp.data;
}

export async function listAiDailyReports(
  offset = 0,
  limit = 60
): Promise<{ list: AiDailyReportItem[]; total: number; offset: number; limit: number }> {
  return await request('/api/web/ai/daily-reports', {
    query: {
      offset,
      limit,
    },
  });
}

export async function getAiDailyReport(date: string): Promise<AiDailyReportItem | null> {
  const resp = await request<{ data: AiDailyReportItem | null }>('/api/web/ai/daily-report', {
    query: {
      date,
    },
  });
  return resp.data || null;
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
  return (await requestProfileArticleListPage(fakeid, begin, ARTICLE_LIST_PAGE_SIZE)).articles;
}
