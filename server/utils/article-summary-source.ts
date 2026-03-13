import { load } from 'cheerio';
import TurndownService from 'turndown';
import { urlIsValidMpArticle } from '#shared/utils';
import { extractOriginalArticleUrl, normalizeHtml, validateHTMLContent } from '#shared/utils/html';
import { USER_AGENT } from '~/config';
import { upsertHtmlCache } from '~/server/repositories/cache';
import { normalizeArticleContent } from '~/server/utils/ai-summary';

interface ArticleSummarySourceArticle {
  fakeid?: string;
  link?: string;
  title?: string;
  digest?: string;
  cachedHtml?: string;
}

interface EnsureArticleSummarySourceOptions {
  preferredHtml?: string;
  preferredContent?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface EnsuredArticleSummarySource {
  html: string;
  content: string;
  source: 'preferred' | 'cache' | 'fetched' | 'unavailable';
  refreshed: boolean;
}

const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_FETCH_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1200;
const SUMMARY_BASE_URL = 'https://mp.weixin.qq.com/';
const SUMMARY_NOISE_SELECTORS = [
  '#js_tags_preview_toast',
  '#js_top_ad_area',
  '#content_bottom_area',
  '#js_pc_qr_code',
  '#wx_stream_article_slide_tip',
  '#js_read_area3',
  '#js_article_bottom_bar',
  '#js_preview_reward',
  '#js_related_articles',
  '#js_recommend_list',
  '.reward_area',
  '.reward_qrcode_area',
  '.qr_code_pc_outer',
  '.js_ad_link',
  '.js_product_loop_content',
  '.js_product_container',
  '.mp_profile_iframe_wrp',
  '.original_area_primary',
  '.original_primary_card',
  '.weui-desktop-pc-share',
  '.wx_profile_msg_inner',
  '.wx_profile_msg',
].join(',');
const INLINE_UNWRAP_TAGS = new Set(['span', 'font']);
const INLINE_CONTEXT_TAGS = new Set(['a', 'b', 'code', 'em', 'i', 'li', 'p', 'strong', 'td', 'th']);
const PRESERVE_EMPTY_TAGS = new Set([
  'br',
  'hr',
  'img',
  'video',
  'audio',
  'iframe',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'pre',
  'code',
]);
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^spm$/i,
  /^from$/i,
  /^isappinstalled$/i,
  /^scene$/i,
  /^subscene$/i,
  /^sessionid$/i,
  /^clicktime$/i,
  /^click_stream$/i,
  /^enterid$/i,
  /^share_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mkt_/i,
  /^mc_/i,
  /^track/i,
];
const USELESS_MEDIA_TEXT_PATTERNS = [
  /^图片$/i,
  /^图$/i,
  /^image$/i,
  /^photo$/i,
  /^微信图片$/i,
  /^二维码$/i,
  /^qr(?:code)?$/i,
  /^\.(?:png|jpe?g|gif|webp)$/i,
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(String(value || ''));
}

