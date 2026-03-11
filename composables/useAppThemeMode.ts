import type { Preferences } from '~/types/preferences';

export type AppThemeMode = 'system' | 'light' | 'dark';

export interface AppThemeModeOption {
  key: AppThemeMode;
  label: string;
  icon: string;
}

const APP_THEME_OPTIONS: AppThemeModeOption[] = [
  { key: 'system', label: '系统', icon: 'i-lucide:laptop-minimal' },
  { key: 'light', label: '白天', icon: 'i-lucide:sun-medium' },
  { key: 'dark', label: '夜间', icon: 'i-lucide:moon-star' },
];

function normalizeAppThemeMode(value: unknown): AppThemeMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'light' || normalized === 'dark' || normalized === 'system') {
    return normalized;
  }
  return 'system';
}

export function useAppThemeMode() {
  const preferences = usePreferences() as unknown as Ref<Preferences>;
  const system = useState<'light' | 'dark'>('app-theme-system', () => 'light');
  const listenersBound = useState<boolean>('app-theme-listeners-bound', () => false);

  const preference = computed<AppThemeMode>({
    get() {
      return normalizeAppThemeMode(preferences.value.themeMode);
    },
    set(value) {
      preferences.value.themeMode = value;
    },
  });

  const effective = computed<'light' | 'dark'>(() => (
    preference.value === 'system' ? system.value : preference.value
  ));
  const isDark = computed(() => effective.value === 'dark');

  if (import.meta.client && !listenersBound.value) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => {
      system.value = mediaQuery.matches ? 'dark' : 'light';
    };

    updateSystemTheme();
    mediaQuery.addEventListener('change', updateSystemTheme);
    listenersBound.value = true;
  }

  watch(
    effective,
    value => {
      if (!import.meta.client) {
        return;
      }

      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.style.colorScheme = value;
    },
    { immediate: true }
  );

  return {
    preference,
    effective,
    system,
    isDark,
    options: APP_THEME_OPTIONS,
    setThemeMode(mode: AppThemeMode) {
      preference.value = mode;
    },
  };
}
