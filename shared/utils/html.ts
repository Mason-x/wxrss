import * as cheerio from 'cheerio';
import { extractCommentId } from '~/utils/comment';

interface DynamicArticleFallback {
  title: string;
  paragraphs: string[];
  htmlContent?: string;
  coverUrl?: string;
  galleryImages?: DynamicGalleryImage[];
}

interface DynamicGalleryImage {
  url: string;
  width?: number;
  height?: number;
}

export interface EmbeddedVideoInfo {
  src?: string;
  poster?: string;
  videoId?: string;
}

function decodeJsEscapedText(value: string): string {
  if (!value) return '';

  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractMatchGroup(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  return match?.[1] || '';
}

function splitTextToTitleAndParagraphs(text: string): DynamicArticleFallback | null {
  const normalizedText = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!normalizedText) return null;

  const lines = normalizedText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  let title = lines[0];
  let paragraphs = lines.slice(1);

  // 某些新结构文章会把整篇正文塞到 title 变量里，这里拆成“标题 + 段落”
  if (paragraphs.length === 0 && title.length > 120) {
    const sentences = (title.match(/[^。！？!?]+[。！？!?]?/g) || []).map(item => item.trim()).filter(Boolean);
    if (sentences.length > 1) {
      title = sentences[0];
      paragraphs = sentences.slice(1);
    }
  }

  return {
    title,
    paragraphs,
  };
}

function parseDynamicArticleFallback(rawHTML: string): DynamicArticleFallback | null {
  const rawMsgTitle =
    extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*window\.title\s*=\s*'((?:\\.|[^'\\])*)'\s*\|\|\s*''\s*;/) ||
    extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*window\.title\s*=\s*'([\s\S]*?)'\s*\|\|\s*''\s*;/);

  const rawWindowTitle =
    rawMsgTitle ||
    extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*'((?:\\.|[^'\\])*)'\s*;/) ||
    extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*'([\s\S]*?)'\s*;/) ||
    extractMatchGroup(rawHTML, /window\.title\s*=\s*'((?:\\.|[^'\\])*)'\s*;/) ||
    extractMatchGroup(rawHTML, /window\.title\s*=\s*'([\s\S]*?)'\s*;/);

  if (!rawWindowTitle) return null;

  return splitTextToTitleAndParagraphs(decodeJsEscapedText(rawWindowTitle));
}

function extractJsDecodeField(rawHTML: string, fieldName: string): string {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    extractMatchGroup(rawHTML, new RegExp(`${escapedFieldName}\\s*:\\s*JsDecode\\('((?:\\\\.|[^'\\\\])*)'\\)`, 's')) ||
    extractMatchGroup(rawHTML, new RegExp(`${escapedFieldName}\\s*:\\s*JsDecode\\('([\\s\\S]*?)'\\)`, 's'))
  );
}

function normalizeMultilineText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

