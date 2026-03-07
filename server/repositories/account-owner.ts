import { getAuthKeyBindingByAuthKey } from '~/server/repositories/auth-key-binding';

export interface AccountOwnerScope {
  ownerKey: string;
  identityKey: string;
  authKey: string;
}

export async function resolveAccountOwnerScope(authKey: string): Promise<AccountOwnerScope> {
  const normalizedAuthKey = String(authKey || '').trim();
  const binding = await getAuthKeyBindingByAuthKey(normalizedAuthKey);
  const identityKey = String(binding?.identityKey || '').trim();

  return {
    ownerKey: identityKey ? `identity:${identityKey}` : `auth:${normalizedAuthKey}`,
    identityKey,
    authKey: normalizedAuthKey,
  };
}
