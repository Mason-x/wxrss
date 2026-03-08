export default () => {
  const route = useRoute();
  const { loginAccount, isLoginExpired, navigateToLogin } = useMpAuth();

  function checkLogin() {
    if (!loginAccount.value || isLoginExpired(loginAccount.value)) {
      loginAccount.value = null;
      void navigateToLogin(route.fullPath);
      return false;
    }

    return true;
  }

  return {
    checkLogin,
  };
};
