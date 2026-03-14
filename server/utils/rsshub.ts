interface RsshubParameterOption {
  label?: string;
  value?: string;
}

interface RsshubParameterObject {
  description?: string;
  default?: string | null;
  options?: RsshubParameterOption[];
}

type RsshubParameter = string | RsshubParameterObject;

interface RsshubRouteDeclaration {
  path?: string;
  name?: string;
  url?: string;
  maintainers?: string[];
  example?: string;
  parameters?: Record<string, RsshubParameter>;
  description?: string;
  categories?: string[];
  features?: {
    requireConfig?: boolean;
  };
}

interface RsshubNamespaceDeclaration {
  routes?: Record<string, RsshubRouteDeclaration>;
  name?: string;
  url?: string;
  categories?: string[];
}

interface RsshubRoutesDocument {
  [namespace: string]: RsshubNamespaceDeclaration;
}

interface RsshubCategoryMeta {
  label: string;
  description: string;
  icon: string;
  accentFrom: string;
  accentTo: string;
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

export interface RsshubDiscoverCatalog {
  categories: RsshubCategoryItem[];
  routes: RsshubDiscoverItem[];
}

const RSSHUB_ROUTE_INDEX_URLS = [
  'https://raw.githubusercontent.com/DIYgod/RSSHub/refs/heads/gh-pages/build/routes.json',
  'https://diygod.github.io/RSSHub/build/routes.json',
];
const RSSHUB_ROUTE_INDEX_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const ROUTE_PARAM_SEGMENT_PATTERN = /^:([A-Za-z0-9_]+)(?:\{[^}]+\})?(\?)?$/;
const RSSHUB_NSFW_NAMESPACE_BLOCKLIST = new Set([
  '141jav',
  '141ppv',
  '18comic',
  '2048',
  '4khd',
  '4kup',
  '7mmtv',
  '8kcos',
  '91porn',
  '95mm',
  'asiantolick',
  'asmr-200',
  'booru',
  'chikubi',
  'cool18',
  'coomer',
  'cosplaytele',
  'playno1',
  'sis001',
  't66y',
  'xsijishe',
]);
const RSSHUB_NSFW_TEXT_KEYWORDS = [
  'nsfw',
  'adult',
  'porn',
  'onlyfans',
  'hentai',
  'fanbox',
  'fantia',
  'missav',
  'rule34',
  'jav',
  'avmaker',
  '成人',
  '情色',
  '成人视频',
  '禁漫',
  '禁忌',
  '乳首',
  '核基地',
];
const RSSHUB_NSFW_HOST_KEYWORDS = [
  '141jav',
  '141ppv',
  '91porn',
  'jmcomic',
  'coomer',
  '4khd',
  '4kup',
  '8kcosplay',
  '95mm',
  'cool18',
  'chikubi',
  'cosplaytele',
  'playno1',
  'sis001',
  'stno1.playno1.com',
  't66y',
  'xsijishe',
];
const RSSHUB_CATEGORY_ORDER = [
  'all',
  'social-media',
  'new-media',
  'traditional-media',
  'bbs',
  'blog',
  'programming',
  'design',
  'live',
  'multimedia',
  'picture',
  'anime',
  'program-update',
  'shopping',
  'game',
  'reading',
  'journal',
  'finance',
  'study',
  'travel',
  'government',
  'forecast',
  'other',
] as const;
const RSSHUB_CATEGORY_META: Record<string, RsshubCategoryMeta> = {
  all: {
    label: '全部',
    description: '查看全部 RSSHub 路由',
    icon: 'i-lucide:star',
    accentFrom: '#f6c84f',
    accentTo: '#f3dd76',
  },
  'social-media': {
    label: '社交媒体',
    description: '社交平台与用户动态',
    icon: 'i-lucide:messages-square',
    accentFrom: '#5ba5e8',
    accentTo: '#87c9fb',
  },
  'new-media': {
    label: '新媒体',
    description: '自媒体与资讯平台',
    icon: 'i-lucide:megaphone',
    accentFrom: '#f48b6a',
    accentTo: '#f8a678',
  },
  'traditional-media': {
    label: '传统媒体',
    description: '报刊电视与媒体站点',
    icon: 'i-lucide:newspaper',
    accentFrom: '#c6c7cf',
    accentTo: '#d8d9de',
  },
  bbs: {
    label: '论坛',
    description: '论坛与社区讨论区',
    icon: 'i-lucide:cloud',
    accentFrom: '#efc276',
    accentTo: '#f5d18f',
  },
  blog: {
    label: '博客',
    description: '博客与个人站点',
    icon: 'i-lucide:pen-tool',
    accentFrom: '#b15bd7',
    accentTo: '#d07be4',
  },
  programming: {
    label: '编程',
    description: '开发者平台与代码托管',
    icon: 'i-lucide:laptop',
    accentFrom: '#70c57b',
    accentTo: '#92d29c',
  },
  design: {
    label: '设计',
    description: '设计创意与灵感资源',
    icon: 'i-lucide:palette',
    accentFrom: '#ef679b',
    accentTo: '#f38ab0',
  },
  live: {
    label: '直播',
    description: '直播与实时内容',
    icon: 'i-lucide:monitor-play',
    accentFrom: '#ee6a6a',
    accentTo: '#f28f92',
  },
  multimedia: {
    label: '音视频',
    description: '视频、音乐与播客',
    icon: 'i-lucide:film',
    accentFrom: '#f59a7c',
    accentTo: '#f3b391',
  },
  picture: {
    label: '图片',
    description: '图片站与视觉内容',
    icon: 'i-lucide:image',
    accentFrom: '#4ebec1',
    accentTo: '#7bd5d7',
  },
  anime: {
    label: '二次元',
    description: '动漫游戏与二创内容',
    icon: 'i-lucide:sparkles',
    accentFrom: '#f58bbd',
    accentTo: '#f8a8ce',
  },
  'program-update': {
    label: '程序更新',
    description: '软件发布与版本更新',
    icon: 'i-lucide:refresh-cw',
    accentFrom: '#a4b6c1',
    accentTo: '#c1ced7',
  },
  shopping: {
    label: '购物',
    description: '电商与消费平台',
    icon: 'i-lucide:shopping-bag',
    accentFrom: '#efc34a',
    accentTo: '#f2d26e',
  },
  game: {
    label: '游戏',
    description: '游戏资讯与社区',
    icon: 'i-lucide:gamepad-2',
    accentFrom: '#8a6de2',
    accentTo: '#a58cf0',
  },
  reading: {
    label: '阅读',
    description: '图书、专栏与内容阅读',
    icon: 'i-lucide:book-open',
    accentFrom: '#69a9da',
    accentTo: '#86c0ea',
  },
  journal: {
    label: '科学期刊',
    description: '期刊论文与学术出版',
    icon: 'i-lucide:notebook-text',
    accentFrom: '#bfb0ad',
    accentTo: '#d4c6c3',
  },
  finance: {
    label: '金融',
    description: '财经与市场资讯',
    icon: 'i-lucide:badge-dollar-sign',
    accentFrom: '#8ccc91',
    accentTo: '#a4d8aa',
  },
  study: {
    label: '学习',
    description: '教育、课程与学习资源',
    icon: 'i-lucide:graduation-cap',
    accentFrom: '#8fc5ef',
    accentTo: '#add6f6',
  },
  travel: {
    label: '出行',
    description: '旅行、交通与本地资讯',
    icon: 'i-lucide:plane',
    accentFrom: '#72c8c9',
    accentTo: '#95d8db',
  },
  government: {
    label: '政务',
    description: '政府机构与公告',
    icon: 'i-lucide:landmark',
    accentFrom: '#7db2d9',
    accentTo: '#9cc8e8',
  },
  forecast: {
    label: '天气预报',
    description: '天气、地震与预警',
    icon: 'i-lucide:cloud-sun',
    accentFrom: '#75c9ef',
    accentTo: '#93d7f7',
  },
  other: {
    label: '其他',
    description: '未归类或杂项路由',
    icon: 'i-lucide:grid-2x2',
    accentFrom: '#aeb6c4',
    accentTo: '#c3cad6',
  },
};

