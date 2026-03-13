import * as cheerio from 'cheerio';
import { getAccountByFakeid, type ReaderAccount, upsertArticles } from '~/server/repositories/reader';
import { upsertHtmlCache } from '~/server/repositories/cache';
import { getStoredPreferencesByAuthKey } from '~/server/repositories/preferences';

const MAX_RSS_ITEMS = 200;
const RSS_HISTORY_STEP = 20;
const HTML_TAG_PATTERN = /<([a-z][\w:-]*)(\s[^>]*)?>/i;
const PUBLIC_RSSHUB_HOSTS = new Set(['rsshub.app']);
const RSS_HISTORY_STATE_PARAM = '__wxrss_history';
const RSS_HISTORY_LIMIT_PARAM = '__wxrss_limit';

interface SyncRssFeedInput {
  fakeid?: string;
  url?: string;
  history?: boolean;
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

interface RssMediaAttachment {
  kind: 'audio' | 'video';
  url: string;
  mimeType: string;
  duration: string;
}

type RssHistoryState = 'unknown' | 'exhausted';

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
  const configured = String(process.env.RSSHUB_BASE_URL || '').trim();
  if (!configured) {
    throw new Error('当前未配置 RSSHub 地址，请先在设置中填写可用的 RSSHub 服务地址');
  }
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

function getHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function parseRssHistoryMeta(value: string): { limit: number; state: RssHistoryState } {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return {
      limit: 0,
      state: 'unknown',
    };
  }

  try {
    const parsed = new URL(normalized);
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);
    const limit = Number(
      parsed.searchParams.get('limit')
      || hashParams.get(RSS_HISTORY_LIMIT_PARAM)
      || 0
    );
    return {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
      state: hashParams.get(RSS_HISTORY_STATE_PARAM) === 'exhausted' ? 'exhausted' : 'unknown',
    };
  } catch {
    return {
      limit: 0,
      state: 'unknown',
    };
  }
}

function updateRssHistoryMeta(
  value: string,
  options: {
    limit?: number;
    state?: RssHistoryState;
  } = {}
): string {
  const parsed = new URL(value);
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);

  const limit = Number(options.limit) || 0;
  if (limit > 0) {
    parsed.searchParams.set('limit', String(limit));
    hashParams.set(RSS_HISTORY_LIMIT_PARAM, String(limit));
  } else {
    parsed.searchParams.delete('limit');
    hashParams.delete(RSS_HISTORY_LIMIT_PARAM);
  }

  if (options.state === 'exhausted') {
    hashParams.set(RSS_HISTORY_STATE_PARAM, 'exhausted');
  } else {
    hashParams.delete(RSS_HISTORY_STATE_PARAM);
  }

  const nextHash = hashParams.toString();
  parsed.hash = nextHash ? `#${nextHash}` : '';
  return parsed.toString();
}

function buildNextRssHistorySourceUrl(sourceUrl: string, currentCount: number, currentLimit: number): string {
  const base = Math.max(Number(currentLimit) || 0, Number(currentCount) || 0, RSS_HISTORY_STEP);
  const nextLimit = Math.min(MAX_RSS_ITEMS, base + RSS_HISTORY_STEP);
  return updateRssHistoryMeta(sourceUrl, {
    limit: nextLimit,
    state: 'unknown',
  });
}

function isBlockedPublicRsshubResponse(sourceUrl: string, status: number, body: string): boolean {
  if (status !== 403) {
    return false;
  }

  const hostname = getHostname(sourceUrl);
  if (PUBLIC_RSSHUB_HOSTS.has(hostname)) {
    return true;
  }

  return /restrict access to rsshub\.app/i.test(body);
}

