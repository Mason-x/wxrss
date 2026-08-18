import type { PreferencesCapabilities } from '~/types/preferences';

export default function usePreferencesCapabilities() {
  return useState<PreferencesCapabilities>('preferences-capabilities', () => ({
    aiConfigured: false,
    privateProxyConfigured: false,
    privateProxyCount: 0,
  }));
}
