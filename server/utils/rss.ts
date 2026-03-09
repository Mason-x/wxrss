import * as cheerio from 'cheerio';
import { getAccountByFakeid, type ReaderAccount, upsertArticles } from '~/server/repositories/reader';
import { upsertHtmlCache } from '~/server/repositories/cache';

const DEFAULT_RSSHUB_BASE_URL = 'https://rsshub.app';
const MAX_RSS_ITEMS = 200;
const HTML_TAG_PATTERN = /<([a-z][\w:-]*)(\s[^>]*)?>/i;

interface SyncRssFeedInput {
  fakeid?: string;
  url?: string;
}

interface ParsedRssItem {
  aid: string;
  appmsgid: number;
  itemidx: number;
  link: string;
  title: string;
  digest: string;
  author_name: string;
  cover: string;
  create_time: number;
  update_time: number;
  item_show_type: number;
  media_duration: string;
  appmsg_album_infos: any[];
  copyright_stat: number;
  copyright_type: number;
  is_deleted: boolean;
  _status: string;
}

interface ParsedRssFeed {
  sourceUrl: string;
  siteUrl: string;
  title: string;
  description: string;
  image: string;
  items: Array<{
    article: ParsedRssItem;
    html: string;
  }>;
}

export interface SyncRssFeedResult {
  account: ReaderAccount;
  inserted: number;
  totalCount: number;
  sourceUrl: string;
}

function nowSeconds(): number {
  return Math.round(Date.now() / 1000);
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeHtml(value: string): boolean {
  return HTML_TAG_PATTERN.test(value);
}

function ensureHttpUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('RSS 地址只支持 http/https');
  }
  return parsed.toString();
}

function getRsshubBaseUrl(): string {
  const configured = String(process.env.RSSHUB_BASE_URL || DEFAULT_RSSHUB_BASE_URL).trim();
  return ensureHttpUrl(configured);
}

export function normalizeRssSourceUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new Error('RSS 地址不能为空');
  }

  if (trimmed.startsWith('rsshub://')) {
    const route = trimmed.slice('rsshub://'.length).trim();
    if (!route) {
      throw new Error('RSSHub 路由不能为空');
    }
    const baseUrl = new URL(getRsshubBaseUrl());
    const pathname = route.startsWith('/') ? route : `/${route}`;
    return new URL(pathname, baseUrl).toString();
  }

  return ensureHttpUrl(trimmed);
}

function buildRssFakeid(sourceUrl: string): string {
  return `rss:${hashString(sourceUrl)}`;
}

function resolveAbsoluteUrl(value: string, baseUrl: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function findByLocalName($scope: cheerio.Cheerio<any>, localName: string): cheerio.Cheerio<any> {
  const expected = localName.toLowerCase();
  return $scope.find('*').filter((_, element) => {
    const name = String((element as any)?.tagName || (element as any)?.name || '').toLowerCase();
    return name === expected || name.endsWith(`:${expected}`);
  });
}

function firstTextByLocalNames($scope: cheerio.Cheerio<any>, localNames: string[]): string {
  for (const localName of localNames) {
    const value = normalizeWhitespace(findByLocalName($scope, localName).first().text());
    if (value) {
      return value;
    }
  }
  return '';
}

function firstAttrByLocalNames($scope: cheerio.Cheerio<any>, localNames: string[], attr: string): string {
  for (const localName of localNames) {
    const value = normalizeWhitespace(String(findByLocalName($scope, localName).first().attr(attr) || ''));
    if (value) {
      return value;
    }
  }
  return '';
}

function extractMarkupByLocalNames($scope: cheerio.Cheerio<any>, localNames: string[]): string {
  for (const localName of localNames) {
    const node = findByLocalName($scope, localName).first();
    if (!node.length) {
      continue;
    }

    const html = String(node.html() || '').trim();
    if (html && looksLikeHtml(html) && !html.startsWith('<![CDATA[')) {
      return html;
    }

    const text = String(node.text() || '').trim();
    if (text) {
      return text;
    }

    if (html) {
      return html;
    }
  }
  return '';
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildParagraphHtml(text: string): string {
  const lines = String(text || '')
    .split(/\n{2,}/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return '<p style="color:#64748b;">暂无正文</p>';
  }

  return lines.map(line => `<p>${escapeHtml(line)}</p>`).join('');
}

function extractTextExcerpt(source: string, maxLength = 140): string {
  const html = String(source || '').trim();
  if (!html) {
    return '';
  }

  const plainText = normalizeWhitespace(cheerio.load(`<div>${html}</div>`).text());
  if (!plainText) {
    return '';
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }
  return `${plainText.slice(0, maxLength - 1)}…`;
}

function extractCoverUrl(contentHtml: string, fallbackLink: string): string {
  const html = String(contentHtml || '').trim();
  if (!html) {
    return '';
  }

  const $ = cheerio.load(html);
  const imageSrc = normalizeWhitespace(String($('img[src]').first().attr('src') || ''));
  if (imageSrc) {
    return resolveAbsoluteUrl(imageSrc, fallbackLink);
  }

  const posterSrc = normalizeWhitespace(String($('video[poster]').first().attr('poster') || ''));
  if (posterSrc) {
    return resolveAbsoluteUrl(posterSrc, fallbackLink);
  }

  return '';
}

function parseUnixTimestamp(value: string): number {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return 0;
  }

  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct > 0) {
    return direct > 1_000_000_000_000 ? Math.floor(direct / 1000) : Math.floor(direct);
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed / 1000);
}

