import { getRequestURL } from 'h3';
import { getOptionalMpSession, rejectDisabledMpSession, requireAdminMpSession, requireMpSession } from '~/server/utils/mp-session';

const PUBLIC_WEB_API_PREFIXES = [
  '/api/web/login/getqrcode',
  '/api/web/login/scan',
  '/api/web/login/session/',
  '/api/web/login/bizlogin',
  '/api/web/mp/logout',
  '/api/web/worker/blocked-ip-list',
  '/api/web/worker/overview-metrics',
  '/api/web/worker/security-top-n',
] as const;

function isPublicWebApiPath(pathname: string): boolean {
  return PUBLIC_WEB_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

export default defineEventHandler(async event => {
  const pathname = getRequestURL(event).pathname;
  if (!pathname.startsWith('/api/web/')) {
    return;
  }

  if (isPublicWebApiPath(pathname)) {
    return;
  }

  if (pathname.startsWith('/api/web/admin/')) {
    const session = await requireAdminMpSession(event);
    if (session.disabled) {
      await rejectDisabledMpSession(event, session.authKey);
    }
    return;
  }

  const session = await requireMpSession(event);
  if (session.disabled) {
    await rejectDisabledMpSession(event, session.authKey);
    return;
  }

  await getOptionalMpSession(event);
});
