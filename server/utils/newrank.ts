import { USER_AGENT } from '~/config';
import {
  getCachedNewrankRecommendations,
  upsertCachedNewrankRecommendations,
  type CachedNewrankRecommendationRecord,
} from '~/server/repositories/newrank';

const NEWRANK_TOKEN = '3b2f8f99af0545cc989cfae76477d9bf';
const NEWRANK_ORIGIN = 'https://www.newrank.cn';
const NEWRANK_WX_TIME_ENDPOINT = 'https://gw.newrank.cn/api/mainRank/nr/mainRank/rank/wxRankTime';
const NEWRANK_WX_MONTH_RANK_ENDPOINT = 'https://gw.newrank.cn/api/main/xdnphb/main/v1/month/rank';
const NEWRANK_AI_WX_TIME_ENDPOINT = 'https://gw.newrank.cn/api/mainRank/nr/mainRank/ai/rank/getWxAiRankDateList';
const NEWRANK_AI_WX_RANK_ENDPOINT = 'https://gw.newrank.cn/api/mainRank/nr/mainRank/ai/rank/getWxAiRank';
const CACHE_TTL_MS = 1000 * 60 * 60;

type NewrankCategoryKind = 'ranklist' | 'rankai';

export interface NewrankRecommendCategory {
  id: string;
  label: string;
  description: string;
  rankName: string;
  rankGroup: string;
  accentFrom: string;
  accentTo: string;
}

export interface NewrankRecommendItem {
  id: string;
  nickname: string;
  alias: string;
  avatar: string;
  uuid: string;
  score: number | null;
  rank: number;
  sourceLabel: string;
  searchKeyword: string;
}

export interface NewrankRecommendationsResult {
  state: 'ready' | 'missing_cookie' | 'empty' | 'error';
  message: string;
  selectedCategory: string;
  latestMonth: string;
  latestMonthLabel: string;
  categories: NewrankRecommendCategory[];
  items: NewrankRecommendItem[];
}

export interface NewrankCookieCheckResult {
  ok: boolean;
  text: string;
}

interface NewrankCategoryDefinition extends NewrankRecommendCategory {
  kind: NewrankCategoryKind;
  routePath: string;
  companyType?: number;
}

interface NextDataPayload {
  props?: {
    pageProps?: {
      isLogin?: boolean;
      userInfo?: {
        nickname?: string;
        name?: string;
      };
      rankLayoutState?: {
        isLogin?: boolean;
      };
      params?: {
        rank_name?: string;
        rank_name_group?: string;
      };
      rankData?: {
        list?: any[];
      };
    };
  };
}

interface NewrankTimeOption {
  label?: string;
  value?: string;
  endTime?: string | null;
}

interface NewrankTimeResponse {
  code?: number;
  msg?: string;
  data?: {
    monthList?: NewrankTimeOption[];
  };
}

interface NewrankAiTimeResponse {
  code?: number;
  msg?: string;
  data?: {
    monthList?: NewrankTimeOption[];
  };
}

interface NewrankMonthRankResponse {
  success?: boolean;
  value?: {
    datas?: any[];
  };
  msg?: string;
}

interface NewrankAiRankResponse {
  code?: number;
  msg?: string;
  data?: {
    list?: any[];
    updateTime?: string | null;
  };
}

