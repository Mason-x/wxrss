import { getTokenFromStore } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCgiDataValue(html: string, keys: string[]): string {
  for (const key of keys) {
    const pattern = new RegExp(
      `(?:wx|window)\\.cgiData\\.${escapeRegExp(key)}\\s*=\\s*(['"])(?<value>[\\s\\S]*?)\\1`,
      'i'
    );
    const match = html.match(pattern);
    const value = match?.groups?.value;
    if (value) {
      return value
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
    }
  }
  return '';
}

function buildIdentityKey(info: { user_name?: string; biz_uin?: string; alias?: string }): string {
  if (info.user_name) {
    return `user_name:${info.user_name}`;
  }
  if (info.biz_uin) {
    return `biz_uin:${info.biz_uin}`;
  }
  if (info.alias) {
    return `alias:${info.alias}`;
  }
  return '';
}

export default defineEventHandler(async event => {
  const token = await getTokenFromStore(event);

  const html: string = await proxyMpRequest({
    event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/home',
    query: {
      t: 'home/index',
      token: token!,
      lang: 'zh_CN',
    },
  }).then(resp => resp.text());

  const nick_name = extractCgiDataValue(html, ['nick_name']);
  const head_img = extractCgiDataValue(html, ['head_img']);
  const user_name = extractCgiDataValue(html, ['user_name', 'user_name_new']);
  const biz_uin = extractCgiDataValue(html, ['bizuin', 'biz_uin']);
  const alias = extractCgiDataValue(html, ['alias', 'wx_alias']);
  const identity_key = buildIdentityKey({ user_name, biz_uin, alias });

  return {
    nick_name,
    head_img,
    user_name,
    biz_uin,
    alias,
    identity_key,
  };
});
