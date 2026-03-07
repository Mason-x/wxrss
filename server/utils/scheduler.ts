import dayjs from 'dayjs';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';
import { USER_AGENT } from '~/config';
import {
  getSchedulerArticles,
  listSchedulerStates,
  type SchedulerAccount,
  type SchedulerConfig,
  type SchedulerState,
  setSchedulerArticles,
  upsertSchedulerState,
} from '~/server/kv/scheduler';
import { cookieStore } from '~/server/utils/CookieStore';

const MAX_PAGE_PER_ACCOUNT = 50;
const MAX_ARTICLES_PER_ACCOUNT = 3000;

interface PublishListItem {
  publish_info: string;
}

interface PublishPage {
  total_count: number;
  publish_list: PublishListItem[];
}

interface BaseResp {
  ret: number;
  err_msg: string;
}

interface AppMsgPublishResponse {
  base_resp: BaseResp;
  publish_page: string;
}

function compactArticlePayload(article: Record<string, any>): Record<string, any> {
  return {
    aid: String(article?.aid || ''),
    appmsgid: Number(article?.appmsgid) || 0,
    itemidx: Number(article?.itemidx) || 0,
    link: String(article?.link || ''),
    title: String(article?.title || ''),
    digest: String(article?.digest || ''),
    author_name: String(article?.author_name || ''),
    cover: String(article?.cover || ''),
    create_time: Number(article?.create_time) || 0,
    update_time: Number(article?.update_time) || 0,
    item_show_type: Number(article?.item_show_type) || 0,
    media_duration: String(article?.media_duration || ''),
    appmsg_album_infos: Array.isArray(article?.appmsg_album_infos) ? article.appmsg_album_infos : [],
    copyright_stat: Number(article?.copyright_stat) || 0,
    copyright_type: Number(article?.copyright_type) || 0,
    is_deleted: Boolean(article?.is_deleted),
    _status: String(article?._status || ''),
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function todayKey(now = new Date()): string {
  return dayjs(now).format('YYYY-MM-DD');
}

function parseDailyTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value || '').trim());
  if (!match) {
    return { hour: 6, minute: 0 };
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function isDueToday(config: SchedulerConfig, lastRunDate?: string): boolean {
  if (!config.dailySyncEnabled) {
    return false;
  }

  const now = new Date();
  const today = todayKey(now);
  if (lastRunDate === today) {
    return false;
  }

  const { hour, minute } = parseDailyTime(config.dailySyncTime);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return now.getTime() >= target.getTime();
}

function calcSyncThreshold(config: SchedulerConfig): number {
  const start = dayjs().add(1, 'days').startOf('day');
  switch (config.syncDateRange) {
    case '1d':
      return start.subtract(1, 'days').unix();
    case '3d':
      return start.subtract(3, 'days').unix();
    case '7d':
      return start.subtract(7, 'days').unix();
    case '1m':
      return start.subtract(1, 'months').unix();
    case '3m':
      return start.subtract(3, 'months').unix();
    case '6m':
      return start.subtract(6, 'months').unix();
    case '1y':
      return start.subtract(1, 'years').unix();
    case 'point':
      return config.syncDatePoint > 0 ? config.syncDatePoint : 0;
    case 'all':
    default:
      return 0;
  }
}

function articleIdentityKey(article: any): string {
  if (article?.aid) return `aid:${article.aid}`;
  if (Number.isFinite(article?.appmsgid)) return `appmsg:${article.appmsgid}:${article.itemidx || 0}`;
  if (article?.link) return `link:${article.link}`;
  return `fallback:${article?.create_time || 0}:${article?.update_time || 0}:${article?.title || ''}`;
}

function dedupeArticles(newArticles: any[], oldArticles: any[]): any[] {
  const map = new Map<string, any>();
  [...newArticles, ...oldArticles].forEach(article => {
    const key = articleIdentityKey(article);
    if (!map.has(key)) {
      map.set(key, article);
    }
  });

  return Array.from(map.values())
    .sort((a, b) => {
      const updateDiff = (b?.update_time || 0) - (a?.update_time || 0);
      if (updateDiff !== 0) return updateDiff;
      return (b?.create_time || 0) - (a?.create_time || 0);
    })
    .slice(0, MAX_ARTICLES_PER_ACCOUNT);
}

async function fetchAppMsgPublish(
  authKey: string,
  token: string,
  fakeid: string,
  begin: number,
  size: number
): Promise<AppMsgPublishResponse> {
  const cookie = await cookieStore.getCookie(authKey);
  if (!cookie) {
    throw new Error('cookie not found');
  }

  const query = new URLSearchParams({
    sub: 'list',
    search_field: 'null',
    begin: String(begin),
    count: String(size),
    query: '',
    fakeid,
    type: '101_1',
    free_publish_type: '1',
    sub_action: 'list_ex',
    token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  });

  const response = await fetch(`https://mp.weixin.qq.com/cgi-bin/appmsgpublish?${query.toString()}`, {
    method: 'GET',
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
      Cookie: cookie,
      'Accept-Encoding': 'identity',
    },
  });

  return await response.json();
}

