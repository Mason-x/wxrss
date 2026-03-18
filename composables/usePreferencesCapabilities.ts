import type { PreferencesCapabilities } from '~/types/preferences';

export default function usePreferencesCapabilities() {
  return useState<PreferencesCapabilities>('preferences-capabilities', () => ({
    aiConfigured: false,
    newrankConfigured: false,
    privateProxyConfigured: false,
    privateProxyCount: 0,
  }));
}
