import type { PreferencesAccess } from '~/types/preferences';

export default function usePreferencesAccess() {
  return useState<PreferencesAccess>('preferences-access', () => ({
    role: 'user',
    editableKeys: [],
    userManagedKeys: [],
    adminManagedKeys: [],
  }));
}
