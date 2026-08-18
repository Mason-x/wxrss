export interface ExtractedAccountProfile {
  nickname: string;
  round_head_img: string;
}

export interface AccountSyncStopInput {
  completed: boolean;
  pageMessageCount: number;
  inserted: number;
  stopWhenNoNewOnThisPage: boolean;
  requestedSize?: number;
}

function decodeJsString(value: string): string {
  return String(value || '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function firstMatch(source: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = decodeJsString(match?.[1] || '');
    if (value) {
      return value;
    }
  }
  return '';
}

export function extractAccountProfileFromHtml(html: string): ExtractedAccountProfile {
  const source = String(html || '');
  const nickname = firstMatch(source, [
    /nick_name\s*:\s*JsDecode\(\s*'((?:\\.|[^'\\])*)'\s*\)/i,
    /nick_name\s*:\s*JsDecode\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
    /getXmlValue\('nick_name\.DATA'\)\s*:\s*'((?:\\.|[^'\\])*)'/i,
    /var\s+nickname\s*=\s*htmlDecode\(\s*'((?:\\.|[^'\\])*)'\s*\)/i,
    /var\s+nickname\s*=\s*htmlDecode\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
    /nick_name\s*:\s*htmlDecode\(\s*'((?:\\.|[^'\\])*)'\s*\)/i,
    /nick_name\s*:\s*htmlDecode\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
    /nickname\s*:\s*htmlDecode\(\s*'((?:\\.|[^'\\])*)'\s*\)/i,
    /var\s+nickname\s*=\s*'((?:\\.|[^'\\])*)'/i,
    /var\s+nickname\s*=\s*"((?:\\.|[^"\\])*)"/i,
    /["']nick_name["']\s*:\s*["']((?:\\.|[^"\\])*)["']/i,
    /nick_name\s*:\s*'((?:\\.|[^'\\])*)'/i,
    /nick_name\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /id="js_wx_follow_nickname"[^>]*>\s*([\s\S]*?)</i,
    /id="js_name"[^>]*>\s*([^<]+?)\s*</i,
    /class="wx_follow_nickname"[^>]*>\s*([\s\S]*?)</i,
    /class="profile_nickname"[^>]*>\s*([^<]+?)\s*</i,
    /id="nickname"[^>]*>\s*([^<]+?)\s*</i,
  ]);
  let roundHeadImg = firstMatch(source, [
    /round_head_img\s*:\s*JsDecode\(\s*'((?:\\.|[^'\\])*)'\s*\)/i,
    /round_head_img\s*:\s*JsDecode\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
    /var\s+round_head_img\s*=\s*'((?:\\.|[^'\\])*)'/i,
    /var\s+round_head_img\s*=\s*"((?:\\.|[^"\\])*)"/i,
    /var\s+hd_head_img\s*=\s*'((?:\\.|[^'\\])*)'/i,
    /var\s+hd_head_img\s*=\s*"((?:\\.|[^"\\])*)"/i,
    /["']round_head_img["']\s*:\s*["']((?:\\.|[^"\\])*)["']/i,
    /["']hd_head_img["']\s*:\s*["']((?:\\.|[^"\\])*)["']/i,
    /["']headimg["']\s*:\s*["']((?:\\.|[^"\\])*)["']/i,
    /class="wx_follow_avatar_pic"[^>]*src="([^"]+)"/i,
    /src="([^"]+)"[^>]*class="wx_follow_avatar_pic"/i,
    /class="profile_avatar"[^>]*src="([^"]+)"/i,
  ]);
  if (roundHeadImg.startsWith('//')) {
    roundHeadImg = `https:${roundHeadImg}`;
  } else if (roundHeadImg.startsWith('http://')) {
    roundHeadImg = `https://${roundHeadImg.slice('http://'.length)}`;
  }

  return {
    nickname,
    round_head_img: roundHeadImg,
  };
}

export function isArticleListPageCompleted(canMsgContinue: number, messageCount: number, requestedSize = 0): boolean {
  if (Number(messageCount) <= 0) {
    return true;
  }
  if (requestedSize > 0 && Number(messageCount) >= requestedSize) {
    return false;
  }
  return Number(canMsgContinue) !== 1;
}

export function shouldUseHistoryBackfill(account: { completed?: boolean; count?: number }, loadMore: boolean): boolean {
  return Boolean(loadMore);
}

export function shouldStopAfterAccountSyncPage(input: AccountSyncStopInput): boolean {
  const pageMessageCount = Number(input.pageMessageCount) || 0;
  const requestedSize = Number(input.requestedSize) || 0;
  const pageLooksFull = requestedSize > 0 && pageMessageCount >= requestedSize;
  if (pageLooksFull) {
    return false;
  }
  const noNewOnThisPage = pageMessageCount > 0 && Number(input.inserted) === 0;
  return Boolean(input.completed) || (input.stopWhenNoNewOnThisPage && noNewOnThisPage);
}

export function formatRunningSyncText(input: {
  syncedMessages: number;
  scannedMessages: number;
  totalMessages: number;
  syncedArticles: number;
}): string {
  const synced = Math.max(0, Number(input.syncedMessages) || 0);
  const scanned = Math.max(0, Number(input.scannedMessages) || 0);
  const total = Math.max(0, Number(input.totalMessages) || 0);
  const articles = Math.max(0, Number(input.syncedArticles) || 0);
  if (total > synced) {
    return `${synced}/${total}，文章 ${articles}`;
  }
  return `入库 ${synced} · 扫描 ${scanned} · 文章 ${articles}`;
}

export function getKnownSyncPercent(input: {
  syncedMessages: number;
  totalMessages: number;
  completed?: boolean;
}): number {
  const synced = Math.max(0, Number(input.syncedMessages) || 0);
  const total = Math.max(0, Number(input.totalMessages) || 0);
  if (total > 0 && (Boolean(input.completed) || total > synced)) {
    return Math.min(100, Math.max(0, Math.round((synced / total) * 100)));
  }
  return 0;
}

export function getEffectiveAccountSyncTimestamp(
  syncTimestamp: number,
  lastUpdateTime: number,
  allowHistoryBackfill: boolean
): number {
  const safeSyncTimestamp = Number(syncTimestamp) || 0;
  if (allowHistoryBackfill) {
    return safeSyncTimestamp;
  }
  return Math.max(safeSyncTimestamp, Number(lastUpdateTime) || 0);
}
