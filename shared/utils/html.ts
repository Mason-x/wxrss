import * as cheerio from 'cheerio';
import { extractCommentId } from '~/utils/comment';
import { EXTERNAL_API_SERVICE } from '~/config';

interface DynamicArticleFallback {
  title: string;
  paragraphs: string[];
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
    .replace(/\\'/g, '\'')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractMatchGroup(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  return match?.[1] || '';
}

function splitTextToTitleAndParagraphs(text: string): DynamicArticleFallback | null {
  const normalizedText = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
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
  const rawMsgTitle
    = extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*window\.title\s*=\s*'((?:\\.|[^'\\])*)'\s*\|\|\s*''\s*;/)
      || extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*window\.title\s*=\s*'([\s\S]*?)'\s*\|\|\s*''\s*;/);

  const rawWindowTitle
    = rawMsgTitle
      || extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*'((?:\\.|[^'\\])*)'\s*;/)
      || extractMatchGroup(rawHTML, /window\.msg_title\s*=\s*'([\s\S]*?)'\s*;/)
      || extractMatchGroup(rawHTML, /window\.title\s*=\s*'((?:\\.|[^'\\])*)'\s*;/)
      || extractMatchGroup(rawHTML, /window\.title\s*=\s*'([\s\S]*?)'\s*;/);

  if (!rawWindowTitle) return null;

  return splitTextToTitleAndParagraphs(decodeJsEscapedText(rawWindowTitle));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const paragraphHtml = paragraphs
    .filter(Boolean)
    .map(item => `<p>${escapeHtml(item)}</p>`)
    .join('\n');

  const contentHtml
    = paragraphHtml
      || '<p class="dynamic-fallback-tip">该文章为微信新版图文结构，暂未提取到完整正文，请点击右上角“查看原文”。</p>';

  return `<section id="js_article"><div id="js_content" class="article_dynamic_fallback">${contentHtml}</div></section>`;
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

  const hasNativeArticle = hasRenderableArticleContent($jsArticleContent);
  const fallback = hasNativeArticle ? null : parseDynamicArticleFallback(rawHTML);

  if (format === 'text') {
    if (hasNativeArticle) {
      return normalizeTextResult($jsArticleContent.text());
    }

    const fallbackText = [fallback?.title || '', ...(fallback?.paragraphs || [])].filter(Boolean).join('\n');
    return normalizeTextResult(fallbackText);
  } else if (format === 'html') {
    // 鑾峰彇淇敼鍚庣殑 HTML
    const bodyCls = $('body').attr('class');
    const pageContentHTML = hasNativeArticle
      ? $('<div>').append($jsArticleContent.clone()).html()
      : buildFallbackArticleHtml(fallback);

    return `<!DOCTYPE html>
  <html lang="zh_CN">
  <head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=0,viewport-fit=cover">
      <meta name="referrer" content="no-referrer">
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
          .article_dynamic_fallback .dynamic-fallback-title {
              font-size: 24px;
              line-height: 1.4;
              font-weight: 700;
              margin-bottom: 16px;
          }
          .article_dynamic_fallback p {
              margin: 0 0 12px 0;
              white-space: pre-wrap;
          }
          .article_dynamic_fallback .dynamic-fallback-tip {
              color: #64748b;
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
  const code = extractCgiScript(html);
  if (!code) {
    return Promise.resolve(null);
  }

  try {
    const data = await fetch(`${EXTERNAL_API_SERVICE}/api/tools/eval-js-code`, {
      method: 'POST',
      body: code,
    }).then(res => res.json());
    if (data && data.executionError === null) {
      return data.window.cgiDataNew;
    }
    return null;
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
  if (process.client && document) {
    return parseCgiDataNewOnClient(html);
  } else {
    return parseCgiDataNewOnServer(html);
  }
}



