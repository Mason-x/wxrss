/**
 * 公共代理客户端统计已停用。
 */
export default defineEventHandler(() => {
  return {
    topClientIPs: [],
    total: 0,
  };
});
