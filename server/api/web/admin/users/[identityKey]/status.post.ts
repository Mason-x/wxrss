import { getUserDirectoryGroupByIdentity, upsertUserAccessByIdentity } from '~/server/repositories/user-access';
import { cookieStore } from '~/server/utils/CookieStore';
import { getAdminIdentityKey, requireAdminMpSession, resolvePreferenceRole } from '~/server/utils/mp-session';

interface UpdateUserStatusBody {
  disabled?: boolean;
}

export default defineEventHandler(async event => {
  const session = await requireAdminMpSession(event);
  const identityKey = String(event.context.params?.identityKey || '').trim();
  if (!identityKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'identityKey is required',
    });
  }

  const group = await getUserDirectoryGroupByIdentity(identityKey);
  if (!group) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  const body = await readBody<UpdateUserStatusBody>(event);
  const disabled = body?.disabled === true;
  const adminIdentityKey = getAdminIdentityKey();
  const groupIdentityKeys = group.entry.identityKeys;
  if (disabled && adminIdentityKey && groupIdentityKeys.includes(adminIdentityKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot disable admin user',
    });
  }

  const access = await upsertUserAccessByIdentity({
    identityKey,
    disabled,
    updatedByIdentityKey: session.identityKey,
  });

  if (disabled) {
    await Promise.all(group.entry.authKeys.map(authKey => cookieStore.deleteCookie(authKey).catch(() => undefined)));
  }

  return {
    data: {
      identityKey: group.entry.identityKey,
      disabled: access.disabled,
      disabledAt: access.disabledAt,
      role: groupIdentityKeys.some(item => resolvePreferenceRole(item) === 'admin') ? 'admin' : 'user',
    },
  };
});
