/**
 * Fetch an article page from the mobile WeChat profile endpoint.
 */

import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';

interface ProfileGetMsgBody {
  begin?: number;
  size?: number;
  id: string;
  uin: string;
  key: string;
  pass_ticket: string;
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

export default defineEventHandler(async event => {
  if (!getAuthKeyFromRequest(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  const body = await readBody<ProfileGetMsgBody>(event);
  const id = requiredText(body?.id, 'id');
  const uin = requiredText(body?.uin, 'uin');
  const key = requiredText(body?.key, 'key');
  const passTicket = requiredText(body?.pass_ticket, 'pass_ticket');
  const begin = Math.max(0, Math.floor(Number(body?.begin) || 0));
  const size = Math.min(10, Math.max(1, Math.floor(Number(body?.size) || 10)));

  const params: Record<string, string | number> = {
    action: 'getmsg',
    __biz: id,
    offset: begin,
    count: size,
    uin,
    key,
    pass_ticket: passTicket,
    f: 'json',
    is_ok: '1',
    scene: '124',
  };

  try {
    return await proxyMpRequest({
      event,
      method: 'GET',
      endpoint: 'https://mp.weixin.qq.com/mp/profile_ext',
      query: params,
      parseJson: true,
      allowDirect: true,
      cookie: '',
    });
  } catch (error) {
    console.error('profile_ext getmsg failed:', String((error as Error)?.message || error));
    return {
      ret: -1,
      errmsg: 'profile_ext request failed',
      can_msg_continue: 0,
      msg_count: 0,
      next_offset: begin,
      general_msg_list: '{"list":[]}',
    };
  }
});
