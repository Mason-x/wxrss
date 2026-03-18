import dayjs from 'dayjs';
import { appendResponseHeader, createError, getRequestHeader, type H3Event } from 'h3';
import { getAuthKeyBindingByAuthKey } from '~/server/repositories/auth-key-binding';
import { getUserAccessByIdentity } from '~/server/repositories/user-access';
import { cookieStore } from '~/server/utils/CookieStore';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';
import type { PreferenceRole } from '~/types/preferences';

export interface MpSession {
  authKey: string;
  identityKey: string;
  role: PreferenceRole;
  disabled: boolean;
}

function isHttpsRequest(event: H3Event): boolean {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https';
  }
  const encrypted = (event.node.req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  return Boolean(encrypted);
}

function createExpiredCookie(event: H3Event, name: string): string {
  const secureAttr = isHttpsRequest(event) ? '; Secure' : '';
  return `${name}=EXPIRED; Path=/; Expires=${dayjs().subtract(1, 'days').toDate().toUTCString()}; HttpOnly; SameSite=Lax${secureAttr}`;
}

function getCachedSession(event: H3Event): MpSession | null | undefined {
  return (event.context as { mpSession?: MpSession | null }).mpSession;
}

function setCachedSession(event: H3Event, session: MpSession | null): MpSession | null {
  (event.context as { mpSession?: MpSession | null }).mpSession = session;
  return session;
}

export function getAdminIdentityKey(): string {
  return String(process.env.MP_ADMIN_IDENTITY_KEY || '').trim();
}

export function resolvePreferenceRole(identityKey: string): PreferenceRole {
  const adminIdentityKey = getAdminIdentityKey();
  return adminIdentityKey && identityKey === adminIdentityKey ? 'admin' : 'user';
}

export async function resolveMpSessionByAuthKey(authKey: string): Promise<MpSession | null> {
  const normalizedAuthKey = String(authKey || '').trim();
  if (!normalizedAuthKey) {
    return null;
  }

  const binding = await getAuthKeyBindingByAuthKey(normalizedAuthKey);
  const identityKey = String(binding?.identityKey || '').trim();
  const access = identityKey ? await getUserAccessByIdentity(identityKey) : null;

  return {
    authKey: normalizedAuthKey,
    identityKey,
    role: resolvePreferenceRole(identityKey),
    disabled: access?.disabled === true,
  };
}

export async function getOptionalMpSession(event: H3Event): Promise<MpSession | null> {
  const cached = getCachedSession(event);
  if (cached !== undefined) {
    return cached;
  }

  const authKey = getAuthKeyFromRequest(event);
  const session = await resolveMpSessionByAuthKey(authKey);
  return setCachedSession(event, session);
}

export async function requireMpSession(event: H3Event): Promise<MpSession> {
  const session = await getOptionalMpSession(event);
  if (!session?.authKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }
  return session;
}

export async function requireAdminMpSession(event: H3Event): Promise<MpSession> {
  const session = await requireMpSession(event);
  if (session.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }
  return session;
}

export async function clearMpSession(event: H3Event, authKey?: string | null): Promise<void> {
  const normalizedAuthKey = String(authKey || '').trim();
  if (normalizedAuthKey) {
    await cookieStore.deleteCookie(normalizedAuthKey).catch(() => undefined);
  }

  appendResponseHeader(event, 'set-cookie', createExpiredCookie(event, 'auth-key'));
  appendResponseHeader(event, 'set-cookie', createExpiredCookie(event, 'uuid'));
  setCachedSession(event, null);
}

export async function rejectDisabledMpSession(event: H3Event, authKey?: string | null): Promise<never> {
  await clearMpSession(event, authKey);
  throw createError({
    statusCode: 403,
    statusMessage: 'UserDisabled',
    message: 'UserDisabled',
  });
}
