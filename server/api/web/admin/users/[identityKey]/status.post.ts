import { getAuthKeyBindingByIdentity } from '~/server/repositories/auth-key-binding';
import { upsertUserAccessByIdentity } from '~/server/repositories/user-access';
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

  const binding = await getAuthKeyBindingByIdentity(identityKey);
  if (!binding) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  const body = await readBody<UpdateUserStatusBody>(event);
  const disabled = body?.disabled === true;
  const adminIdentityKey = getAdminIdentityKey();
  if (disabled && adminIdentityKey && identityKey === adminIdentityKey) {
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
    await cookieStore.deleteCookie(binding.authKey).catch(() => undefined);
  }

  return {
    data: {
      identityKey,
      disabled: access.disabled,
      disabledAt: access.disabledAt,
      role: resolvePreferenceRole(identityKey),
    },
  };
});