function normalizeComparableText(value?: string): string {
  return String(value || '')
    .replace(/[`*_#[\]()>|!-]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeInlineText(value?: string): string {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeCodeText(value?: string): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function escapeTableCell(value: string): string {
  return normalizeInlineText(value).replace(/\|/g, '\\|');
}

function collectUniqueTexts(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map(value => normalizeInlineText(value || ''))
        .filter(Boolean)
        .map(value => value.slice(0, 240))
    )
  );
}

function isUsefulMediaText(value: string): boolean {
  const normalized = normalizeInlineText(value);
  if (!normalized || normalized.length < 2) {
    return false;
  }

  return !USELESS_MEDIA_TEXT_PATTERNS.some(pattern => pattern.test(normalized));
}

function buildMediaDescription(label: string, values: Array<string | undefined | null>): string {
  const descriptions = collectUniqueTexts(values).filter(isUsefulMediaText);
  return descriptions.length > 0 ? `${label}：${descriptions.join('；')}` : label;
}

function sanitizeLinkUrl(rawUrl: string, baseUrl = SUMMARY_BASE_URL): string {
  const source = String(rawUrl || '').trim();
  if (!source || source === '#' || /^javascript:/i.test(source)) {
    return '';
  }
  if (/^(mailto:|tel:)/i.test(source)) {
    return source;
  }

  try {
    const parsed = new URL(source.replace(/^\/\//, 'https://'), baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return source;
    }

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM_PATTERNS.some(pattern => pattern.test(key))) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return source;
  }
}

function describeFigure($: any, $figure: any): string {
  const figcaptionText = normalizeInlineText($figure.find('figcaption').first().text());
  const imageTexts = $figure
    .find('img')
    .map((_: number, imageEl: any) => {
      const $image = $(imageEl);
      return collectUniqueTexts([
        $image.attr('alt'),
        $image.attr('title'),
        $image.attr('aria-label'),
        $image.attr('data-alt'),
      ]).find(isUsefulMediaText);
    })
    .get();

  const descriptions = collectUniqueTexts([figcaptionText, ...imageTexts]).filter(isUsefulMediaText);
  return descriptions.length > 0 ? `图片：${descriptions.join('；')}` : '';
}

function describeImage($: any, $image: any): string {
  const figureText = normalizeInlineText($image.closest('figure').find('figcaption').first().text());
  const descriptions = collectUniqueTexts([
    $image.attr('alt'),
    $image.attr('title'),
    $image.attr('aria-label'),
    $image.attr('data-alt'),
    figureText,
  ]).filter(isUsefulMediaText);

  return descriptions.length > 0 ? `图片：${descriptions.join('；')}` : '';
}

function describeMediaNode($element: any, label: string): string {
  return buildMediaDescription(label, [
    $element.attr('title'),
    $element.attr('aria-label'),
    $element.attr('data-title'),
    $element.attr('data-src'),
    $element.attr('src'),
  ]);
}

function replaceNodeWithTextBlock($: any, el: any, text: string): void {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    $(el).remove();
    return;
  }

  const parentTag = String(el?.parent?.tagName || '').toLowerCase();
  const tag = INLINE_CONTEXT_TAGS.has(parentTag) ? 'span' : 'p';
  const $replacement = $(`<${tag}></${tag}>`);
  $replacement.text(normalized);
  $(el).replaceWith($replacement);
}

function sanitizeSummaryDom($: any, $root: any, baseUrl: string): void {
  $root.find('script,noscript,style,meta,link,form,button,input,textarea,select,canvas,svg').remove();
  if (SUMMARY_NOISE_SELECTORS) {
    $root.find(SUMMARY_NOISE_SELECTORS).remove();
  }

  $root.find('figure').each((_: number, el: any) => {
    const description = describeFigure($, $(el));
    if (description) {
      replaceNodeWithTextBlock($, el, description);
      return;
    }

    const fallbackText = normalizeInlineText($(el).text());
    if (fallbackText) {
      replaceNodeWithTextBlock($, el, fallbackText);
      return;
    }

    $(el).remove();
  });

  $root.find('img').each((_: number, el: any) => {
    const description = describeImage($, $(el));
    if (description) {
      replaceNodeWithTextBlock($, el, description);
    } else {
      $(el).remove();
    }
  });

  $root.find('video').each((_: number, el: any) => {
    replaceNodeWithTextBlock($, el, describeMediaNode($(el), '视频'));
  });
  $root.find('audio').each((_: number, el: any) => {
    replaceNodeWithTextBlock($, el, describeMediaNode($(el), '音频'));
  });
  $root.find('iframe').each((_: number, el: any) => {
    replaceNodeWithTextBlock($, el, describeMediaNode($(el), '嵌入内容'));
  });

  $root.find('a').each((_: number, el: any) => {
    const $link = $(el);
    const href = sanitizeLinkUrl(
      $link.attr('href') || $link.attr('data-link') || $link.attr('data-url') || '',
      baseUrl
    );
    const text = normalizeInlineText($link.text());

    if (!href) {
      if (text) {
        $link.replaceWith(text);
      } else {
        $link.remove();
      }
      return;
    }

    $link.attr('href', href);
    if (!text) {
      $link.text(href);
    }
    $link.removeAttr('target');
    $link.removeAttr('rel');
  });

  $root.find('*').each((_: number, el: any) => {
    const tagName = String(el?.tagName || '').toLowerCase();
    if (INLINE_UNWRAP_TAGS.has(tagName)) {
      $(el).replaceWith($(el).contents());
    }
  });

  $root.find('*').each((_: number, el: any) => {
    const $element = $(el);
    const tagName = String(el?.tagName || '').toLowerCase();
    if (!tagName || PRESERVE_EMPTY_TAGS.has(tagName)) {
      return;
    }

    const text = normalizeInlineText($element.text());
    const hasStructuredContent = $element.find('table,pre,code,li,blockquote').length > 0;
    if (!text && !hasStructuredContent && $element.children().length === 0) {
      $element.remove();
    }
  });
}

function tableToMarkdown(node: any): string {
  const rows = Array.from(node?.querySelectorAll?.('tr') || []);
  if (rows.length === 0) {
    return '';
  }

  const matrix = rows
    .map((row: any) => {
      const cells = Array.from(row.querySelectorAll('th,td'));
      if (cells.length === 0) {
        return [];
      }

      return cells.flatMap((cell: any) => {
        const value = escapeTableCell(cell.textContent || '');
        const colspan = Math.max(1, Number.parseInt(cell.getAttribute?.('colspan') || '1', 10) || 1);
        return [value || ' ', ...Array.from({ length: colspan - 1 }, () => ' ')];
      });
    })
    .filter((row: string[]) => row.length > 0);

  if (matrix.length === 0) {
    return '';
  }

  const columnCount = Math.max(...matrix.map(row => row.length));
  const normalizedRows = matrix.map(row => {
    const next = row.slice(0, columnCount);
    while (next.length < columnCount) {
      next.push(' ');
    }
    return next;
  });

  const header = normalizedRows[0];
  const separator = header.map(() => '---');
  const body = normalizedRows.length > 1 ? normalizedRows.slice(1) : [];

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function createSummaryTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  service.addRule('summaryTable', {
    filter: 'table',
    replacement(_content, node) {
      const markdown = tableToMarkdown(node);
      return markdown ? `\n\n${markdown}\n\n` : '\n\n';
    },
  });

  service.addRule('summaryPre', {
    filter: 'pre',
    replacement(_content, node: any) {
      const text = normalizeCodeText(node?.textContent || '');
      if (!text) {
        return '\n\n';
      }

      const language =
        normalizeInlineText(node?.getAttribute?.('data-lang') || '')
        || normalizeInlineText(node?.getAttribute?.('language') || '')
        || normalizeInlineText(node?.querySelector?.('code')?.getAttribute?.('class') || '');
      const normalizedLanguage = language
        .replace(/language[-_:]?/i, '')
        .replace(/[^a-z0-9#+.-]/gi, '')
        .slice(0, 24);

      return `\n\n\`\`\`${normalizedLanguage}\n${text}\n\`\`\`\n\n`;
    },
  });

  service.addRule('summaryMedia', {
    filter: ['iframe', 'video', 'audio'],
    replacement(_content, node: any) {
      const tagName = String(node?.nodeName || '').toLowerCase();
      const label = tagName === 'video' ? '视频' : tagName === 'audio' ? '音频' : '嵌入内容';
      const text = buildMediaDescription(label, [
        node?.getAttribute?.('title'),
        node?.getAttribute?.('aria-label'),
        node?.getAttribute?.('data-title'),
        node?.getAttribute?.('data-src'),
        node?.getAttribute?.('src'),
      ]);

      return text ? `\n\n${text}\n\n` : '\n\n';
    },
  });

  return service;
}

