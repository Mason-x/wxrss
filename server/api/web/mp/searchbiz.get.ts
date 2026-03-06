/**
 * 搜索公众号接口
 */

import { getTokenFromStore } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';

interface SearchBizQuery {
  begin?: number;
  size?: number;
  keyword: string;
}

export default defineEventHandler(async event => {
  try {
    const token = await getTokenFromStore(event);
    if (!token) {
      return {
        base_resp: {
          ret: 200003,
          err_msg: 'session expired',
        },
      };
    }

    const query = getQuery<SearchBizQuery>(event);
    const keyword = String(query.keyword || '').trim();
    if (!keyword) {
      return {
        base_resp: {
          ret: -1,
          err_msg: 'keyword is required',
        },
      };
    }

    const begin = Number(query.begin) || 0;
    const size = Number(query.size) || 5;

    const params: Record<string, string | number> = {
      action: 'search_biz',
      begin,
      count: size,
      query: keyword,
      token,
      lang: 'zh_CN',
      f: 'json',
      ajax: '1',
    };

    return await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/cgi-bin/searchbiz',
      query: params,
      parseJson: true,
      timeoutMs: 25000,
    });
  } catch (error: any) {
    console.error('[searchbiz] failed:', error?.message || error);
    return {
      base_resp: {
        ret: -1,
        err_msg: `searchbiz request failed: ${error?.message || 'unknown error'}`,
      },
    };
  }
});
