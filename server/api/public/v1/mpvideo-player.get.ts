import { USER_AGENT } from '~/config';

interface MpVideoPlayerQuery {
  vid?: string;
}

function patchPlayerHtml(html: string): string {
  let next = html;

  if (/<head[\s>]/i.test(next) && !/<base[\s>]/i.test(next)) {
    next = next.replace(/<head([^>]*)>/i, '<head$1><base href="https://mp.weixin.qq.com/">');
  }

  next = next.replace(
    /if\s*\(\s*[\s\S]*?document\.referrer[\s\S]*?seajs\.use\("pages\/video_player_tmpl\.js"\);\s*\}\s*/s,
    'seajs.use("pages/video_player_tmpl.js");\n'
  );

  next = next.replace(
    /\/\/res\.wx\.qq\.com\/mmbizwap\/zh_CN\/htmledition\/js\/pages\/video_player_tmpl[^"]*?\.js/g,
    '/api/public/v1/mpvideo-player-script'
  );

  return next;
}

export default defineEventHandler(async event => {
  const query = getQuery<MpVideoPlayerQuery>(event);
  const vid = String(query.vid || '').trim();
  if (!/^wxv_[\da-z]+$/i.test(vid)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid vid' });
  }

  const targetUrl = `https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&action=mpvideo&auto=0&vid=${encodeURIComponent(vid)}`;
  const rawHtml = await fetch(targetUrl, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
  }).then(res => res.text());

  const html = patchPlayerHtml(rawHtml);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