function cleanupSummaryMarkdown(markdown: string): string {
  return String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\s*\]\(([^)]+)\)/g, '$1')
    .trim();
}

function extractSummaryMarkdownFromHtml(source: string): string {
  const normalizedHtml = normalizeHtml(source, 'html');
  const $ = load(normalizedHtml);
  const $root = $('#js_article').first().length > 0
    ? $('#js_article').first()
    : $('#js_content').first().length > 0
      ? $('#js_content').first()
      : $('body').first();

  if ($root.length === 0) {
    return '';
  }

  const baseUrl = sanitizeLinkUrl(
    $('meta[name="wechat-article-url"]').attr('content')
      || $('meta[property="og:url"]').attr('content')
      || $('link[rel="canonical"]').attr('href')
      || extractOriginalArticleUrl(source)
      || extractOriginalArticleUrl(normalizedHtml)
      || SUMMARY_BASE_URL,
    SUMMARY_BASE_URL
  ) || SUMMARY_BASE_URL;

  sanitizeSummaryDom($, $root, baseUrl);
  const cleanedHtml = $.html($root) || '';
  if (!cleanedHtml.trim()) {
    return '';
  }

  const markdown = createSummaryTurndownService().turndown(cleanedHtml);
  return cleanupSummaryMarkdown(markdown);
}

export function extractArticleSummaryContent(value?: string): string {
  const source = String(value || '').trim();
  if (!source) {
    return '';
  }

  try {
    if (looksLikeHtml(source)) {
      const markdown = extractSummaryMarkdownFromHtml(source);
      if (markdown) {
        return normalizeArticleContent(markdown);
      }

      return normalizeArticleContent(normalizeHtml(source, 'text'));
    }
  } catch {
    // Fall through to plain-text normalization below.
  }

  return normalizeArticleContent(source);
}

