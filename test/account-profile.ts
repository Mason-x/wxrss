import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractAccountProfileFromHtml,
  formatRunningSyncText,
  getEffectiveAccountSyncTimestamp,
  getKnownSyncPercent,
  isArticleListPageCompleted,
  shouldStopAfterAccountSyncPage,
  shouldUseHistoryBackfill,
} from '../shared/utils/account-profile.ts';

const html = `
            nick_name: JsDecode('36氪'),
            round_head_img: JsDecode('http://mmbiz.qpic.cn/mmbiz_png/demo.png?wx_fmt=png'),
            <div class="wx_follow_nickname">备用名</div>
`;

const profile = extractAccountProfileFromHtml(html);
assert.equal(profile.nickname, '36氪');
assert.equal(profile.round_head_img, 'https://mmbiz.qpic.cn/mmbiz_png/demo.png?wx_fmt=png');

const sampleProfile = extractAccountProfileFromHtml(readFileSync('samples/图片分享/01.html', 'utf8'));
assert.equal(sampleProfile.nickname, '36氪');
assert.match(sampleProfile.round_head_img, /^https:\/\/mmbiz\.qpic\.cn\//);

const homeHtml = `
  var nickname = htmlDecode("生财有术");
  var round_head_img = "http://mmbiz.qpic.cn/mmbiz_png/demo/0?wx_fmt=png";
`;
const homeProfile = extractAccountProfileFromHtml(homeHtml);
assert.equal(homeProfile.nickname, '生财有术');
assert.equal(homeProfile.round_head_img, 'https://mmbiz.qpic.cn/mmbiz_png/demo/0?wx_fmt=png');

const followHtml = `<strong id="js_name">油管增长实验室</strong><span id="js_wx_follow_nickname">油管增长实验室</span>`;
assert.equal(extractAccountProfileFromHtml(followHtml).nickname, '油管增长实验室');

const cgiHtml = "nick_name: '玩赚油管',\n                          round_head_img: 'http://mmbiz.qpic.cn/demo.png'";
assert.equal(extractAccountProfileFromHtml(cgiHtml).nickname, '玩赚油管');

assert.equal(shouldUseHistoryBackfill({ completed: false, count: 1 }, true), true);
assert.equal(shouldUseHistoryBackfill({ completed: true, count: 1 }, true), true);
assert.equal(shouldUseHistoryBackfill({ completed: true, count: 20 }, true), true);
assert.equal(shouldUseHistoryBackfill({ completed: false, count: 1 }, false), false);

assert.equal(isArticleListPageCompleted(0, 10, 10), false);
assert.equal(isArticleListPageCompleted(0, 3, 10), true);
assert.equal(isArticleListPageCompleted(1, 10, 10), false);
assert.equal(isArticleListPageCompleted(0, 0, 10), true);

assert.equal(
  shouldStopAfterAccountSyncPage({
    completed: false,
    pageMessageCount: 1,
    inserted: 0,
    stopWhenNoNewOnThisPage: true,
  }),
  true
);
assert.equal(
  shouldStopAfterAccountSyncPage({
    completed: false,
    pageMessageCount: 1,
    inserted: 0,
    stopWhenNoNewOnThisPage: false,
  }),
  false
);
assert.equal(
  shouldStopAfterAccountSyncPage({
    completed: true,
    pageMessageCount: 10,
    inserted: 3,
    stopWhenNoNewOnThisPage: false,
    requestedSize: 10,
  }),
  false
);
assert.equal(
  shouldStopAfterAccountSyncPage({
    completed: true,
    pageMessageCount: 3,
    inserted: 3,
    stopWhenNoNewOnThisPage: false,
    requestedSize: 10,
  }),
  true
);

assert.equal(getEffectiveAccountSyncTimestamp(100, 999, true), 100);
assert.equal(getEffectiveAccountSyncTimestamp(100, 999, false), 999);

assert.equal(
  formatRunningSyncText({ syncedMessages: 50, scannedMessages: 20, totalMessages: 0, syncedArticles: 51 }),
  '入库 50 · 扫描 20 · 文章 51'
);
assert.equal(
  formatRunningSyncText({ syncedMessages: 20, scannedMessages: 20, totalMessages: 80, syncedArticles: 22 }),
  '20/80，文章 22'
);
assert.equal(getKnownSyncPercent({ syncedMessages: 50, totalMessages: 50 }), 0);
assert.equal(getKnownSyncPercent({ syncedMessages: 50, totalMessages: 50, completed: true }), 100);
assert.equal(getKnownSyncPercent({ syncedMessages: 20, totalMessages: 80 }), 25);

console.log('account-profile tests passed');
