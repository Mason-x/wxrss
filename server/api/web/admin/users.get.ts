import { listUserDirectoryEntries } from '~/server/repositories/user-access';
import { requireAdminMpSession, resolvePreferenceRole } from '~/server/utils/mp-session';

export default defineEventHandler(async event => {
  const session = await requireAdminMpSession(event);
  const users = await listUserDirectoryEntries();

  return {
    data: users.map(user => ({
      identityKey: user.identityKey,
      nickname: user.nickname,
      avatar: user.headImg,
      userName: user.userName,
      bizUin: user.bizUin,
      alias: user.alias,
      lastLoginAt: user.lastLoginAt,
      disabled: user.disabled,
      disabledAt: user.disabledAt,
      role: resolvePreferenceRole(user.identityKey),
      isCurrentUser: user.identityKey === session.identityKey,
    })),
  };
});
