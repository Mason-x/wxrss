import * as cheerio from 'cheerio';
import { extractAccountProfileFromHtml } from '#shared/utils/account-profile';
import { USER_AGENT } from '~/config';

interface AccountProfileQuery {
  url: string;
}

const ALLOWED_HOSTS = new Set(['mp.weixin.qq.com', 'weixin.qq.com']);

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    return ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeWeixinArticleUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('http://mp.weixin.qq.com/') || value.startsWith('http://weixin.qq.com/')) {
    return `https://${value.slice('http://'.length)}`;
  }
  return value;
}

export default defineEventHandler(async event => {
  let { url } = getQuery<AccountProfileQuery>(event);
  url = normalizeWeixinArticleUrl(decodeURIComponent(String(url || '')));

  if (!isAllowedUrl(url)) {
    throw createError({
      statusCode: 400,
      statusMessage: '不允许的 URL：仅支持微信公众平台域名',
    });
  }

  const res = await fetch(url, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    throw createError({
      statusCode: 502,
      statusMessage: `目标 URL 发生重定向 (status=${res.status})，已拒绝以防止 SSRF`,
    });
  }

  const rawHtml = await res.text();
  const extracted = extractAccountProfileFromHtml(rawHtml);
  if (!extracted.nickname) {
    const $ = cheerio.load(rawHtml);
    extracted.nickname = $('.wx_follow_nickname:first').text().trim();
  }

  return {
    nickname: extracted.nickname || '',
    round_head_img: extracted.round_head_img || '',
  };
});