const NEWRANK_RECOMMEND_CATEGORIES: NewrankCategoryDefinition[] = [
  {
    id: 'ai',
    label: 'AI影响力',
    description: '公众号 AI 账号影响力月榜',
    rankName: 'AI影响力',
    rankGroup: '公众号',
    accentFrom: '#fb7185',
    accentTo: '#f97316',
    kind: 'rankai',
    routePath: '/rankai/gongzhonghao/0/30',
    companyType: 0,
  },
  {
    id: 'culture',
    label: '文化',
    description: '人文、阅读与文化内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#a78bfa',
    accentTo: '#818cf8',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/1/30/{month}',
  },
  {
    id: 'encyclopedia',
    label: '百科',
    description: '知识解释、百科科普内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#60a5fa',
    accentTo: '#38bdf8',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/2/30/{month}',
  },
  {
    id: 'health',
    label: '健康',
    description: '健康、医疗与养生内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#22c55e',
    accentTo: '#10b981',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/3/30/{month}',
  },
  {
    id: 'fashion',
    label: '时尚',
    description: '时尚、美妆与生活方式月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#ec4899',
    accentTo: '#f472b6',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/4/30/{month}',
  },
  {
    id: 'food',
    label: '美食',
    description: '美食、餐饮与探店内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#f59e0b',
    accentTo: '#fbbf24',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/5/30/{month}',
  },
  {
    id: 'life',
    label: '乐活',
    description: '城市生活、消费与日常方式月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#34d399',
    accentTo: '#2dd4bf',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/6/30/{month}',
  },
  {
    id: 'travel',
    label: '旅行',
    description: '旅行、出行与目的地内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#22d3ee',
    accentTo: '#38bdf8',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/7/30/{month}',
  },
  {
    id: 'humor',
    label: '幽默',
    description: '幽默、段子与轻松内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#fb7185',
    accentTo: '#f43f5e',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/8/30/{month}',
  },
  {
    id: 'emotion',
    label: '情感',
    description: '情感关系与个人表达月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#f472b6',
    accentTo: '#fb7185',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/9/30/{month}',
  },
  {
    id: 'sports-ent',
    label: '体娱',
    description: '体育、娱乐与大众文化月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#f97316',
    accentTo: '#fb7185',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/10/30/{month}',
  },
  {
    id: 'body',
    label: '美体',
    description: '塑形、运动与身体护理月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#fb7185',
    accentTo: '#f59e0b',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/11/30/{month}',
  },
  {
    id: 'digest',
    label: '文摘',
    description: '精选摘录与内容汇编月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#94a3b8',
    accentTo: '#64748b',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/12/30/{month}',
  },
  {
    id: 'livelihood',
    label: '民生',
    description: '公共议题、城市民生与社会观察月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#38bdf8',
    accentTo: '#60a5fa',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/13/30/{month}',
  },
  {
    id: 'wealth',
    label: '财富',
    description: '投资、理财与财富管理月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#84cc16',
    accentTo: '#22c55e',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/14/30/{month}',
  },
  {
    id: 'tech',
    label: '科技',
    description: '科技、互联网与 AI 资讯月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#5b8dee',
    accentTo: '#60a5fa',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/15/30/{month}',
  },
  {
    id: 'startup',
    label: '创业',
    description: '创业、商业模式与公司观察月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#a78bfa',
    accentTo: '#c084fc',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/16/30/{month}',
  },
  {
    id: 'auto',
    label: '汽车',
    description: '汽车、出行产业与评测月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#64748b',
    accentTo: '#94a3b8',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/17/30/{month}',
  },
  {
    id: 'housing',
    label: '楼市',
    description: '楼市、地产与居住观察月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#f59e0b',
    accentTo: '#f97316',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/18/30/{month}',
  },
  {
    id: 'workplace',
    label: '职场',
    description: '职场成长、管理与职业发展月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#0ea5e9',
    accentTo: '#06b6d4',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/19/30/{month}',
  },
  {
    id: 'education',
    label: '教育',
    description: '教育、学习与方法内容月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#38bdf8',
    accentTo: '#818cf8',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/20/30/{month}',
  },
  {
    id: 'academic',
    label: '学术',
    description: '学术、科研与知识传播月榜',
    rankName: '',
    rankGroup: '',
    accentFrom: '#22c55e',
    accentTo: '#84cc16',
    kind: 'ranklist',
    routePath: '/ranklist/gongzhonghao/21/30/{month}',
  },
];

let wxMonthCache:
  | {
      expiresAt: number;
      month: string;
      label: string;
    }
  | null = null;

let aiMonthCache:
  | {
      expiresAt: number;
      month: string;
      label: string;
      endTime: string;
    }
  | null = null;

const pageParamCache = new Map<
  string,
  {
    expiresAt: number;
    rankName: string;
    rankGroup: string;
    isLogin: boolean;
    nickname: string;
    pageList: any[];
  }
>();

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRecommendationsResult(options: {
  state: NewrankRecommendationsResult['state'];
  message: string;
  category: NewrankCategoryDefinition;
  categories: NewrankRecommendCategory[];
  month: string;
  monthLabel: string;
  items: NewrankRecommendItem[];
}): NewrankRecommendationsResult {
  return {
    state: options.state,
    message: options.message,
    selectedCategory: options.category.id,
    latestMonth: options.month,
    latestMonthLabel: options.monthLabel,
    categories: options.categories,
    items: options.items,
  };
}

function parseNetscapeCookieFile(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('#'));

  if (lines.length === 0) {
    return '';
  }

  const entries: string[][] = [];
  let hasTabSeparatedRows = false;

  for (const line of lines) {
    const columns = line.split('\t');
    if (columns.length >= 7) {
      hasTabSeparatedRows = true;
      entries.push(columns.slice(0, 7));
    }
  }

  if (!hasTabSeparatedRows) {
    for (let index = 0; index + 6 < lines.length; index += 7) {
      entries.push(lines.slice(index, index + 7));
    }
  }

  const cookies: string[] = [];
  for (const entry of entries) {
    const name = normalizeText(entry[5]);
    if (!name) {
      continue;
    }

    const value = String(entry[6] ?? '').trim();
    if (!value) {
      continue;
    }

    cookies.push(`${name}=${value}`);
  }

  return cookies.join('; ');
}