let routeIndexCache: {
  loadedAt: number;
  items: RsshubDiscoverItem[];
} | null = null;
let routeIndexPromise: Promise<RsshubDiscoverItem[]> | null = null;

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdown(value: string): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/:::[\s\S]*?:::/g, ' ')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateSummary(value: string, maxLength = 140): string {
  const normalized = normalizeWhitespace(stripMarkdown(value));
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function normalizeParameterDefinition(key: string, parameter?: RsshubParameter, required = true): RsshubDiscoverParam {
  if (typeof parameter === 'string') {
    return {
      key,
      description: normalizeWhitespace(stripMarkdown(parameter)),
      required,
      defaultValue: '',
      options: [],
    };
  }

  return {
    key,
    description: normalizeWhitespace(stripMarkdown(String(parameter?.description || ''))),
    required,
    defaultValue: String(parameter?.default || '').trim(),
    options: Array.isArray(parameter?.options)
      ? parameter.options
          .map(option => ({
            label: normalizeWhitespace(String(option?.label || option?.value || '')),
            value: String(option?.value || '').trim(),
          }))
          .filter(option => option.label && option.value)
      : [],
  };
}

function extractRouteParams(
  routePath: string,
  parameters: Record<string, RsshubParameter> | undefined
): RsshubDiscoverParam[] {
  const definitions = parameters || {};
  return routePath
    .split('/')
    .filter(Boolean)
    .flatMap(segment => {
      const match = ROUTE_PARAM_SEGMENT_PATTERN.exec(segment);
      if (!match) {
        return [];
      }
      const key = match[1];
      const required = !Boolean(match[2]);
      return [normalizeParameterDefinition(key, definitions[key], required)];
    });
}

function uniqueTextList(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map(value => normalizeWhitespace(String(value || ''))).filter(Boolean)));
}

