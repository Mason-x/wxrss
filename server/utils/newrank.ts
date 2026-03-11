import { USER_AGENT } from '~/config';

const NEWRANK_TOKEN = '3b2f8f99af0545cc989cfae76477d9bf';
const NEWRANK_REFERER = 'https://www.newrank.cn/public/info/list.html?period=month&type=data&typeName=%E6%8E%92%E8%A1%8C';
const NEWRANK_TIME_ENDPOINT = 'https://gw.newrank.cn/api/mainRank/nr/mainRank/rank/wxRankTime';
const NEWRANK_MONTH_RANK_ENDPOINT = 'https://gw.newrank.cn/api/main/xdnphb/main/v1/month/rank';
const TIME_CACHE_TTL_MS = 1000 * 60 * 60;

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

interface NewrankTimeResponse {
  code?: number;
  msg?: string;
  data?: {
    monthList?: Array<{
      label?: string;
      value?: string;
    }>;
  };
}

interface NewrankMonthRankResponse {
  success?: boolean;
  value?: {
    countNum?: string | number;
    datas?: any[];
  };
  msg?: string;
}

const NEWRANK_RECOMMEND_CATEGORIES: NewrankRecommendCategory[] = [
  {
    id: 'tech',
    label: '科技',
    description: '科技与互联网公众号月榜',
    rankName: '科技',
    rankGroup: '资讯',
    accentFrom: '#5ba5e8',
    accentTo: '#87c9fb',
  },
  {
    id: 'finance',
    label: '财经',
    description: '商业、投研与财经资讯月榜',
    rankName: '财经',
    rankGroup: '资讯',
    accentFrom: '#72c67b',
    accentTo: '#96daa0',
  },
  {
    id: 'education',
    label: '教育',
    description: '教育、学习与知识类公众号月榜',
    rankName: '教育',
    rankGroup: '资讯',
    accentFrom: '#6eb1f0',
    accentTo: '#97c8fb',
  },
  {
    id: 'culture',
    label: '文化',
    description: '人文、读书与文化内容月榜',
    rankName: '文化',
    rankGroup: '资讯',
    accentFrom: '#b582e8',
    accentTo: '#c89af2',
  },
  {
    id: 'emotion',
    label: '情感',
    description: '情感与关系话题公众号月榜',
    rankName: '情感',
    rankGroup: '生活',
    accentFrom: '#f48ca8',
    accentTo: '#f7a9bf',
  },
  {
    id: 'food',
    label: '美食',
    description: '美食、餐饮与探店内容月榜',
    rankName: '美食',
    rankGroup: '生活',
    accentFrom: '#f2b665',
    accentTo: '#f6ca88',
  },
  {
    id: 'travel',
    label: '旅行',
    description: '旅行、出行与城市内容月榜',
    rankName: '旅游',
    rankGroup: '生活',
    accentFrom: '#6bc9c6',
    accentTo: '#92dddd',
  },
  {
    id: 'fashion',
    label: '时尚',
    description: '时尚、美妆与生活方式月榜',
    rankName: '时尚',
    rankGroup: '生活',
    accentFrom: '#f27eb4',
    accentTo: '#f7a1cb',
  },
];

let timeCache:
  | {
      expiresAt: number;
      month: string;
      label: string;
    }
  | null = null;

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
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

function getRequestHeaders(cookie: string) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    Cookie: cookie,
    'N-Token': NEWRANK_TOKEN,
    Origin: 'https://www.newrank.cn',
    Referer: NEWRANK_REFERER,
    'User-Agent': USER_AGENT,
  };
}

async function fetchLatestMonth(cookie: string): Promise<{ month: string; label: string }> {
  if (timeCache && timeCache.expiresAt > Date.now()) {
    return {
      month: timeCache.month,
      label: timeCache.label,
    };
  }

  const response = await $fetch<NewrankTimeResponse>(NEWRANK_TIME_ENDPOINT, {
    method: 'POST',
    headers: getRequestHeaders(cookie),
  });

  const latestMonth = Array.isArray(response?.data?.monthList) ? response.data!.monthList![0] : null;
  const month = normalizeText(latestMonth?.value);
  if (!month) {
    throw new Error(normalizeText(response?.msg) || '未获取到新榜月榜时间');
  }

  const label = normalizeText(latestMonth?.label || month);
  timeCache = {
    expiresAt: Date.now() + TIME_CACHE_TTL_MS,
    month,
    label,
  };

  return {
    month,
    label,
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
    avatar: normalizeAvatar(row?.head_image_url || row?.round_head_img || row?.avatar),
    uuid: normalizeText(row?.uuid),
    score: toNullableNumber(row?.log1p_mark ?? row?.score ?? row?.mark),
    rank,
    sourceLabel: `${monthLabel} · ${category.label}`,
    searchKeyword,
  };
}

async function fetchCategoryRanking(
  cookie: string,
  category: NewrankRecommendCategory,
  month: string,
  monthLabel: string,
  limit: number
): Promise<NewrankRecommendItem[]> {
  const response = await $fetch<NewrankMonthRankResponse>(NEWRANK_MONTH_RANK_ENDPOINT, {
    method: 'POST',
    headers: getRequestHeaders(cookie),
    body: {
      start: month,
      end: month,
      rank_name: category.rankName,
      rank_name_group: category.rankGroup,
    },
  });

  const rows = Array.isArray(response?.value?.datas) ? response.value!.datas! : [];
  const deduped = new Map<string, NewrankRecommendItem>();

  for (const [index, row] of rows.entries()) {
    const item = normalizeRankRow(row, category, monthLabel, index + 1);
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

  return Array.from(deduped.values());
}

export async function getNewrankMpRecommendations(options: {
  cookie?: string;
  category?: string;
  limit?: number;
}): Promise<NewrankRecommendationsResult> {
  const categories = [...NEWRANK_RECOMMEND_CATEGORIES];
  const selectedCategory =
    categories.find(item => item.id === String(options.category || '').trim()) || categories[0];
  const limit = Math.min(20, Math.max(4, Number(options.limit) || 8));
  const cookie = String(options.cookie || process.env.NEWRANK_COOKIE || '').trim();

  if (!cookie) {
    return {
      state: 'missing_cookie',
      message: '请先在设置里填写新榜 Cookie，才能加载公众号月榜推荐。',
      selectedCategory: selectedCategory.id,
      latestMonth: '',
      latestMonthLabel: '',
      categories,
      items: [],
    };
  }

  try {
    const { month, label } = await fetchLatestMonth(cookie);
    const items = await fetchCategoryRanking(cookie, selectedCategory, month, label, limit);
    return {
      state: items.length > 0 ? 'ready' : 'empty',
      message: items.length > 0 ? '' : '当前分类暂无可展示的月榜公众号，换个分类试试。',
      selectedCategory: selectedCategory.id,
      latestMonth: month,
      latestMonthLabel: label,
      categories,
      items,
    };
  } catch (error: any) {
    return {
      state: 'error',
      message: normalizeText(error?.data?.msg || error?.data?.message || error?.message) || '加载新榜推荐失败',
      selectedCategory: selectedCategory.id,
      latestMonth: '',
      latestMonthLabel: '',
      categories,
      items: [],
    };
  }
}
