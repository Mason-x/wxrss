import { USER_AGENT } from '~/config';

function patchPlayerScript(source: string): string {
  return source.replace(
    /try\{\s*if\("mp\.weixin\.qq\.com"!=window\.parent\.document\.domain\)return;\s*\}\s*catch\(\w+\)\{\s*return;\s*\}/,
    ''
  );
}

export default defineEventHandler(async () => {
  const rawScript = await fetch('https://res.wx.qq.com/mmbizwap/zh_CN/htmledition/js/pages/video_player_tmpl.js', {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
  }).then(res => res.text());

  const script = patchPlayerScript(rawScript);
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