function buildSearchCorpus(item: RsshubDiscoverItem): string {
  return normalizeWhitespace(
    [
      item.routeName,
      item.namespaceName,
      item.siteUrl,
      item.routePath,
      item.rsshubUrl,
      item.summary,
      item.categories.join(' '),
      item.maintainers.join(' '),
    ].join(' ')
  ).toLowerCase();
}

function calculateSearchScore(item: RsshubDiscoverItem, terms: string[]): number {
  const routeName = item.routeName.toLowerCase();
  const namespaceName = item.namespaceName.toLowerCase();
  const routePath = item.routePath.toLowerCase();
  const corpus = buildSearchCorpus(item);

  let score = 0;
  for (const term of terms) {
    if (!term) {
      continue;
    }
    if (!corpus.includes(term)) {
      return 0;
    }
    if (routeName === term) score += 160;
    if (routeName.includes(term)) score += 80;
    if (namespaceName.includes(term)) score += 48;
    if (routePath.includes(term)) score += 36;
    if (item.siteUrl.toLowerCase().includes(term)) score += 28;
    if (item.summary.toLowerCase().includes(term)) score += 16;
  }

  if (!item.requiresConfig) {
    score += 8;
  }
  score -= item.params.length * 2;
  return score;
}

function buildRsshubRouteUri(namespace: string, routePath: string): string {
  const normalizedPath = String(routePath || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return `rsshub://${namespace}`;
  }
  return `rsshub://${namespace}${normalizedPath}`.replace(/\/+$/, '');
}

