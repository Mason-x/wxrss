import { getTokenFromStore } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';

interface AppMsgPublishQuery {
  fakeid: string;
  begin?: number;
  size?: number;
  keyword?: string;
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

  const query = getQuery<AppMsgPublishQuery>(event);
  const fakeid = String(query.fakeid || '').trim();
  if (!fakeid) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'fakeid不能为空',
      },
    };
  }

  const keyword = String(query.keyword || '').trim();
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

  const isSearching = !!keyword;

  const params: Record<string, string | number> = {
    sub: isSearching ? 'search' : 'list',
    search_field: isSearching ? '7' : 'null',
    begin: begin,
    count: size,
    query: keyword,
    fakeid: fakeid,
    type: '101_1',
    free_publish_type: 1,
    sub_action: 'list_ex',
    token: token,
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
  };

  const resp = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish',
    query: params,
    parseJson: true,
  }).catch(e => {
    return {
      base_resp: {
        ret: -1,
        err_msg: '获取文章列表接口失败，请重试',
      },
    };
  });

  if (resp.base_resp.ret === 0) {
    const publish_page = JSON.parse(resp.publish_page);
    const articles = publish_page.publish_list
      .filter((item: any) => !!item.publish_info)
      .flatMap((item: any) => {
        const publish_info = JSON.parse(item.publish_info);
        return publish_info.appmsgex;
      });
    return {
      base_resp: resp.base_resp,
      articles: articles,
    };
  }
  return resp;
});
