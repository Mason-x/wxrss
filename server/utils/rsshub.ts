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

const RSSHUB_ROUTE_INDEX_URLS = [
  'https://raw.githubusercontent.com/DIYgod/RSSHub/refs/heads/gh-pages/build/routes.json',
  'https://diygod.github.io/RSSHub/build/routes.json',
];
const RSSHUB_ROUTE_INDEX_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const ROUTE_PARAM_SEGMENT_PATTERN = /^:([A-Za-z0-9_]+)(?:\{[^}]+\})?(\?)?$/;

let routeIndexCache:
  | {
      loadedAt: number;
      items: RsshubDiscoverItem[];
    }
  | null = null;
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
  return `${normalized.slice(0, maxLength - 1)}…`;
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
  return Array.from(
    new Set(
      values
        .map(value => normalizeWhitespace(String(value || '')))
        .filter(Boolean)
    )
  );
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

      items.push({
        id: `${namespace}:${routePath}`,
        namespace,
        namespaceName,
        routeName,
        routePath,
        rsshubUrl,
        siteUrl: normalizeWhitespace(String(route?.url || namespaceUrl || '')),
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
    return routeIndexCache.items;
  }

  if (!routeIndexPromise) {
    routeIndexPromise = fetchRouteIndexFromRemote()
      .then(items => {
        routeIndexCache = {
          loadedAt: Date.now(),
          items,
        };
        return items;
      })
      .finally(() => {
        routeIndexPromise = null;
      });
  }

  return await routeIndexPromise;
}

export async function searchRsshubRoutes(keyword: string, limit = 20): Promise<RsshubDiscoverItem[]> {
  const terms = normalizeWhitespace(keyword)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  const items = await getRsshubRouteIndex();
  return items
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
    .slice(0, Math.max(1, Math.min(50, Math.floor(limit) || 20)))
    .map(entry => entry.item);
}
