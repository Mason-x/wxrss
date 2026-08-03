import { parseProfileArticlePage } from '#shared/utils/profile-getmsg';
import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';
import type { ProfileGetMsgResponse } from '~/types/profile_getmsg';

interface ProfileArticleQuery {
  fakeid: string;
  begin?: number;
  size?: number;
  keyword?: string;
}

function errorResponse(message: string, ret = -1) {
  return {
    base_resp: {
      ret,
      err_msg: message,
    },
  };
}

export default defineEventHandler(async event => {
  if (!getAuthKeyFromRequest(event)) {
    return errorResponse('认证信息无效');
  }

  const query = getQuery<ProfileArticleQuery>(event);
  const fakeid = String(query.fakeid || '').trim();
  if (!fakeid) {
    return errorResponse('fakeid 不能为空');
  }
  if (String(query.keyword || '').trim()) {
    return errorResponse('Credential 抓取模式不支持微信端关键词搜索');
  }

  const begin = Number(query.begin ?? 0);
  if (!Number.isInteger(begin) || begin < 0) {
    return errorResponse('begin 必须是大于等于 0 的整数');
  }
  const size = Number(query.size ?? 5);
  if (!Number.isInteger(size) || size < 1 || size > 10) {
    return errorResponse('size 必须是 1 到 10 之间的整数');
  }

  const uin = String(getHeader(event, 'x-wechat-uin') || '').trim();
  const key = String(getHeader(event, 'x-wechat-key') || '').trim();
  const passTicket = String(getHeader(event, 'x-wechat-pass-ticket') || '').trim();
  if (!uin || !key || !passTicket) {
    return errorResponse('缺少 x-wechat-uin、x-wechat-key 或 x-wechat-pass-ticket 请求头');
  }

  try {
    const resp = (await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/mp/profile_ext',
      query: {
        action: 'getmsg',
        __biz: fakeid,
        offset: begin,
        count: size,
        uin,
        key,
        pass_ticket: passTicket,
        f: 'json',
        is_ok: '1',
        scene: '124',
      },
      parseJson: true,
      allowDirect: true,
      cookie: '',
    })) as ProfileGetMsgResponse;

    if (Number(resp.ret) !== 0) {
      return errorResponse(String(resp.errmsg || 'Credential 已失效'), Number(resp.ret) || -1);
    }

    const page = parseProfileArticlePage(resp, fakeid, begin);
    return {
      base_resp: {
        ret: 0,
        err_msg: String(resp.errmsg || 'ok'),
      },
      articles: page.articles,
      completed: page.completed,
      total_count: page.nextOffset,
      page_message_count: page.messageCount,
      next_offset: page.nextOffset,
    };
  } catch (error) {
    console.error('public profile_ext article request failed:', String((error as Error)?.message || error));
    return errorResponse('获取文章列表失败，请重试');
  }
});