function isNsfwRouteCandidate(input: {
  namespace: string;
  namespaceName: string;
  routeName: string;
  routePath: string;
  siteUrl: string;
  summary: string;
}): boolean {
  const namespace = String(input.namespace || '')
    .trim()
    .toLowerCase();
  if (RSSHUB_NSFW_NAMESPACE_BLOCKLIST.has(namespace)) {
    return true;
  }

  const haystack = [
    input.namespace,
    input.namespaceName,
    input.routeName,
    input.routePath,
    input.siteUrl,
    input.summary,
  ]
    .map(value =>
      String(value || '')
        .trim()
        .toLowerCase()
    )
    .join(' ');

  if (RSSHUB_NSFW_HOST_KEYWORDS.some(keyword => haystack.includes(keyword))) {
    return true;
  }

  return RSSHUB_NSFW_TEXT_KEYWORDS.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function filterNsfwRoutes(items: RsshubDiscoverItem[]): RsshubDiscoverItem[] {
  return items.filter(
    item =>
      !isNsfwRouteCandidate({
        namespace: item.namespace,
        namespaceName: item.namespaceName,
        routeName: item.routeName,
        routePath: item.routePath,
        siteUrl: item.siteUrl,
        summary: item.summary,
      })
  );
}

function flattenRsshubRoutes(document: RsshubRoutesDocument): RsshubDiscoverItem[] {
  const items: RsshubDiscoverItem[] = [];

  for (const [namespace, namespaceValue] of Object.entries(document || {})) {
    const namespaceName = normalizeWhitespace(String(namespaceValue?.name || namespace));
    const namespaceUrl = normalizeWhitespace(String(namespaceValue?.url || ''));
    const namespaceCategories = Array.isArray(namespaceValue?.categories) ? namespaceValue.categories : [];
    const routes = namespaceValue?.routes || {};

    for (const route of Object.values(routes)) {
      const routePath = String(route?.path || '').trim();
      if (!routePath) {
        continue;
      }

      const routeName = normalizeWhitespace(String(route?.name || routePath));
      const rsshubUrl = buildRsshubRouteUri(namespace, routePath);
      const categories = uniqueTextList([...(route?.categories || []), ...namespaceCategories]);
      const params = extractRouteParams(routePath, route?.parameters);
      const summary = truncateSummary(route?.description || route?.name || routePath);
      const siteUrl = normalizeWhitespace(String(route?.url || namespaceUrl || ''));

      if (
        isNsfwRouteCandidate({
          namespace,
          namespaceName,
          routeName,
          routePath,
          siteUrl,
          summary,
        })
      ) {
        continue;
      }

      items.push({
        id: `${namespace}:${routePath}`,
        namespace,
        namespaceName,
        routeName,
        routePath,
        rsshubUrl,
        siteUrl,
        summary,
        categories,
        maintainers: uniqueTextList(route?.maintainers || []),
        params,
        requiresConfig: Boolean(route?.features?.requireConfig),
      });
    }
  }

  return items;
}

function formatFallbackCategoryLabel(category: string): string {
  return String(category || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getCategoryMeta(category: string): RsshubCategoryMeta {
  return (
    RSSHUB_CATEGORY_META[category] || {
      label: formatFallbackCategoryLabel(category),
      description: 'RSSHub 路由分类',
      icon: 'i-lucide:folder-open',
      accentFrom: '#94a3b8',
      accentTo: '#cbd5e1',
    }
  );
}

function buildCategoryList(items: RsshubDiscoverItem[]): RsshubCategoryItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const category of item.categories) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }

  const categories = Array.from(counts.entries()).map(([id, routeCount]) => {
    const meta = getCategoryMeta(id);
    return {
      id,
      label: meta.label,
      description: meta.description,
      icon: meta.icon,
      accentFrom: meta.accentFrom,
      accentTo: meta.accentTo,
      routeCount,
    };
  });

  categories.sort((left, right) => {
    const leftOrder = RSSHUB_CATEGORY_ORDER.indexOf(left.id as (typeof RSSHUB_CATEGORY_ORDER)[number]);
    const rightOrder = RSSHUB_CATEGORY_ORDER.indexOf(right.id as (typeof RSSHUB_CATEGORY_ORDER)[number]);
    const safeLeftOrder = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
    const safeRightOrder = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;

    if (safeLeftOrder !== safeRightOrder) {
      return safeLeftOrder - safeRightOrder;
    }
    if (right.routeCount !== left.routeCount) {
      return right.routeCount - left.routeCount;
    }
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });

  const allMeta = getCategoryMeta('all');
  return [
    {
      id: 'all',
      label: allMeta.label,
      description: allMeta.description,
      icon: allMeta.icon,
      accentFrom: allMeta.accentFrom,
      accentTo: allMeta.accentTo,
      routeCount: items.length,
    },
    ...categories,
  ];
}