async function resolveConfiguredRsshubBaseUrl(authKey?: string): Promise<string> {
  const candidates = [String(process.env.RSSHUB_BASE_URL || '').trim()];

  if (authKey) {
    try {
      const stored = await getStoredPreferencesByAuthKey(authKey);
      candidates.unshift(String(stored.preferences.rsshubBaseUrl || '').trim());
    } catch {
      // Ignore preference lookup failures and fall back to env config.
    }
  }

  const configured = candidates.find(Boolean);
  if (!configured) {
    throw new Error('当前未配置 RSSHub 地址，请先在设置中填写可用的 RSSHub 服务地址');
  }

  return ensureHttpUrl(configured);
}

async function resolveRssSourceUrl(input: string, authKey?: string): Promise<string> {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new Error('RSS 地址不能为空');
  }

  if (!trimmed.startsWith('rsshub://')) {
    return ensureHttpUrl(trimmed);
  }

  const route = trimmed.slice('rsshub://'.length).trim();
  if (!route) {
    throw new Error('RSSHub 路由不能为空');
  }

  const baseUrl = new URL(await resolveConfiguredRsshubBaseUrl(authKey));
  const pathname = route.startsWith('/') ? route : `/${route}`;
  return new URL(pathname, baseUrl).toString();
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

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number.parseInt(num, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function decodeHtmlEntitiesDeep(value: string, maxDepth = 4): string {
  let current = String(value || '');
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = decodeHtmlEntities(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function decodeEmbeddedEncodedHtml(markup: string): string {
  let current = String(markup || '').trim();
  if (!current || !/&(?:amp;)*(lt|#60);/i.test(current)) {
    return current;
  }

  for (let depth = 0; depth < 4; depth += 1) {
    const next = decodeHtmlEntities(current).trim();
    if (next === current) {
      break;
    }
    current = next;
    if (!/&(?:amp;)*(lt|#60);/i.test(current)) {
      break;
    }
  }

  return current;
}

function buildParagraphHtml(text: string): string {
  const lines = String(text || '')
    .split(/\n{2,}/)
    .map(line => normalizeWhitespace(decodeHtmlEntitiesDeep(line)))
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

function isAudioMimeType(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('audio/');
}

function isVideoMimeType(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('video/');
}

function inferMediaKind(url: string, mimeType: string, medium = ''): 'audio' | 'video' | '' {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  const normalizedMedium = String(medium || '').trim().toLowerCase();
  const normalizedUrl = String(url || '').trim().toLowerCase();

  if (isAudioMimeType(normalizedMimeType) || normalizedMedium === 'audio') {
    return 'audio';
  }
  if (isVideoMimeType(normalizedMimeType) || normalizedMedium === 'video') {
    return 'video';
  }

  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(?:$|[?#])/i.test(normalizedUrl)) {
    return 'audio';
  }
  if (/\.(mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(normalizedUrl)) {
    return 'video';
  }

  return '';
}

function extractRssMediaAttachment($item: cheerio.Cheerio<any>, baseUrl: string): RssMediaAttachment | null {
  const duration = firstTextByLocalNames($item, ['duration']);
  const attachments: RssMediaAttachment[] = [];

  findByLocalName($item, 'enclosure').each((_, element) => {
    const url = resolveAbsoluteUrl(normalizeWhitespace(String(element.attribs?.url || '')), baseUrl);
    const mimeType = normalizeWhitespace(String(element.attribs?.type || ''));
    const kind = inferMediaKind(url, mimeType, String(element.attribs?.medium || ''));
    if (!url || !kind) {
      return;
    }

    attachments.push({
      kind,
      url,
      mimeType,
      duration,
    });
  });

  $item.find('link').each((_, element) => {
    const rel = normalizeWhitespace(String(element.attribs?.rel || '')).toLowerCase();
    if (rel !== 'enclosure') {
      return;
    }

    const url = resolveAbsoluteUrl(normalizeWhitespace(String(element.attribs?.href || '')), baseUrl);
    const mimeType = normalizeWhitespace(String(element.attribs?.type || ''));
    const kind = inferMediaKind(url, mimeType);
    if (!url || !kind) {
      return;
    }

    attachments.push({
      kind,
      url,
      mimeType,
      duration,
    });
  });

  $item.find('*').each((_, element) => {
    const tagName = String((element as any)?.tagName || (element as any)?.name || '').toLowerCase();
    if (!tagName.endsWith(':content')) {
      return;
    }

    const url = resolveAbsoluteUrl(normalizeWhitespace(String(element.attribs?.url || '')), baseUrl);
    const mimeType = normalizeWhitespace(String(element.attribs?.type || ''));
    const kind = inferMediaKind(url, mimeType, String(element.attribs?.medium || ''));
    if (!url || !kind) {
      return;
    }

    attachments.push({
      kind,
      url,
      mimeType,
      duration,
    });
  });

  return attachments.find(item => item.kind === 'audio') || attachments[0] || null;
}

function extractMediaAttachmentFromContentHtml(contentHtml: string, baseUrl: string): RssMediaAttachment | null {
  const html = String(contentHtml || '').trim();
  if (!html) {
    return null;
  }

  const $ = cheerio.load(html);
  const attachments: RssMediaAttachment[] = [];

  $('audio[src], video[src], source[src], a[href]').each((_, element) => {
    const tagName = String((element as any)?.tagName || (element as any)?.name || '').toLowerCase();
    const rawUrl = tagName === 'a'
      ? normalizeWhitespace(String(element.attribs?.href || ''))
      : normalizeWhitespace(String(element.attribs?.src || ''));
    const url = resolveAbsoluteUrl(rawUrl, baseUrl);
    const mimeType = normalizeWhitespace(String(element.attribs?.type || ''));
    const kind = inferMediaKind(url, mimeType);
    if (!url || !kind) {
      return;
    }

    attachments.push({
      kind,
      url,
      mimeType,
      duration: '',
    });
  });

  return attachments.find(item => item.kind === 'audio') || attachments[0] || null;
}

function buildRssMediaEmbedHtml(attachment: RssMediaAttachment, title: string, authorName: string): string {
  const metaParts = [authorName, attachment.duration].filter(Boolean);
  const metaHtml = metaParts.length > 0 ? `<p class="rss-media-card-meta">${escapeHtml(metaParts.join(' · '))}</p>` : '';

  if (attachment.kind === 'audio') {
    return `
      <section class="rss-media-card rss-audio-card">
        <div class="rss-media-card-header">
          <h2>${escapeHtml(title)}</h2>
          ${metaHtml}
        </div>
        <audio controls preload="metadata" src="${escapeHtml(attachment.url)}"></audio>
      </section>
    `.trim();
  }

  return `
    <section class="rss-media-card rss-video-card">
      <div class="rss-media-card-header">
        <h2>${escapeHtml(title)}</h2>
        ${metaHtml}
      </div>
      <video controls preload="metadata" src="${escapeHtml(attachment.url)}"></video>
    </section>
  `.trim();
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

  const decoded = decodeHtmlEntitiesDeep(trimmed).trim();
  const markup = looksLikeHtml(trimmed) ? trimmed : looksLikeHtml(decoded) ? decoded : '';

  if (markup) {
    const normalizedMarkup = decodeEmbeddedEncodedHtml(markup);
    if (/<html[\s>]/i.test(normalizedMarkup)) {
      const $ = cheerio.load(normalizedMarkup);
      const bodyHtml = String($('body').html() || '').trim();
      if (bodyHtml) {
        return decodeEmbeddedEncodedHtml(bodyHtml);
      }
    }
    return normalizedMarkup;
  }

  return buildParagraphHtml(decoded || trimmed);
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
    'audio{display:block;width:100%;max-width:100%!important;min-height:40px;margin:1rem 0;}',
    'a{color:#2563eb;text-decoration:none;}',
    '.rss-media-card{margin:0 0 1.25rem;padding:1rem 1rem 1.1rem;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;}',
    '.rss-media-card h2{margin:0;font-size:1rem;line-height:1.5;}',
    '.rss-media-card-meta{margin:.35rem 0 0;color:#64748b;font-size:.875rem;line-height:1.5;}',
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
  const atomLink = normalizeWhitespace(
    String(
      $item
        .find('link')
        .filter((_, element) => normalizeWhitespace(String(element.attribs?.rel || '')).toLowerCase() !== 'enclosure')
        .first()
        .attr('href') || ''
    )
  );
  const link = resolveAbsoluteUrl(atomLink || itemLinkText, feedUrl);
  const fallbackLink = link || `${feedUrl}#${hashString(`${title}:${itemLinkText}`)}`;
  const authorName =
    firstTextByLocalNames($item, ['creator', 'author', 'name']) || fallbackAuthor || 'RSS';

  const contentMarkup = extractMarkupByLocalNames($item, ['encoded', 'content', 'description', 'summary']);
  const normalizedHtml = normalizeBodyHtml(contentMarkup, firstTextByLocalNames($item, ['description', 'summary']));
  const mediaAttachment =
    extractRssMediaAttachment($item, fallbackLink)
    || extractMediaAttachmentFromContentHtml(normalizedHtml, fallbackLink);
  const contentHtml =
    mediaAttachment && !/<(?:audio|video)[\s>]/i.test(normalizedHtml)
      ? [buildRssMediaEmbedHtml(mediaAttachment, title, authorName), normalizedHtml].filter(Boolean).join('\n')
      : normalizedHtml;
  const digest = extractTextExcerpt(contentMarkup || contentHtml || title);
  const cover = extractCoverUrl(contentHtml, fallbackLink);
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
    media_duration: mediaAttachment?.duration || '',
    appmsg_album_infos: [],
    copyright_stat: 0,
    copyright_type: 0,
    is_deleted: false,
    _status: '',
  };

  return {
    article,
    html: buildRssHtmlDocument(contentHtml, fallbackLink),
  };
}

async function fetchAndParseRssFeed(sourceUrl: string): Promise<ParsedRssFeed> {
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 RSS Reader',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  const xml = await response.text();
  if (!response.ok) {
    if (isBlockedPublicRsshubResponse(sourceUrl, response.status, xml)) {
      throw new Error('当前默认 RSSHub 公共服务拒绝访问，请改用你自己的 RSSHub 地址');
    }
    throw new Error(`RSS 拉取失败(${response.status})`);
  }
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

  const storedSourceUrl = String(input.url || currentAccount?.source_url || '');
  const historyMeta = parseRssHistoryMeta(currentAccount?.source_url || storedSourceUrl);
  const resolvedSourceUrl = await resolveRssSourceUrl(storedSourceUrl, authKey);
  const sourceUrl = input.history
    ? buildNextRssHistorySourceUrl(
      resolvedSourceUrl,
      Number(currentAccount?.articles || currentAccount?.count || currentAccount?.total_count || 0),
      historyMeta.limit
    )
    : resolvedSourceUrl;
  const feed = await fetchAndParseRssFeed(sourceUrl);
  const fakeid = currentAccount?.fakeid || buildRssFakeid(sourceUrl);
  const totalCount = feed.items.length;
  const previousArticleCount = Number(currentAccount?.articles || 0);
  const lastUpdateTime = feed.items.reduce((latest, item) => {
    const candidate = Number(item?.article?.update_time || item?.article?.create_time || 0);
    return candidate > latest ? candidate : latest;
  }, 0);
  const accountPayload: Partial<ReaderAccount> & { fakeid: string } = {
    fakeid,
    nickname: feed.title || currentAccount?.nickname || sourceUrl,
    round_head_img: feed.image || currentAccount?.round_head_img || '',
    total_count: totalCount,
    completed: true,
    last_update_time: lastUpdateTime,
    source_type: 'rss',
    source_url: updateRssHistoryMeta(sourceUrl, {
      limit: parseRssHistoryMeta(sourceUrl).limit || totalCount,
      state: input.history && totalCount <= previousArticleCount ? 'exhausted' : 'unknown',
    }),
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