export function isArticleSummaryContentUsable(
  content?: string,
  options: {
    title?: string;
    digest?: string;
  } = {}
): boolean {
  const normalized = extractArticleSummaryContent(content);
  if (!normalized) {
    return false;
  }

  const comparableContent = normalizeComparableText(normalized);
  const comparableTitle = normalizeComparableText(options.title);
  const comparableDigest = normalizeComparableText(options.digest);

  if (
    comparableContent
    && (
      comparableContent === comparableTitle
      || comparableContent === comparableDigest
      || (comparableTitle && comparableContent.startsWith(comparableTitle) && comparableContent.length <= comparableTitle.length + 24)
      || (comparableDigest && comparableContent.startsWith(comparableDigest) && comparableContent.length <= comparableDigest.length + 24)
    )
  ) {
    return false;
  }

  const paragraphCount = normalized
    .split(/\n+/)
    .map(part => part.trim())
    .filter(Boolean)
    .length;
  const sentenceCount = (normalized.match(/[\u3002\uFF01\uFF1F!?;\uFF1B:\uFF1A]/g) || []).length;

  if (normalized.length >= 220) {
    return true;
  }
  if (normalized.length >= 120 && (paragraphCount >= 2 || sentenceCount >= 2)) {
    return true;
  }
  if (normalized.length >= 80 && (paragraphCount >= 3 || sentenceCount >= 3)) {
    return true;
  }
  if (normalized.length >= 60 && paragraphCount >= 1 && sentenceCount >= 1) {
    return true;
  }

  return false;
}

async function fetchNormalizedMpArticleHtml(
  url: string,
  timeoutMs: number
): Promise<{ html: string; content: string; commentID: string | null }> {
  const response = await fetch(url, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  });

  const rawHtml = await response.text();
  if (!response.ok) {
    throw new Error(`article fetch failed(${response.status})`);
  }

  const normalizedHtml = normalizeHtml(rawHtml, 'html');
  const content = extractArticleSummaryContent(normalizedHtml);
  const [status, commentID] = validateHTMLContent(rawHtml);

  return {
    html: normalizedHtml,
    content,
    commentID: status === 'Success' ? commentID : null,
  };
}

async function cacheFetchedArticleHtml(
  authKey: string,
  article: ArticleSummarySourceArticle,
  payload: { html: string; commentID: string | null }
): Promise<void> {
  const link = String(article.link || '').trim();
  if (!authKey || !link || !payload.html) {
    return;
  }

  await upsertHtmlCache(authKey, {
    fakeid: String(article.fakeid || '').trim(),
    url: link,
    title: String(article.title || '').trim(),
    commentID: payload.commentID,
    mimeType: 'text/html; charset=utf-8',
    content: Buffer.from(payload.html, 'utf8'),
  });
}

export async function ensureArticleSummarySource(
  authKey: string,
  article: ArticleSummarySourceArticle,
  options: EnsureArticleSummarySourceOptions = {}
): Promise<EnsuredArticleSummarySource> {
  const title = String(article.title || '').trim();
  const digest = String(article.digest || '').trim();
  const preferredContent = extractArticleSummaryContent(options.preferredContent);
  if (isArticleSummaryContentUsable(preferredContent, { title, digest })) {
    return {
      html: String(options.preferredHtml || '').trim(),
      content: preferredContent,
      source: 'preferred',
      refreshed: false,
    };
  }

  const preferredHtml = String(options.preferredHtml || '').trim();
  if (preferredHtml) {
    const contentFromPreferredHtml = extractArticleSummaryContent(preferredHtml);
    if (isArticleSummaryContentUsable(contentFromPreferredHtml, { title, digest })) {
      return {
        html: preferredHtml,
        content: contentFromPreferredHtml,
        source: 'preferred',
        refreshed: false,
      };
    }
  }

  const cachedHtml = String(article.cachedHtml || '').trim();
  const cachedContent = extractArticleSummaryContent(cachedHtml);
  if (isArticleSummaryContentUsable(cachedContent, { title, digest })) {
    return {
      html: cachedHtml,
      content: cachedContent,
      source: 'cache',
      refreshed: false,
    };
  }

  const link = String(article.link || '').trim();
  if (!link || !urlIsValidMpArticle(link)) {
    return {
      html: cachedHtml || preferredHtml,
      content: cachedContent || preferredContent,
      source: 'unavailable',
      refreshed: false,
    };
  }

  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_FETCH_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(Number(options.maxAttempts) || DEFAULT_FETCH_ATTEMPTS)));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || DEFAULT_RETRY_DELAY_MS);

  let lastFetchedHtml = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const fetched = await fetchNormalizedMpArticleHtml(link, timeoutMs);
      lastFetchedHtml = fetched.html;

      if (isArticleSummaryContentUsable(fetched.content, { title, digest })) {
        await cacheFetchedArticleHtml(authKey, article, fetched);
        return {
          html: fetched.html,
          content: fetched.content,
          source: 'fetched',
          refreshed: true,
        };
      }
    } catch (error) {
      if (attempt >= maxAttempts - 1) {
        console.warn('Article summary source fetch failed:', link, error);
      }
    }

    if (attempt < maxAttempts - 1 && retryDelayMs > 0) {
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  return {
    html: lastFetchedHtml || cachedHtml || preferredHtml,
    content: '',
    source: 'unavailable',
    refreshed: false,
  };
}