function sortRoutesForCategory(items: RsshubDiscoverItem[]): RsshubDiscoverItem[] {
  return [...items].sort((left, right) => {
    const namespaceDiff = left.namespaceName.localeCompare(right.namespaceName, 'zh-Hans-CN');
    if (namespaceDiff !== 0) {
      return namespaceDiff;
    }
    if (left.params.length !== right.params.length) {
      return left.params.length - right.params.length;
    }
    return left.routeName.localeCompare(right.routeName, 'zh-Hans-CN');
  });
}

async function fetchRouteIndexFromRemote(): Promise<RsshubDiscoverItem[]> {
  let lastError: Error | null = null;

  for (const url of RSSHUB_ROUTE_INDEX_URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 RSSHub Route Search',
        },
      });
      if (!response.ok) {
        throw new Error(`fetch failed (${response.status})`);
      }
      const document = (await response.json()) as RsshubRoutesDocument;
      const items = flattenRsshubRoutes(document);
      if (items.length > 0) {
        return items;
      }
      throw new Error('route index is empty');
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError || new Error('failed to load RSSHub route index');
}

async function getRsshubRouteIndex(): Promise<RsshubDiscoverItem[]> {
  const now = Date.now();
  if (routeIndexCache && now - routeIndexCache.loadedAt < RSSHUB_ROUTE_INDEX_CACHE_TTL_MS) {
    return filterNsfwRoutes(routeIndexCache.items);
  }

  if (!routeIndexPromise) {
    routeIndexPromise = fetchRouteIndexFromRemote()
      .then(items => {
        const filteredItems = filterNsfwRoutes(items);
        routeIndexCache = {
          loadedAt: Date.now(),
          items: filteredItems,
        };
        return filteredItems;
      })
      .finally(() => {
        routeIndexPromise = null;
      });
  }

  return await routeIndexPromise;
}

export async function discoverRsshubCatalog(options?: {
  keyword?: string;
  category?: string;
  limit?: number;
}): Promise<RsshubDiscoverCatalog> {
  const keyword = normalizeWhitespace(String(options?.keyword || ''));
  const category = normalizeWhitespace(String(options?.category || ''));
  const limit = Math.max(1, Math.min(200, Math.floor(Number(options?.limit) || 0) || (keyword ? 20 : 120)));
  const items = await getRsshubRouteIndex();
  const categories = buildCategoryList(items);

  if (keyword) {
    const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    const routes = items
      .map(item => ({
        item,
        score: calculateSearchScore(item, terms),
      }))
      .filter(entry => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.item.params.length !== right.item.params.length) {
          return left.item.params.length - right.item.params.length;
        }
        return left.item.routeName.localeCompare(right.item.routeName, 'zh-Hans-CN');
      })
      .slice(0, limit)
      .map(entry => entry.item);

    return {
      categories,
      routes,
    };
  }

  if (category) {
    const normalizedCategory = category === 'all' ? '' : category;
    const filteredRoutes = normalizedCategory
      ? items.filter(item => item.categories.includes(normalizedCategory))
      : items;

    return {
      categories,
      routes: sortRoutesForCategory(filteredRoutes).slice(0, limit),
    };
  }

  return {
    categories,
    routes: [],
  };
}

export async function searchRsshubRoutes(keyword: string, limit = 20): Promise<RsshubDiscoverItem[]> {
  const catalog = await discoverRsshubCatalog({ keyword, limit });
  return catalog.routes;
}