function parseArticles(resp: AppMsgPublishResponse): { articles: any[]; completed: boolean; totalCount: number } {
  if (!resp || !resp.base_resp) {
    throw new Error('invalid appmsgpublish response');
  }

  if (resp.base_resp.ret !== 0) {
    throw new Error(`${resp.base_resp.ret}:${resp.base_resp.err_msg || 'sync failed'}`);
  }

  const publishPage = JSON.parse(resp.publish_page || '{}') as PublishPage;
  const list = Array.isArray(publishPage.publish_list) ? publishPage.publish_list : [];
  const nonEmptyList = list.filter(item => Boolean(item?.publish_info));

  const articles = nonEmptyList.flatMap(item => {
    try {
      const publishInfo = JSON.parse(item.publish_info || '{}') as Record<string, any>;
      return Array.isArray(publishInfo.appmsgex) ? publishInfo.appmsgex.map(compactArticlePayload) : [];
    } catch {
      return [];
    }
  });

  return {
    articles,
    completed: nonEmptyList.length === 0,
    totalCount: Number.isFinite(publishPage.total_count) ? publishPage.total_count : 0,
  };
}

async function syncOneAccount(
  authKey: string,
  token: string,
  account: SchedulerAccount,
  config: SchedulerConfig
): Promise<number> {
  const fakeid = account.fakeid;
  const cached = await getSchedulerArticles(authKey, fakeid);
  const oldArticles = cached?.articles || [];
  const oldLatest = oldArticles.reduce((max, article) => Math.max(max, Number(article?.create_time) || 0), 0);
  const syncThreshold = calcSyncThreshold(config);

  let begin = 0;
  let page = 0;
  let totalCount = cached?.totalCount || 0;
  const collected: any[] = [];
  let reachedBoundary = false;

  while (page < MAX_PAGE_PER_ACCOUNT) {
    const resp = await fetchAppMsgPublish(authKey, token, fakeid, begin, 20);
    const { articles, completed, totalCount: latestTotalCount } = parseArticles(resp);
    totalCount = latestTotalCount || totalCount;

    if (articles.length === 0 || completed) {
      break;
    }

    for (const article of articles) {
      const createTime = Number(article?.create_time) || 0;
      if (oldLatest > 0 && createTime > 0 && createTime <= oldLatest) {
        reachedBoundary = true;
        break;
      }
      if (syncThreshold > 0 && createTime > 0 && createTime < syncThreshold) {
        reachedBoundary = true;
        break;
      }
      collected.push(article);
    }

    if (reachedBoundary) {
      break;
    }

    const beginStep = articles.filter(article => Number(article?.itemidx) === 1).length;
    if (beginStep <= 0) {
      break;
    }
    begin += beginStep;
    page++;

    await sleep(pickRandomSyncDelayMs(config));
  }

  const merged = dedupeArticles(collected, oldArticles);
  await setSchedulerArticles(authKey, fakeid, {
    articles: merged,
    totalCount,
  });

  return collected.length;
}

async function runSchedulerForState(state: SchedulerState): Promise<void> {
  const { authKey, config, accounts } = state;
  if (!isDueToday(config, state.lastRunDate)) {
    return;
  }

  const token = await cookieStore.getToken(authKey);
  const cookie = await cookieStore.getCookie(authKey);
  if (!token || !cookie) {
    await upsertSchedulerState(authKey, {
      lastStatus: 'error',
      lastError: 'cookie or token missing',
    });
    return;
  }

  await upsertSchedulerState(authKey, {
    lastStatus: 'running',
    lastError: '',
  });

  try {
    for (const account of accounts) {
      await syncOneAccount(authKey, token, account, config);
    }

    await upsertSchedulerState(authKey, {
      lastRunDate: todayKey(),
      lastRunAt: Date.now(),
      lastStatus: 'success',
      lastError: '',
    });
  } catch (error) {
    await upsertSchedulerState(authKey, {
      lastStatus: 'error',
      lastError: (error as Error).message,
    });
  }
}

export async function runDueSchedulerJobs(): Promise<void> {
  const states = await listSchedulerStates();
  for (const state of states) {
    await runSchedulerForState(state);
  }
}