function deriveFallbackSiteIcon(siteUrl: string): string {
  const target = String(siteUrl || '').trim();
  if (!target) {
    return '';
  }

  try {
    return new URL('/favicon.ico', target).toString();
  } catch {
    return '';
  }
}

function normalizeBodyHtml(rawHtml: string, fallbackText: string): string {
  const trimmed = String(rawHtml || '').trim();
  if (!trimmed) {
    return buildParagraphHtml(fallbackText);
  }

  if (looksLikeHtml(trimmed)) {
    if (/<html[\s>]/i.test(trimmed)) {
      const $ = cheerio.load(trimmed);
      const bodyHtml = String($('body').html() || '').trim();
      if (bodyHtml) {
        return bodyHtml;
      }
    }
    return trimmed;
  }

  return buildParagraphHtml(trimmed);
}

function buildRssHtmlDocument(contentHtml: string, baseUrl: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />',
    `<base href="${escapeHtml(baseUrl)}" />`,
    '<style>',
    'html,body{margin:0;padding:0;background:#fff;color:#0f172a;}',
    'body{font:16px/1.78 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-x:hidden;}',
    'article{padding:0 0 32px;}',
    'img,video,iframe{max-width:100%!important;height:auto!important;}',
    'a{color:#2563eb;text-decoration:none;}',
    'pre{overflow:auto;border-radius:14px;background:#f8fafc;padding:16px;}',
    'blockquote{margin:1.25rem 0;padding-left:1rem;border-left:3px solid #cbd5e1;color:#475569;}',
    'table{border-collapse:collapse;max-width:none;}',
    'th,td{border:1px solid #e2e8f0;padding:.5rem .75rem;}',
    '</style>',
    '</head>',
    '<body>',
    `<article>${contentHtml}</article>`,
    '</body>',
    '</html>',
  ].join('');
}

function parseRssItem($item: cheerio.Cheerio<any>, feedUrl: string, fallbackAuthor: string): {
  article: ParsedRssItem;
  html: string;
} | null {
  const title = firstTextByLocalNames($item, ['title']) || 'Untitled';
  const itemLinkText = firstTextByLocalNames($item, ['link', 'guid', 'id']);
  const atomLink = normalizeWhitespace(String(findByLocalName($item, 'link').first().attr('href') || ''));
  const link = resolveAbsoluteUrl(atomLink || itemLinkText, feedUrl);
  const fallbackLink = link || `${feedUrl}#${hashString(`${title}:${itemLinkText}`)}`;

  const contentMarkup = extractMarkupByLocalNames($item, ['encoded', 'content', 'description', 'summary']);
  const normalizedHtml = normalizeBodyHtml(contentMarkup, firstTextByLocalNames($item, ['description', 'summary']));
  const digest = extractTextExcerpt(contentMarkup || normalizedHtml || title);
  const cover = extractCoverUrl(normalizedHtml, fallbackLink);
  const authorName =
    firstTextByLocalNames($item, ['creator', 'author', 'name']) || fallbackAuthor || 'RSS';
  const publishedAt =
    parseUnixTimestamp(firstTextByLocalNames($item, ['pubDate', 'published', 'updated', 'date', 'created'])) ||
    nowSeconds();

  const article: ParsedRssItem = {
    aid: hashString(`${fallbackLink}:${title}:${publishedAt}`),
    appmsgid: 0,
    itemidx: 1,
    link: fallbackLink,
    title,
    digest,
    author_name: authorName,
    cover,
    create_time: publishedAt,
    update_time: publishedAt,
    item_show_type: 11,
    media_duration: '',
    appmsg_album_infos: [],
    copyright_stat: 0,
    copyright_type: 0,
    is_deleted: false,
    _status: '',
  };

  return {
    article,
    html: buildRssHtmlDocument(normalizedHtml, fallbackLink),
  };
}

