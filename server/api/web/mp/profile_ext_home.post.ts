import * as cheerio from 'cheerio';
import { extractAccountProfileFromHtml } from '#shared/utils/account-profile';
import { USER_AGENT } from '~/config';
import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';

interface ProfileHomeBody {
  id: string;
  uin: string;
  key: string;
  pass_ticket: string;
  url?: string;
}

function requiredText(value: unknown, name: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${name} is required`,
    });
  }
  return normalized;
}

function mergeProfile(
  base: { nickname: string; round_head_img: string },
  extra: { nickname: string; round_head_img: string }
) {
  return {
    nickname: base.nickname || extra.nickname || '',
    round_head_img: base.round_head_img || extra.round_head_img || '',
  };
}

function extractWithCheerio(html: string) {
  const $ = cheerio.load(html);
  return {
    nickname:
      $('#js_name').text().trim() ||
      $('#js_wx_follow_nickname').text().trim() ||
      $('.wx_follow_nickname:first').text().trim() ||
      $('.profile_nickname:first').text().trim(),
    round_head_img:
      $('#js_wx_follow_avatar').attr('src') ||
      $('.wx_follow_avatar_pic:first').attr('src') ||
      $('.profile_avatar:first').attr('src') ||
      '',
  };
}

function normalizeArticleUrl(rawUrl: string): string {
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
  if (!getAuthKeyFromRequest(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ProfileHomeBody>(event);
  const id = requiredText(body?.id, 'id');
  const uin = requiredText(body?.uin, 'uin');
  const key = requiredText(body?.key, 'key');
  const passTicket = requiredText(body?.pass_ticket, 'pass_ticket');
  const articleUrl = normalizeArticleUrl(String(body?.url || ''));

  let profile = { nickname: '', round_head_img: '' };

  try {
    const resp = await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/mp/profile_ext',
      query: {
        action: 'home',
        __biz: id,
        uin,
        key,
        pass_ticket: passTicket,
        scene: '124',
        devicetype: 'Windows-QQBrowser',
        version: 18000000,
        lang: 'zh_CN',
        wx_header: 1,
      },
      parseJson: false,
      allowDirect: true,
      cookie: '',
    });
    const html = await resp.text();
    profile = mergeProfile(extractAccountProfileFromHtml(html), extractWithCheerio(html));
  } catch (error) {
    console.error('profile_ext home failed:', String((error as Error)?.message || error));
  }

  if (!profile.nickname && articleUrl) {
    try {
      const target = new URL(articleUrl);
      target.searchParams.set('uin', uin);
      target.searchParams.set('key', key);
      target.searchParams.set('pass_ticket', passTicket);
      const html = await fetch(target.toString(), {
        headers: {
          Referer: 'https://mp.weixin.qq.com/',
          Origin: 'https://mp.weixin.qq.com',
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
      }).then(resp => resp.text());
      profile = mergeProfile(profile, mergeProfile(extractAccountProfileFromHtml(html), extractWithCheerio(html)));
    } catch (error) {
      console.error('credential article profile failed:', String((error as Error)?.message || error));
    }
  }

  return {
    nickname: profile.nickname || '',
    round_head_img: profile.round_head_img || '',
  };
});