function normalizeCookieInput(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.startsWith('# Netscape HTTP Cookie File')) {
    return parseNetscapeCookieFile(text);
  }

  if (text.includes('\t')) {
    const parsed = parseNetscapeCookieFile(text);
    if (parsed) {
      return parsed;
    }
  }

  if (text.includes('\n')) {
    return text
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('; ');
  }

  return text;
}

function hasCookieField(cookie: string, name: string): boolean {
  const pattern = new RegExp(`(?:^|;\\s*)${name}=`, 'i');
  return pattern.test(cookie);
}

function normalizeAvatar(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }
  return raw;
}

function toNullableNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function getRequestHeaders(cookie = '', referer = NEWRANK_ORIGIN) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    'N-Token': NEWRANK_TOKEN,
    Origin: NEWRANK_ORIGIN,
    Referer: referer,
    'User-Agent': USER_AGENT,
  };
}

async function postJson<T>(url: string, cookie: string, referer: string, body?: Record<string, any>): Promise<T> {
  return await $fetch<T>(url, {
    method: 'POST',
    headers: {
      ...getRequestHeaders(cookie, referer),
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: body || {},
  });
}

async function postForm<T>(url: string, cookie: string, referer: string, body: Record<string, string>): Promise<T> {
  return await $fetch<T>(url, {
    method: 'POST',
    headers: {
      ...getRequestHeaders(cookie, referer),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
}

async function fetchNewrankPageProps(path: string, cookie: string) {
  const cacheKey = `${path}|${cookie}`;
  const cached = pageParamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const html = await $fetch<string>(new URL(path, NEWRANK_ORIGIN).toString(), {
    headers: {
      Cookie: cookie,
      'User-Agent': USER_AGENT,
    },
  });

  const match = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error('未能从新榜页面解析参数');
  }

  const payload = JSON.parse(match[1]) as NextDataPayload;
  const pageProps = payload?.props?.pageProps;
  const result = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    rankName: normalizeText(pageProps?.params?.rank_name),
    rankGroup: normalizeText(pageProps?.params?.rank_name_group),
    isLogin: Boolean(pageProps?.rankLayoutState?.isLogin ?? pageProps?.isLogin),
    nickname: normalizeText(pageProps?.userInfo?.nickname || pageProps?.userInfo?.name),
    pageList: Array.isArray(pageProps?.rankData?.list) ? pageProps.rankData.list : [],
  };

  pageParamCache.set(cacheKey, result);
  return result;
}

async function fetchLatestWxMonth(cookie: string): Promise<{ month: string; label: string }> {
  if (wxMonthCache && wxMonthCache.expiresAt > Date.now()) {
    return {
      month: wxMonthCache.month,
      label: wxMonthCache.label,
    };
  }

  const response = await postJson<NewrankTimeResponse>(
    NEWRANK_WX_TIME_ENDPOINT,
    cookie,
    `${NEWRANK_ORIGIN}/ranklist/gongzhonghao/15/30`
  );

  const latestMonth = Array.isArray(response?.data?.monthList) ? response.data!.monthList![0] : null;
  const month = normalizeText(latestMonth?.value);
  if (!month) {
    throw new Error(normalizeText(response?.msg) || '未获取到新榜月榜时间');
  }

  const label = normalizeText(latestMonth?.label || month);
  wxMonthCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    month,
    label,
  };

  return {
    month,
    label,
  };
}

async function fetchLatestAiWxMonth(cookie: string): Promise<{ month: string; label: string; endTime: string }> {
  if (aiMonthCache && aiMonthCache.expiresAt > Date.now()) {
    return {
      month: aiMonthCache.month,
      label: aiMonthCache.label,
      endTime: aiMonthCache.endTime,
    };
  }

  const response = await postJson<NewrankAiTimeResponse>(
    NEWRANK_AI_WX_TIME_ENDPOINT,
    cookie,
    `${NEWRANK_ORIGIN}/rankai/gongzhonghao/0/30`
  );

  const latestMonth = Array.isArray(response?.data?.monthList) ? response.data!.monthList![0] : null;
  const month = normalizeText(latestMonth?.value);
  if (!month) {
    throw new Error(normalizeText(response?.msg) || '未获取到新榜 AI 月榜时间');
  }

  const label = normalizeText(latestMonth?.label || month);
  aiMonthCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    month,
    label,
    endTime: normalizeText(latestMonth?.endTime),
  };

  return {
    month,
    label,
    endTime: normalizeText(latestMonth?.endTime),
  };
}

