import { urlIsValidMpArticle } from '#shared/utils';
import { extractEmbeddedVideoInfoMap } from '#shared/utils/html';
import { USER_AGENT } from '~/config';

interface MpVideoInfoQuery {
  url?: string;
  vids?: string;
}

export default defineEventHandler(async event => {
  const query = getQuery<MpVideoInfoQuery>(event);
  const articleUrl = String(query.url || '').trim();

  if (!articleUrl || !urlIsValidMpArticle(articleUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid article url' });
  }

  const requestedVideoIds = String(query.vids || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  const response = await fetch(articleUrl, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
  });

  const rawHtml = await response.text();
  const videoInfoMap = extractEmbeddedVideoInfoMap(rawHtml);
  const videoIds = requestedVideoIds.length > 0 ? requestedVideoIds : [...videoInfoMap.keys()];

  const videos = Object.fromEntries(
    videoIds
      .map(videoId => {
        const info = videoInfoMap.get(videoId);
        if (!info?.src) {
          return null;
        }

        return [
          videoId,
          {
            src: info.src,
            poster: info.poster || '',
          },
        ];
      })
      .filter(Boolean) as Array<[string, { src: string; poster: string }]>
  );

  return {
    url: articleUrl,
    videos,
  };
});
