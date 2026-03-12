import dayjs from 'dayjs';

/**
 * 鏄惁鍦ㄥ紑鍙戠幆澧?
 */
export const isDev = process.env.NODE_ENV === 'development';

/**
 * 缃戠珯鏍囬
 */
export const websiteName = '\u805a\u5fc3\u9605\u8bfb';

/**
 * 鏂囩珷鍒楄〃姣忛〉澶у皬锛?0涓烘渶澶ф湁鏁堝€?
 */
export const ARTICLE_LIST_PAGE_SIZE = 10;

/**
 * 鍏紬鍙峰垪琛ㄦ瘡椤靛ぇ灏?
 */
export const ACCOUNT_LIST_PAGE_SIZE = 5;

/**
 * 鍏紬鍙风被鍨?
 */
export const ACCOUNT_TYPE: Record<number, string> = {
  0: '\u8ba2\u9605\u53f7',
  1: '\u8ba2\u9605\u53f7',
  2: '\u670d\u52a1\u53f7',
};

/**
 * Credentials 鐢熷瓨鏃堕棿锛屽崟浣嶏細鍒嗛挓
 */
export const CREDENTIAL_LIVE_MINUTES: number = 25;

/**
 * Credentials 鏈嶅姟鍣ㄤ富鏈哄湴鍧€
 */
export const CREDENTIAL_API_HOST = 'http://127.0.0.1:8088';

/**
 * 鏂囨。绔欑偣鍦板潃
 */
export const docsWebSite = 'https://docs.mptext.top';

// 鍥剧墖浠ｇ悊鏈嶅姟 todo: 杩欎釜鍙互鍦ㄨ缃噷澧炲姞涓€涓厤缃」锛岀綉绔欐槸鍚﹀惎鐢ㄥ浘鐗囦唬鐞嗭紝鍚︾殑璇濈疆绌哄嵆鍙€傜浉搴旂殑锛屽彲浠ヤ笌 no-referer 閰嶇疆浜掓枼銆?
// export const IMAGE_PROXY = 'https://image.baidu.com/search/down?thumburl=';
export const IMAGE_PROXY = '';

/**
 * 杞彂寰俊鍏紬鍙疯姹傛椂锛屼娇鐢ㄧ殑 user-agent 瀛楃涓?
 */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 WAE/1.0';

/**
 * 寰俊鍏紬鍙蜂笂绾挎椂闂?2012-08-23
 */
export const MP_ORIGIN_TIMESTAMP = dayjs('2012-08-23 00:00:00').unix();

/**
 * 鏂囩珷鏄剧ず绫诲瀷
 */
export const ITEM_SHOW_TYPE: Record<number, string> = {
  0: '\u666e\u901a\u56fe\u6587',
  5: '瑙嗛鍒嗕韩',
  6: '闊充箰鍒嗕韩',
  7: '闊抽鍒嗕韩',
  8: '鍥剧墖鍒嗕韩',
  10: '鏂囨湰鍒嗕韩',
  11: '鏂囩珷鍒嗕韩',
  17: '鐭枃',
};