function normalizeRankRow(row: any, category: NewrankRecommendCategory, monthLabel: string, rank: number): NewrankRecommendItem | null {
  const nickname = normalizeText(row?.name || row?.nickname);
  const alias = normalizeText(row?.account || row?.alias);
  if (!nickname && !alias) {
    return null;
  }

  const searchKeyword = alias || nickname;
  if (!searchKeyword) {
    return null;
  }

  return {
    id: normalizeText(row?.uuid) || `${category.id}:${searchKeyword}:${rank}`,
    nickname: nickname || searchKeyword,
    alias,
    avatar: normalizeAvatar(row?.head_image_url || row?.headImageUrl || row?.round_head_img || row?.avatar),
    uuid: normalizeText(row?.uuid),
    score: toNullableNumber(row?.log1p_mark ?? row?.log1pMark ?? row?.score ?? row?.mark),
    rank,
    sourceLabel: `${monthLabel} · ${category.label}`,
    searchKeyword,
  };
}

async function fetchRanklistCategoryRanking(
  cookie: string,
  category: NewrankCategoryDefinition,
  limit: number
): Promise<{ month: string; monthLabel: string; items: NewrankRecommendItem[] }> {
  const { month, label } = await fetchLatestWxMonth(cookie);
  const pagePath = category.routePath.replace('{month}', month);
  const pageMeta = await fetchNewrankPageProps(pagePath, cookie);
  const deduped = new Map<string, NewrankRecommendItem>();

  const appendRows = (rows: any[], rankCategory: NewrankRecommendCategory) => {
    for (const [index, row] of rows.entries()) {
      const item = normalizeRankRow(row, rankCategory, label, index + 1);
      if (!item) {
        continue;
      }
      const key = `${item.alias || ''}|${item.nickname}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
      if (deduped.size >= limit) {
        break;
      }
    }
  };

  if (Array.isArray(pageMeta.pageList) && pageMeta.pageList.length > 0) {
    appendRows(pageMeta.pageList, category);
    return {
      month,
      monthLabel: label,
      items: Array.from(deduped.values()),
    };
  }

  if (!pageMeta.rankName || !pageMeta.rankGroup) {
    throw new Error(`未能解析 ${category.label} 的新榜分类参数`);
  }

  const response = await postForm<NewrankMonthRankResponse>(
    NEWRANK_WX_MONTH_RANK_ENDPOINT,
    cookie,
    `${NEWRANK_ORIGIN}${pagePath}`,
    {
      start: month,
      end: month,
      rank_name: pageMeta.rankName,
      rank_name_group: pageMeta.rankGroup,
    }
  );

  const rows = Array.isArray(response?.value?.datas) ? response.value!.datas! : [];

  appendRows(rows, {
    ...category,
    rankName: pageMeta.rankName,
    rankGroup: pageMeta.rankGroup,
  });

  return {
    month,
    monthLabel: label,
    items: Array.from(deduped.values()),
  };
}

async function fetchAiCategoryRanking(
  cookie: string,
  category: NewrankCategoryDefinition,
  limit: number
): Promise<{ month: string; monthLabel: string; items: NewrankRecommendItem[] }> {
  const { month, label, endTime } = await fetchLatestAiWxMonth(cookie);
  const response = await postJson<NewrankAiRankResponse>(
    NEWRANK_AI_WX_RANK_ENDPOINT,
    cookie,
    `${NEWRANK_ORIGIN}${category.routePath}`,
    {
      start: month,
      end: endTime,
      dateType: 'month',
      companyType: Number(category.companyType ?? 0),
    }
  );

  const rows = Array.isArray(response?.data?.list) ? response.data!.list! : [];
  const deduped = new Map<string, NewrankRecommendItem>();

  for (const [index, row] of rows.entries()) {
    const item = normalizeRankRow(row, category, label, index + 1);
    if (!item) {
      continue;
    }
    const key = `${item.alias || ''}|${item.nickname}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
    if (deduped.size >= limit) {
      break;
    }
  }

  return {
    month,
    monthLabel: label,
    items: Array.from(deduped.values()),
  };
}

async function readCachedCategoryRanking(
  category: NewrankCategoryDefinition,
  limit: number
): Promise<CachedNewrankRecommendationRecord<NewrankRecommendItem> | null> {
  const cached = await getCachedNewrankRecommendations<NewrankRecommendItem>(category.id);
  if (!cached) {
    return null;
  }

  return {
    ...cached,
    items: Array.isArray(cached.items) ? cached.items.slice(0, limit) : [],
  };
}

async function writeCachedCategoryRanking(
  category: NewrankCategoryDefinition,
  result: { month: string; monthLabel: string; items: NewrankRecommendItem[] }
): Promise<void> {
  await upsertCachedNewrankRecommendations({
    categoryId: category.id,
    month: result.month,
    monthLabel: result.monthLabel,
    items: result.items,
  });
}

export async function validateNewrankCookie(cookie?: string): Promise<NewrankCookieCheckResult> {
  const normalizedCookie = normalizeCookieInput(cookie || process.env.NEWRANK_COOKIE || '');
  if (!normalizedCookie) {
    return {
      ok: false,
      text: '请先填写新榜 Cookie',
    };
  }

  try {
    const pageMeta = await fetchNewrankPageProps('/rankai/gongzhonghao/0/30', normalizedCookie);
    if (!pageMeta.isLogin) {
      return {
        ok: false,
        text: 'Cookie 无效或已过期',
      };
    }

    return {
      ok: true,
      text: pageMeta.nickname ? `已登录：${pageMeta.nickname}` : 'Cookie 有效',
    };
  } catch (error: any) {
    return {
      ok: false,
      text: normalizeText(error?.data?.msg || error?.data?.message || error?.message) || '新榜 Cookie 检测失败',
    };
  }
}

export async function getNewrankMpRecommendations(options: {
  cookie?: string;
  category?: string;
  limit?: number;
}): Promise<NewrankRecommendationsResult> {
  const categories = [...NEWRANK_RECOMMEND_CATEGORIES];
  const selectedCategory =
    categories.find(item => item.id === String(options.category || '').trim()) || categories[0];
  const limit = Math.min(30, Math.max(4, Number(options.limit) || 30));
  const cookie = normalizeCookieInput(options.cookie || process.env.NEWRANK_COOKIE || '');
  const cached = await readCachedCategoryRanking(selectedCategory, limit);

  if (!cookie) {
    if (cached?.items.length) {
      return buildRecommendationsResult({
        state: 'ready',
        message: 'Cookie 未配置，当前显示最近一次缓存的新榜月榜。',
        category: selectedCategory,
        categories,
        month: cached.month,
        monthLabel: cached.monthLabel,
        items: cached.items,
      });
    }

    return buildRecommendationsResult({
      state: 'missing_cookie',
      message: '请先在设置里填写新榜 Cookie，再加载公众号月榜推荐。',
      category: selectedCategory,
      categories,
      month: '',
      monthLabel: '',
      items: [],
    });
  }

  try {
    const valid = await validateNewrankCookie(cookie);
    if (!valid.ok) {
      if (cached?.items.length) {
        return buildRecommendationsResult({
          state: 'ready',
          message: `${valid.text}，已回退到最近一次缓存的新榜月榜。`,
          category: selectedCategory,
          categories,
          month: cached.month,
          monthLabel: cached.monthLabel,
          items: cached.items,
        });
      }

      return buildRecommendationsResult({
        state: 'missing_cookie',
        message: valid.text,
        category: selectedCategory,
        categories,
        month: '',
        monthLabel: '',
        items: [],
      });
    }

    const result = selectedCategory.kind === 'rankai'
      ? await fetchAiCategoryRanking(cookie, selectedCategory, limit)
      : await fetchRanklistCategoryRanking(cookie, selectedCategory, limit);

    if (result.items.length > 0) {
      await writeCachedCategoryRanking(selectedCategory, result);
    }

    return buildRecommendationsResult({
      state: result.items.length > 0 ? 'ready' : 'empty',
      message: result.items.length > 0 ? '' : '当前分类暂无可展示的新榜月榜公众号，换个分类试试。',
      category: selectedCategory,
      categories,
      month: result.month,
      monthLabel: result.monthLabel,
      items: result.items,
    });
  } catch (error) {
    const message = normalizeText(error?.data?.msg || error?.data?.message || error?.message) || '加载新榜推荐失败';

    if (cached?.items.length) {
      return buildRecommendationsResult({
        state: 'ready',
        message: `${message}，已回退到最近一次缓存的新榜月榜。`,
        category: selectedCategory,
        categories,
        month: cached.month,
        monthLabel: cached.monthLabel,
        items: cached.items,
      });
    }

    return buildRecommendationsResult({
      state: 'error',
      message,
      category: selectedCategory,
      categories,
      month: '',
      monthLabel: '',
      items: [],
    });
  }
}