const DYNAMIC_FALLBACK_BLOCK_TAGS = new Set([
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

function fixBrokenAnchorMarkup(source: string): string {
  if (!source) {
    return '';
  }

  let next = source.replace(
    /&lt;a([\s\S]*?)&gt;([\s\S]*?)&lt;\/a&gt;/gi,
    (match, attrs, content) => {
      const fixedAttrs = attrs.replace(/href=(["'])([^"'\s>]+)\s+([a-zA-Z0-9_\-]+)=/i, 'href=$1$2$1 $3=');
      return `<a${fixedAttrs}>${content}</a>`;
    }
  );

  next = next.replace(
    /<a([^>]*?)>/gi,
    (match, attrs) => {
      const fixedAttrs = attrs.replace(/href=(["'])([^"'\s>]+)\s+([a-zA-Z0-9_\-]+)=/i, 'href=$1$2$1 $3=');
      return `<a${fixedAttrs}>`;
    }
  );

  return next;
}

function containsHtmlLikeMarkup(text: string): boolean {
  return /<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(text);
}

function normalizeDynamicFallbackAttrUrl(url: string): string {
  if (!url) {
    return '';
  }

  const normalized = normalizeMediaUrl(url);
  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }
  return normalized;
}

function sanitizeDynamicFallbackFragment($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): void {
  $root.find('script,noscript,style,meta,link').remove();

  $root.find('*').each((_, el) => {
    const $element = $(el);

    ['src', 'data-src', 'poster'].forEach(attr => {
      const value = ($element.attr(attr) || '').trim();
      if (!value) {
        return;
      }
      $element.attr(attr, normalizeDynamicFallbackAttrUrl(value));
    });

    if ($element.is('img')) {
      const src = ($element.attr('src') || $element.attr('data-src') || '').trim();
      if (src) {
        $element.attr('src', normalizeDynamicFallbackAttrUrl(src));
      }
      $element.attr('loading', 'lazy');
    }

    if ($element.is('a')) {
      const href = ($element.attr('href') || '').trim();
      if (href) {
        $element.attr('href', normalizeDynamicFallbackAttrUrl(href));
      }
      $element.attr('target', '_blank');
      $element.attr('rel', 'noopener noreferrer');
    }
  });
}

function buildDynamicFallbackBlockHtml(block: string): string {
  const normalizedBlock = block.replace(/\r\n?/g, '\n').trim();
  if (!normalizedBlock) {
    return '';
  }

  const fixedBlock = fixBrokenAnchorMarkup(normalizedBlock);
  const $ = cheerio.load(`<div id="__dynamic_fallback_root">${fixedBlock}</div>`, null, false);
  const $root = $('#__dynamic_fallback_root');
  sanitizeDynamicFallbackFragment($, $root);

  const html = ($root.html() || '').trim();
  if (!html) {
    return '';
  }

  const childNodes = $root.contents().toArray().filter(node => node.type !== 'text' || $(node).text().trim());
  const hasOnlyBlockChildren =
    childNodes.length > 0 &&
    childNodes.every(node => node.type === 'tag' && DYNAMIC_FALLBACK_BLOCK_TAGS.has((node as any).tagName || ''));

  return hasOnlyBlockChildren ? html : `<p>${html}</p>`;
}

function buildDynamicFallbackHtmlContent(content: string): string {
  const normalizedContent = content.replace(/\r\n?/g, '\n').trim();
  if (!normalizedContent) {
    return '';
  }

  const blocks = normalizedContent
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return '';
  }

  return blocks
    .map(block => {
      if (!containsHtmlLikeMarkup(block)) {
        return `<p>${escapeHtml(block)}</p>`;
      }
      return buildDynamicFallbackBlockHtml(block);
    })
    .filter(Boolean)
    .join('\n');
}

function extractTextFromHtmlFragment(fragmentHtml: string): string {
  if (!fragmentHtml) {
    return '';
  }

  const $ = cheerio.load(`<div id="__dynamic_fallback_text_root">${fragmentHtml}</div>`, null, false);
  const $root = $('#__dynamic_fallback_text_root');
  $root.find('br').replaceWith('\n');
  $root.find('p,div,section,article,figure,figcaption,blockquote,li,h1,h2,h3,h4,h5,h6').each((_, el) => {
    $(el).append('\n');
  });
  return normalizeMultilineText($root.text());
}

function parseCgiDataArticleFallback(rawHTML: string): DynamicArticleFallback | null {
  const rawTitle = extractJsDecodeField(rawHTML, 'title');
  const rawContent = extractJsDecodeField(rawHTML, 'content_noencode') || extractJsDecodeField(rawHTML, 'desc');
  const rawCoverUrl = extractJsDecodeField(rawHTML, 'cdn_url');

  const title = normalizeMultilineText(decodeJsEscapedText(rawTitle));
  const content = normalizeMultilineText(decodeJsEscapedText(rawContent));
  const htmlContent = containsHtmlLikeMarkup(content) ? buildDynamicFallbackHtmlContent(content) : '';
  const contentText = htmlContent ? extractTextFromHtmlFragment(htmlContent) : content;
  const coverUrl = normalizeMultilineText(decodeJsEscapedText(rawCoverUrl)).replace(/^http:\/\//, 'https://');

  if (!title && !contentText) {
    return null;
  }

  if (!title) {
    const fallback = splitTextToTitleAndParagraphs(contentText);
    if (!fallback) {
      return null;
    }
    return {
      ...fallback,
      htmlContent: htmlContent || undefined,
      coverUrl: coverUrl || undefined,
    };
  }

  const paragraphs = htmlContent
    ? []
    : content
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => line !== title);

  if (paragraphs.length === 0) {
    if (htmlContent) {
      return {
        title,
        paragraphs: [],
        htmlContent,
        coverUrl: coverUrl || undefined,
      };
    }

    const fallback = splitTextToTitleAndParagraphs(title);
    if (!fallback) {
      return null;
    }
    return {
      ...fallback,
      coverUrl: coverUrl || undefined,
    };
  }

  return {
    title,
    paragraphs,
    htmlContent: htmlContent || undefined,
    coverUrl: coverUrl || undefined,
  };
}

function extractDynamicArticleFallback(rawHTML: string): DynamicArticleFallback | null {
  return parseCgiDataArticleFallback(rawHTML) || parseDynamicArticleFallback(rawHTML);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeMediaUrl(url: string): string {
  return url
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/^http:\/\//, 'https://');
}

function decodeMaybeURIComponent(value: string): string {
  if (!value) return '';

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapViewSourceHtml(rawHTML: string): string {
  if (!rawHTML.includes('td class="line-content"') || !rawHTML.includes('line-gutter-backdrop')) {
    return rawHTML;
  }

  const $ = cheerio.load(rawHTML);
  const lines = $('td.line-content')
    .map((_, el) => $(el).text())
    .get();

  if (lines.length === 0) {
    return rawHTML;
  }

  const extracted = lines.join('\n').trim();
  if (!extracted.includes('<html') || !extracted.includes('<body')) {
    return rawHTML;
  }

  return extracted;
}

function normalizeMpArticleUrl(url: string): string {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url.replace(/^\/\//, 'https://'));
    if (parsed.hostname !== 'mp.weixin.qq.com') {
      return '';
    }

    parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractOriginalArticleUrl(rawHTML: string): string | null {
  const candidates = [
    extractMatchGroup(rawHTML, /var\s+msg_link\s*=\s*"([^"]+)"/),
    extractMatchGroup(rawHTML, /var\s+msg_link\s*=\s*'([^']+)'/),
    extractMatchGroup(rawHTML, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i),
    extractMatchGroup(rawHTML, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    extractMatchGroup(rawHTML, /(https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+)/),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeMpArticleUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function buildEmbeddedVideoHtml(video: EmbeddedVideoInfo, ratio = 0): string {
  const src = normalizeMediaUrl(video.src || '');
  const poster = normalizeMediaUrl(video.poster || '');
  const videoId = (video.videoId || '').trim();
  if (!src && !poster && !videoId) {
    return '';
  }

  const aspectRatioStyle = Number.isFinite(ratio) && ratio > 0 ? ` style="aspect-ratio:${ratio};"` : '';
  const srcAttr = src ? ` src="${escapeHtml(src)}"` : '';
  const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : '';
  const videoIdAttr = videoId ? ` data-mpvid="${escapeHtml(videoId)}"` : '';

  return `<div class="article_embedded_video"${aspectRatioStyle}><video${srcAttr}${posterAttr}${videoIdAttr} controls playsinline webkit-playsinline preload="metadata"></video></div>`;
}

function buildEmbeddedVideoIframeHtml(src: string, ratio = 16 / 9): string {
  const normalizedSrc = normalizeMediaUrl(src);
  if (!normalizedSrc) {
    return '';
  }

  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  return `<div class="article_embedded_video"${` style="aspect-ratio:${safeRatio};"`}><iframe src="${escapeHtml(normalizedSrc)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0" scrolling="no" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

export function extractEmbeddedVideoInfoMap(rawHTML: string): Map<string, EmbeddedVideoInfo> {
  const result = new Map<string, EmbeddedVideoInfo>();
  const videoPageInfosBody = extractMatchGroup(
    rawHTML,
    /var\s+videoPageInfos\s*=\s*\[([\s\S]*?)\];\s*window\.__videoPageInfos\s*=\s*videoPageInfos;/s
  );

  if (!videoPageInfosBody) {
    return result;
  }

  const entryPattern = /video_id:\s*'((?:\\.|[^'\\])*)'([\s\S]*?)(?=video_id:\s*'|$)/g;

  for (const match of videoPageInfosBody.matchAll(entryPattern)) {
    const videoId = decodeJsEscapedText(match[1]).trim();
    const entryBody = match[0];
    if (!videoId) {
      continue;
    }

    const cover = extractMatchGroup(entryBody, /cover_url:\s*'((?:\\.|[^'\\])*)'/s);
    const transInfo = extractMatchGroup(entryBody, /mp_video_trans_info:\s*\[([\s\S]*?)\]/s);
    const urls = [...transInfo.matchAll(/url:\s*(?:\('((?:\\.|[^'\\])*)'\)|'((?:\\.|[^'\\])*)')/g)]
      .map(urlMatch => decodeJsEscapedText(urlMatch[1] || urlMatch[2] || ''))
      .map(normalizeMediaUrl)
      .filter(Boolean);

    if (urls.length === 0) {
      continue;
    }

    result.set(videoId, {
      src: urls[0],
      poster: normalizeMediaUrl(decodeJsEscapedText(cover)),
      videoId,
    });
  }

  return result;
}

function extractStandaloneMpVideoInfo(rawHTML: string): EmbeddedVideoInfo | null {
  const transInfo = extractMatchGroup(rawHTML, /window\.__mpVideoTransInfo\s*=\s*\[([\s\S]*?)\];/s);
  if (!transInfo) {
    return null;
  }

  const urls = [...transInfo.matchAll(/url:\s*(?:\('((?:\\.|[^'\\])*)'\)|'((?:\\.|[^'\\])*)')/g)]
    .map(match => decodeJsEscapedText(match[1] || match[2] || ''))
    .map(normalizeMediaUrl)
    .filter(Boolean);

  if (urls.length === 0) {
    return null;
  }

  const cover = extractMatchGroup(rawHTML, /window\.__mpVideoCoverUrl\s*=\s*'((?:\\.|[^'\\])*)';/s);

  return {
    src: urls[urls.length - 1],
    poster: normalizeMediaUrl(decodeJsEscapedText(cover)),
  };
}

function extractPictureGalleryImages(rawHTML: string): DynamicGalleryImage[] {
  const images = new Map<string, DynamicGalleryImage>();
  const imagePattern =
    /cdn_url:\s*(?:JsDecode\('((?:\\.|[^'\\])*)'\)|'((?:\\.|[^'\\])*)')\s*,\s*width:\s*'(\d+)'\s*\*\s*1\s*,\s*height:\s*'(\d+)'\s*\*\s*1[\s\S]*?theme_color:\s*(?:JsDecode\('((?:\\.|[^'\\])*)'\)|'((?:\\.|[^'\\])*)')[\s\S]*?is_qr_code:\s*'(\d+)'\s*\*\s*1/gs;

  for (const match of rawHTML.matchAll(imagePattern)) {
    const url = normalizeMediaUrl(decodeJsEscapedText(match[1] || match[2] || ''));
    if (!url) {
      continue;
    }

    images.set(url, {
      url,
      width: Number.parseInt(match[3], 10) || undefined,
      height: Number.parseInt(match[4], 10) || undefined,
    });
  }

  return [...images.values()];
}

function isPictureShareShell($jsArticleContent: cheerio.Cheerio<any>): boolean {
  return (
    $jsArticleContent.hasClass('share_content_page') ||
    $jsArticleContent.find('#js_share_content_page_hd, #img_swiper, #img_list, .img_swiper_area').length > 0
  );
}

function mergeFallbackWithGallery(
  fallback: DynamicArticleFallback | null,
  galleryImages: DynamicGalleryImage[]
): DynamicArticleFallback | null {
  if (galleryImages.length === 0) {
    return fallback;
  }

  return {
    title: fallback?.title || '',
    paragraphs: fallback?.paragraphs || [],
    coverUrl: undefined,
    galleryImages,
  };
}

function simplifyEmbeddedVideos($: cheerio.CheerioAPI, $jsArticleContent: cheerio.Cheerio<any>, rawHTML: string): void {
  const processed = new Set<any>();
  const embeddedVideoInfos = extractEmbeddedVideoInfoMap(rawHTML);
  const standaloneMpVideo = extractStandaloneMpVideoInfo(rawHTML);

  $jsArticleContent.find('.video_iframe, [id^="js_mp_video_container_"], .js_mpvedio').each((_, el) => {
    if (processed.has(el)) {
      return;
    }

    const $container = $(el);
    const $video = $container.find('video[src]').first();
    const rawSrc = $video.attr('src') || '';
    const mpVideoId = $container.attr('data-mpvid') || $container.find('[data-mpvid]').first().attr('data-mpvid') || '';
    const iframeDataSrc = normalizeMediaUrl($container.attr('data-src') || '');
    const iframeRatio = Number.parseFloat($container.attr('data-ratio') || '') || 16 / 9;
    const isMpVideoContainer =
      Boolean(mpVideoId) ||
      iframeDataSrc.includes('mp.weixin.qq.com/mp/readtemplate') ||
      $container.attr('id')?.startsWith('js_mp_video_container_');

    const directVideoInfo = rawSrc
      ? {
          src: rawSrc,
          poster: $video.attr('poster') || decodeMaybeURIComponent($container.attr('data-cover') || ''),
          videoId: mpVideoId || undefined,
        }
      : null;

    const resolvedVideoInfo = directVideoInfo || embeddedVideoInfos.get(mpVideoId) || standaloneMpVideo;

    if (isMpVideoContainer || resolvedVideoInfo?.src) {
      const width = Number.parseFloat(
        $container.attr('data-vw') ||
          $container.attr('width') ||
          $video.attr('width') ||
          $container.attr('data-w') ||
          ''
      );
      const height = Number.parseFloat(
        $container.attr('data-vh') ||
          $container.attr('height') ||
          $video.attr('height') ||
          $container.attr('data-h') ||
          ''
      );
      const ratio =
        Number.parseFloat($container.attr('data-ratio') || $video.attr('data-ratio') || '') ||
        (Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 0);
      const videoHtml = buildEmbeddedVideoHtml(
        {
          src: resolvedVideoInfo?.src,
          poster:
            resolvedVideoInfo?.poster ||
            $video.attr('poster') ||
            decodeMaybeURIComponent($container.attr('data-cover') || ''),
          videoId: mpVideoId || resolvedVideoInfo?.videoId,
        },
        ratio
      );

      if (videoHtml) {
        $container.replaceWith(videoHtml);
      }
      processed.add(el);
      return;
    }

    const qqVideoMatch = iframeDataSrc.match(/v\.qq\.com\/iframe\/preview\.html\?vid=([\da-z]+)/i);
    if (qqVideoMatch?.[1]) {
      const iframeHtml = buildEmbeddedVideoIframeHtml(
        `https://v.qq.com/txp/iframe/player.html?vid=${escapeHtml(qqVideoMatch[1])}`,
        iframeRatio
      );
      if (iframeHtml) {
        $container.replaceWith(iframeHtml);
      }
    }
    processed.add(el);
  });
}

function hasRenderableArticleContent($jsArticleContent: cheerio.Cheerio<any>): boolean {
  if ($jsArticleContent.length === 0) {
    return false;
  }

  const pureText = $jsArticleContent.text().replace(/\s+/g, '').trim();
  if (pureText.length > 0) {
    return true;
  }

  const mediaCount = $jsArticleContent.find('img,video,audio,iframe,p,section,mp-common-article').length;
  return mediaCount > 0;
}

function buildFallbackArticleHtml(fallback: DynamicArticleFallback | null): string {
  const paragraphs = fallback?.paragraphs || [];
  const richBodyHtml = (fallback?.htmlContent || '').trim();
  const galleryImages = fallback?.galleryImages || [];
  const hasGallery = galleryImages.length > 0;
  const titleHtml = fallback?.title ? `<h1 class="dynamic-fallback-title">${escapeHtml(fallback.title)}</h1>` : '';
  const coverHtml =
    !hasGallery && fallback?.coverUrl
      ? `<p class="dynamic-fallback-cover"><img src="${escapeHtml(fallback.coverUrl)}" alt=""></p>`
      : '';

  const paragraphHtml = paragraphs
    .filter(Boolean)
    .map(item => `<p>${escapeHtml(item)}</p>`)
    .join('\n');
  const galleryHtml = hasGallery
    ? `<section class="dynamic-fallback-gallery-shell">
        <div class="dynamic-fallback-gallery-track" aria-label="图片图集，可左右滑动切换" tabindex="0">${galleryImages
          .map(image => {
            return `<figure class="dynamic-fallback-gallery-slide"><img src="${escapeHtml(image.url)}" alt="" loading="lazy"></figure>`;
          })
          .join('\n')}</div>
        ${
          galleryImages.length > 1
            ? `<div class="dynamic-fallback-gallery-indicators" aria-hidden="true">${galleryImages
                .map((_, index) => `<button type="button" class="dynamic-fallback-gallery-dot${index === 0 ? ' is-active' : ''}" data-gallery-dot="${index}" tabindex="-1"></button>`)
                .join('')}</div>`
            : ''
        }
      </section>`
    : '';

  const bodyContentHtml = richBodyHtml || paragraphHtml;
  const articleBodyHtml = hasGallery
    ? [titleHtml, bodyContentHtml].filter(Boolean).join('\n')
    : [titleHtml, coverHtml, bodyContentHtml].filter(Boolean).join('\n');
  const bodyHtml = articleBodyHtml ? `<div class="dynamic-fallback-body">${articleBodyHtml}</div>` : '';
  const contentHtml =
    [galleryHtml, bodyHtml].filter(Boolean).join('\n') ||
    '<div class="dynamic-fallback-body"><p class="dynamic-fallback-tip">该文章为微信新版图文结构，暂未提取到完整正文，请点击右上角“查看原文”。</p></div>';

  return `<section id="js_article"><div id="js_content" class="article_dynamic_fallback${hasGallery ? ' article_dynamic_fallback--gallery' : ''}">${contentHtml}</div></section>`;
}

function normalizeTextResult(text: string): string {
  const lines = text
    .trim()
    .replace(/\n+/g, '\n')
    .replace(/ +/g, ' ')
    .split('\n')
    .filter(line => !/^\s*$/.test(line));
  return lines.join('\n');
}

/**
 * 澶勭悊鏂囩珷鐨?html 鍐呭
 * @description 閲囩敤 cheerio 搴撹В鏋愬苟淇敼 html 鍐呭
 * @param rawHTML 鍏紬鍙锋枃绔犵殑鍘熷 html
 * @param format 瑕佸鐞嗙殑鏍煎紡(榛樿html)
 * @remarks 鏈嶅姟绔伐鍏峰嚱鏁?
 */
export function normalizeHtml(rawHTML: string, format: 'html' | 'text' = 'html'): string {
  rawHTML = unwrapViewSourceHtml(rawHTML);

  rawHTML = fixBrokenAnchorMarkup(rawHTML);

  const originalArticleUrl = extractOriginalArticleUrl(rawHTML);

  const $ = cheerio.load(rawHTML);
  const $jsArticleContent = $('#js_article');

  // #js_content 榛樿鏄笉鍙鐨?閫氳繃js淇敼涓哄彲瑙?锛岄渶瑕佺Щ闄よ鏍峰紡
  $jsArticleContent.find('#js_content').removeAttr('style');

  // 鍒犻櫎鏃犵敤dom鍏冪礌
  $jsArticleContent.find('#js_top_ad_area').remove();
  $jsArticleContent.find('#js_tags_preview_toast').remove();
  $jsArticleContent.find('#content_bottom_area').remove();

  // 鍒犻櫎鎵€鏈?script 鏍囩锛堝湪 #js_article 涓婁笅鏂囦腑锛?
  $jsArticleContent.find('script').remove();

  $jsArticleContent.find('#js_pc_qr_code').remove();
  $jsArticleContent.find('#wx_stream_article_slide_tip').remove();

  // 澶勭悊鍥剧墖鎳掑姞杞斤紙鍏ㄥ眬澶勭悊鎵€鏈?img锛?
  $('img').each((i, el) => {
    const $img = $(el);
    const imgUrl = $img.attr('src') || $img.attr('data-src');
    if (imgUrl) {
      $img.attr('src', imgUrl);
    }
  });

  simplifyEmbeddedVideos($, $jsArticleContent, rawHTML);

  const galleryImages = extractPictureGalleryImages(rawHTML);
  const hasStaticPictureGallery = galleryImages.length > 0 && isPictureShareShell($jsArticleContent);
  const hasNativeArticle = !hasStaticPictureGallery && hasRenderableArticleContent($jsArticleContent);
  const fallback = hasNativeArticle
    ? null
    : mergeFallbackWithGallery(extractDynamicArticleFallback(rawHTML), galleryImages);

  if (format === 'text') {
    if (hasNativeArticle) {
      return normalizeTextResult($jsArticleContent.text());
    }

    const fallbackBodyText = fallback?.htmlContent
      ? extractTextFromHtmlFragment(fallback.htmlContent)
      : (fallback?.paragraphs || []).join('\n');
    const fallbackText = [fallback?.title || '', fallbackBodyText].filter(Boolean).join('\n');
    return normalizeTextResult(fallbackText);
  } else if (format === 'html') {
    // 鑾峰彇淇敼鍚庣殑 HTML
    const bodyCls = $('body').attr('class');
    const pageContentHTML = hasNativeArticle
      ? $('<div>').append($jsArticleContent.clone()).html()
      : buildFallbackArticleHtml(fallback);
    const originalArticleUrlMeta = originalArticleUrl
      ? `<meta name="wechat-article-url" content="${escapeHtml(originalArticleUrl)}">`
      : '';

    return `<!DOCTYPE html>
  <html lang="zh_CN">
  <head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=0,viewport-fit=cover">
      <meta name="referrer" content="no-referrer">
      ${originalArticleUrlMeta}
      <style>
          #js_row_immersive_stream_wrap {
              max-width: 667px;
              margin: 0 auto;
          }
          #js_row_immersive_stream_wrap .wx_follow_avatar_pic {
            display: block;
            margin: 0 auto;
          }
          #page-content,
          #js_article_bottom_bar,
          .__page_content__ {
              max-width: 667px;
              margin: 0 auto;
          }
          img {
              max-width: 100%;
          }
          .sns_opr_btn::before {
              width: 16px;
              height: 16px;
              margin-right: 3px;
          }
          .article_dynamic_fallback {
              max-width: 667px;
              margin: 0 auto;
              padding: 24px 16px;
              line-height: 1.9;
              font-size: 16px;
              color: #111827;
          }
          .article_dynamic_fallback--gallery {
              padding: 0 0 24px 0;
          }
          .article_dynamic_fallback .dynamic-fallback-body {
              padding: 0;
          }
          .article_dynamic_fallback--gallery .dynamic-fallback-body {
              padding: 0 16px;
          }
          .article_dynamic_fallback .dynamic-fallback-title {
              font-size: 24px;
              line-height: 1.4;
              font-weight: 700;
              margin-bottom: 16px;
          }
          .article_dynamic_fallback .dynamic-fallback-cover {
              margin: 0 0 16px 0;
          }
          .article_dynamic_fallback .dynamic-fallback-cover img {
              display: block;
              width: 100%;
              border-radius: 12px;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-shell {
              position: relative;
              margin: 0 0 20px 0;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-track {
              display: grid;
              grid-auto-flow: column;
              grid-auto-columns: 100%;
              overflow-x: auto;
              overscroll-behavior-x: contain;
              scroll-snap-type: x mandatory;
              -webkit-overflow-scrolling: touch;
              scrollbar-width: none;
              cursor: grab;
              outline: none;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-track::-webkit-scrollbar {
              display: none;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-track.is-dragging {
              cursor: grabbing;
              scroll-snap-type: none;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-slide {
              margin: 0;
              background: #f8fafc;
              scroll-snap-align: start;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-slide img {
              display: block;
              width: 100%;
              height: auto;
              pointer-events: none;
              user-select: none;
              -webkit-user-drag: none;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-indicators {
              position: absolute;
              left: 50%;
              bottom: 18px;
              transform: translateX(-50%);
              display: flex;
              align-items: center;
              gap: 10px;
              margin: 0;
              padding: 10px 14px;
              border-radius: 999px;
              background: rgba(15, 23, 42, 0.58);
              backdrop-filter: blur(8px);
              -webkit-backdrop-filter: blur(8px);
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-dot {
              width: 24px;
              height: 6px;
              padding: 0;
              border: 0;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.35);
              transition: width 0.2s ease, background-color 0.2s ease, opacity 0.2s ease;
              opacity: 1;
              cursor: pointer;
              appearance: none;
          }
          .article_dynamic_fallback .dynamic-fallback-gallery-dot.is-active {
              width: 42px;
              background: rgba(255, 255, 255, 0.96);
          }
          .article_dynamic_fallback p {
              margin: 0 0 12px 0;
              white-space: pre-wrap;
          }
          .article_dynamic_fallback .dynamic-fallback-body a {
              color: #2563eb;
              text-decoration: underline;
              text-underline-offset: 2px;
              word-break: break-word;
          }
          .article_dynamic_fallback .dynamic-fallback-body img {
              display: block;
              max-width: 100%;
              height: auto;
              margin: 16px auto;
              border-radius: 12px;
          }
          .article_dynamic_fallback .dynamic-fallback-body figure {
              margin: 16px 0;
          }
          .article_dynamic_fallback .dynamic-fallback-body figure img {
              margin: 0;
          }
          .article_dynamic_fallback .dynamic-fallback-tip {
              color: #64748b;
          }
          .article_embedded_video {
              max-width: 667px;
              margin: 16px auto;
              background: #000;
              border-radius: 12px;
              overflow: hidden;
          }
          .article_embedded_video video {
              display: block;
              width: 100%;
              height: 100%;
              max-height: 80vh;
              background: #000;
          }
          .article_embedded_video iframe {
              display: block;
              width: 100%;
              height: 100%;
              border: 0;
              background: #000;
          }
      </style>
  </head>
  <body class="${bodyCls}">
  ${pageContentHTML}
  </body>
  </html>
    `;
  } else {
    throw new Error(`format not supported: ${format}`);
  }
}

/**
 * 楠岃瘉鏂囩珷鐨?html 鍐呭鏄惁涓嬭浇鎴愬姛锛屼互鍙婃彁鍙栧嚭 commentID
 * @param html
 * @return [鐘舵€侊紝commentID/msg] 浜屽厓缁?
 */
export function validateHTMLContent(html: string): ['Success' | 'Deleted' | 'Exception' | 'Error', string | null] {
  html = unwrapViewSourceHtml(html);

  const $ = cheerio.load(html);
  const $jsArticle = $('#js_article');
  const $weuiMsg = $('.weui-msg');
  const $msgBlock = $('.mesg-block');

  if ($jsArticle.length === 1) {
    // 鎴愬姛
    const commentID = extractCommentId(html);
    return ['Success', commentID];
  } else if ($weuiMsg.length === 1) {
    // 澶辫触锛岄渶瑕佽繘涓€姝ュ垽鏂け璐ョ被鍨?
    const msg = $('.weui-msg .weui-msg__title').text().trim().replace(/\n+/g, '').replace(/ +/g, ' ');
    if (msg && ['The content has been deleted by the author.', '该内容已被发布者删除'].includes(msg)) {
      return ['Deleted', null];
    } else {
      return ['Exception', msg];
    }
  } else if ($msgBlock.length === 1) {
    const msg = $msgBlock.text().trim().replace(/\n+/g, '').replace(/ +/g, ' ');
    return ['Exception', msg];
  } else {
    return ['Error', null];
  }
}

// 璇嗗埆鏂囩珷鐨勭被鍨?
function detectArticleType(html: string) {}

/**
 * 鎻愬彇 window.cgiDataNew 鎵€鍦ㄨ剼鏈殑浠ｇ爜
 * @param html 鏂囩珷鐨勫畬鏁?html 鍐呭
 * @return 鑴氭湰浠ｇ爜 (绾唬鐮侊紝涓嶅惈 <script> 鏍囩)
 * @remarks 鍐呴儴浣跨敤 cheerio 搴撹繘琛岃В鏋愶紝鍙繍琛屽湪娴忚鍣ㄧ鍜屾湇鍔″櫒绔€?
 */
function extractCgiScript(html: string) {
  const $ = cheerio.load(html);

  const scriptEl = $('script[type="text/javascript"][h5only]').filter((i, el) => {
    const content = $(el).html() || '';
    return content.includes('window.cgiDataNew = ');
  });

  if (scriptEl.length !== 1) {
    console.warn('鏈壘鍒板寘鍚?cgiDataNew 鐨勭洰鏍?script');
    return null;
  }

  return scriptEl.html()?.trim() || null;
}

/**
 * 浠?html 涓彁鍙?cgiDataNew 瀵硅薄
 * @param html 鏂囩珷鐨勫畬鏁?html 鍐呭
 * @return window.cgiDataNew 瀵硅薄锛岃В鏋愬け璐ユ椂杩斿洖 null
 */
function parseCgiDataNewOnClient(html: string): Promise<any> {
  const code = extractCgiScript(html);
  if (!code) {
    return Promise.resolve(null);
  }

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.srcdoc = `<script type="text/javascript">${code}</script>`;
  document.body.appendChild(iframe);

  return new Promise((resolve, reject) => {
    iframe.onload = function () {
      // @ts-ignore
      const data = iframe.contentWindow.cgiDataNew;

      // 鐢ㄥ畬鍚庢竻鐞?
      document.body.removeChild(iframe);
      resolve(data);
    };
    iframe.onerror = function (e) {
      reject(e);
    };
  });
}

/**
 * 浠?html 涓彁鍙?cgiDataNew 瀵硅薄
 * @deprecated Cloudflare 骞冲彴绂佹浠讳綍鍔ㄦ€佹墽琛岃剼鏈紝鏁呮湰鏂规硶鍦?CF 骞冲彴鏃犳晥
 * @param html 鏂囩珷鐨勫畬鏁?html 鍐呭
 * @return window.cgiDataNew 瀵硅薄锛岃В鏋愬け璐ユ椂杩斿洖 null
 */
function parseCgiDataNewOnServerDeprecated(html: string): Promise<any> {
  const code = extractCgiScript(html);
  if (!code) {
    return Promise.resolve(null);
  }

  // 1. 鍒涘缓娌欑
  const sandbox: any = {
    window: {},
    console: { log: () => {}, error: () => {} }, // 鍙€夛細灞忚斀 console
    // 濡傛灉鑴氭湰渚濊禆鍏朵粬鍏ㄥ眬锛屽彲鍦ㄨ繖閲?mock锛堝 Date, Math 绛夊凡瀛樺湪锛?
  };
  sandbox.window = sandbox; // 鍏抽敭锛氳 window.xxx 钀藉叆娌欑

  // 2. 鎵ц浠ｇ爜锛坣ew Function 姣?eval 绋嶅畨鍏級
  const func = new Function('window', code);
  func(sandbox.window);

  return sandbox.cgiDataNew || sandbox.window?.cgiDataNew;
}

/**
 * 浠?html 涓彁鍙?cgiDataNew 瀵硅薄
 * @param html 鏂囩珷鐨勫畬鏁?html 鍐呭
 * @return window.cgiDataNew 瀵硅薄锛岃В鏋愬け璐ユ椂杩斿洖 null
 */
async function parseCgiDataNewOnServer(html: string): Promise<any> {
  try {
    return await parseCgiDataNewOnServerDeprecated(html);
  } catch (error) {
    console.error(error);
  }
  return null;
}

/**
 * 浠?html 涓彁鍙?cgiDataNew 瀵硅薄
 * @param html 鏂囩珷鐨勫畬鏁?html 鍐呭
 * @return window.cgiDataNew 瀵硅薄锛岃В鏋愬け璐ユ椂杩斿洖 null
 */
export async function parseCgiDataNew(html: string): Promise<any> {
  html = unwrapViewSourceHtml(html);

  if (process.client && document) {
    return parseCgiDataNewOnClient(html);
  } else {
    return parseCgiDataNewOnServer(html);
  }
}
