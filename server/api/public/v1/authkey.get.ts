import { getMpCookie } from '~/server/kv/cookie';
import { getAuthKeyBindingByAuthKey } from '~/server/repositories/auth-key-binding';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = String(getAuthKeyFromRequest(event) || '').trim();
  const cookie = authKey ? await getMpCookie(authKey) : null;

  if (!authKey || !cookie) {
    return {
      code: -1,
      msg: 'AuthKey not found',
    };
  }

  const binding = await getAuthKeyBindingByAuthKey(authKey);
  const expiresAt = Number(cookie.expiresAt) || Date.now();

  return {
    code: 0,
    data: authKey,
    login: {
      nickname: String(binding?.nickname || ''),
      avatar: String(binding?.headImg || ''),
      expires: new Date(expiresAt).toString(),
      auth_key: authKey,
      identity_key: String(binding?.identityKey || ''),
    },
  };
});
