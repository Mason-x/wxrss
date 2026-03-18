import { deleteUserDirectoryByIdentity, getUserDirectoryGroupByIdentity } from '~/server/repositories/user-access';
import { getAdminIdentityKey, requireAdminMpSession, resolvePreferenceRole } from '~/server/utils/mp-session';

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

  const adminIdentityKey = getAdminIdentityKey();
  if (adminIdentityKey && group.entry.identityKeys.includes(adminIdentityKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot delete admin user',
    });
  }

  const deleted = await deleteUserDirectoryByIdentity(identityKey);
  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  return {
    data: {
      identityKey: deleted.identityKey,
      identityKeys: deleted.identityKeys,
      authKeys: deleted.authKeys,
      memberCount: deleted.memberCount,
      role: deleted.identityKeys.some(item => resolvePreferenceRole(item) === 'admin') ? 'admin' : 'user',
      deletedByIdentityKey: session.identityKey,
    },
  };
});
