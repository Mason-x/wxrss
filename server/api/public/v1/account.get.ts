import { getTokenFromStore } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';

interface SearchBizQuery {
  begin?: number;
  size?: number;
  keyword: string;
}

export default defineEventHandler(async event => {
  const token = await getTokenFromStore(event);

  if (!token) {
    return {
      base_resp: {
        ret: -1,
        err_msg: '认证信息无效',
      },
    };
  }

  const query = getQuery<SearchBizQuery>(event);
  const keyword = String(query.keyword || '').trim();
  if (!keyword) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'keyword不能为空',
      },
    };
  }

  const begin = Number(query.begin ?? 0);
  if (!Number.isInteger(begin) || begin < 0) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'begin必须是大于等于0的整数',
      },
    };
  }

  const size = Number(query.size ?? 5);
  if (!Number.isInteger(size) || size < 0 || size > 20) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'size必须是0到20之间的整数',
      },
    };
  }

  const params: Record<string, string | number> = {
    action: 'search_biz',
    begin: begin,
    count: size,
    query: keyword,
    token: token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  };

  return proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/searchbiz',
    query: params,
    parseJson: true,
  }).catch(e => {
    return {
      base_resp: {
        ret: -1,
        err_msg: '搜索公众号接口失败，请稍后重试',
      },
    };
  });
});
