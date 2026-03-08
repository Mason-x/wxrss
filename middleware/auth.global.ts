export default defineNuxtRouteMiddleware(async to => {
  if (import.meta.server) {
    return;
  }

  const { isPublicRoute, validateLogin, buildLoginRoute, resolvePostLoginRedirect } = useMpAuth();

  if (isPublicRoute(to.path)) {
    const ok = await validateLogin();
    if (ok) {
      return navigateTo(resolvePostLoginRedirect(to.query.redirect), { replace: true });
    }
    return;
  }

  const ok = await validateLogin();
  if (!ok) {
    return navigateTo(buildLoginRoute(to.fullPath), { replace: true });
  }
});