async function fetchAndParseRssFeed(sourceUrl: string): Promise<ParsedRssFeed> {
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 RSS Reader',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`RSS 拉取失败(${response.status})`);
  }

  const xml = await response.text();
  const $ = cheerio.load(xml, {
    xmlMode: true,
    decodeEntities: false,
  });

  const channel = $('rss > channel').first();
  const feed = $('feed').first();
  const root = channel.length ? channel : feed;
  if (!root.length) {
    throw new Error('无法识别 RSS/Atom 订阅源');
  }

  const siteUrl = resolveAbsoluteUrl(
    normalizeWhitespace(String(feed.find('link[rel="alternate"]').first().attr('href') || '')) ||
      normalizeWhitespace(String(feed.find('link:not([rel])').first().attr('href') || '')) ||
      normalizeWhitespace(String(channel.children('link').first().text() || '')) ||
      firstTextByLocalNames(root, ['link', 'id']),
    sourceUrl
  );
  const title = firstTextByLocalNames(root, ['title']) || siteUrl || sourceUrl;
  const description = firstTextByLocalNames(root, ['description', 'subtitle', 'tagline']);
  const imageSource =
    normalizeWhitespace(String(channel.find('image > url').first().text() || '')) ||
    normalizeWhitespace(String(feed.find('logo').first().text() || '')) ||
    normalizeWhitespace(String(feed.find('icon').first().text() || '')) ||
    firstAttrByLocalNames(root, ['image'], 'href');
  const image = resolveAbsoluteUrl(imageSource, siteUrl || sourceUrl) || deriveFallbackSiteIcon(siteUrl || sourceUrl);

  const itemNodes = channel.length ? channel.find('item').toArray() : feed.find('entry').toArray();
  const items = itemNodes
    .map(node => parseRssItem($(node), siteUrl || sourceUrl, title))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const updateDiff = right.article.update_time - left.article.update_time;
      if (updateDiff !== 0) {
        return updateDiff;
      }
      return right.article.create_time - left.article.create_time;
    })
    .slice(0, MAX_RSS_ITEMS);

  return {
    sourceUrl,
    siteUrl,
    title,
    description,
    image,
    items,
  };
}

export async function syncRssFeed(authKey: string, input: SyncRssFeedInput): Promise<SyncRssFeedResult> {
  let currentAccount: ReaderAccount | null = null;
  if (input.fakeid) {
    currentAccount = await getAccountByFakeid(authKey, String(input.fakeid));
    if (!currentAccount) {
      throw new Error('订阅源不存在');
    }
    if (String(currentAccount.source_type || 'mp') !== 'rss') {
      throw new Error('当前账号不是 RSS 订阅源');
    }
  }

  const sourceUrl = normalizeRssSourceUrl(String(input.url || currentAccount?.source_url || ''));
  const feed = await fetchAndParseRssFeed(sourceUrl);
  const fakeid = currentAccount?.fakeid || buildRssFakeid(sourceUrl);
  const totalCount = feed.items.length;
  const lastUpdateTime = nowSeconds();
  const accountPayload: Partial<ReaderAccount> & { fakeid: string } = {
    fakeid,
    nickname: feed.title || currentAccount?.nickname || sourceUrl,
    round_head_img: feed.image || currentAccount?.round_head_img || '',
    total_count: totalCount,
    completed: true,
    last_update_time: lastUpdateTime,
    source_type: 'rss',
    source_url: sourceUrl,
    site_url: feed.siteUrl || currentAccount?.site_url || '',
    description: feed.description || currentAccount?.description || '',
    category: currentAccount?.category || '',
    focused: Boolean(currentAccount?.focused),
  };

  const { inserted } = await upsertArticles(authKey, {
    account: accountPayload,
    articles: feed.items.map(item => item.article),
    totalCount,
    completed: true,
  });

  await Promise.all(
    feed.items.map(item =>
      upsertHtmlCache(authKey, {
        fakeid,
        url: item.article.link,
        title: item.article.title,
        commentID: null,
        mimeType: 'text/html; charset=utf-8',
        content: Buffer.from(item.html, 'utf8'),
      })
    )
  );

  const account = await getAccountByFakeid(authKey, fakeid);
  if (!account) {
    throw new Error('订阅源写入失败');
  }

  return {
    account,
    inserted,
    totalCount,
    sourceUrl,
  };
}
