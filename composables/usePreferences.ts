import { clonePreferences, normalizePreferences } from '#shared/utils/preferences';
import { request } from '#shared/utils/request';
import type { Preferences, PreferencesAccess, PreferencesCapabilities } from '~/types/preferences';
import type { LoginAccount } from '~/types/types';

interface PreferencesResponse {
  data?: Partial<Preferences>;
  exists?: boolean;
  source?: 'stored' | 'default';
  updatedAt?: number;
  access?: PreferencesAccess;
  capabilities?: PreferencesCapabilities;
}

function getLoginOwnerKey(account: LoginAccount | null | undefined): string {
  return String(account?.identity_key || account?.auth_key || '').trim();
}

export default () => {
  const preferences = useState<Preferences>('preferences-state', () => normalizePreferences());
  const loginAccount = useLoginAccount();

  const initialized = useState<boolean>('preferences-sync-initialized', () => false);
  const hydrating = useState<boolean>('preferences-sync-hydrating', () => false);
  const activeOwnerKey = useState<string>('preferences-sync-owner-key', () => '');
  const lastPersisted = useState<string>('preferences-sync-last-persisted', () => '');
  const loadSequence = useState<number>('preferences-sync-load-sequence', () => 0);
  const saveTimer = useState<number | null>('preferences-sync-save-timer', () => null);
  const listenersBound = useState<boolean>('preferences-sync-listeners-bound', () => false);
  const hasUnsavedChanges = useState<boolean>('preferences-sync-dirty', () => false);
  const access = useState<PreferencesAccess>('preferences-access', () => ({
    role: 'user',
    editableKeys: [],
    userManagedKeys: [],
    adminManagedKeys: [],
  }));
  const capabilities = useState<PreferencesCapabilities>('preferences-capabilities', () => ({
    aiConfigured: false,
    newrankConfigured: false,
    privateProxyConfigured: false,
    privateProxyCount: 0,
  }));

  if (!initialized.value) {
    preferences.value = normalizePreferences(preferences.value);

    if (import.meta.client) {
      function applyResponseMetadata(response?: PreferencesResponse) {
        access.value = response?.access || {
          role: 'user',
          editableKeys: [],
          userManagedKeys: [],
          adminManagedKeys: [],
        };
        capabilities.value = response?.capabilities || {
          aiConfigured: false,
          newrankConfigured: false,
          privateProxyConfigured: false,
          privateProxyCount: 0,
        };
      }

      async function loadRemotePreferences(currentSequence: number) {
        const ownerKey = activeOwnerKey.value;
        if (!ownerKey) {
          return;
        }

        const response = await request<PreferencesResponse>('/api/web/preferences');
        if (currentSequence !== loadSequence.value || ownerKey !== activeOwnerKey.value) {
          return;
        }

        const remotePreferences = normalizePreferences(response?.data);
        preferences.value = remotePreferences;
        applyResponseMetadata(response);
        lastPersisted.value = JSON.stringify(remotePreferences);
        hasUnsavedChanges.value = false;
      }

      async function refreshRemotePreferencesOnFocus() {
        if (!activeOwnerKey.value || hydrating.value || hasUnsavedChanges.value) {
          return;
        }

        const refreshSequence = ++loadSequence.value;
        hydrating.value = true;

        try {
          await loadRemotePreferences(refreshSequence);
        } catch {
          // keep current in-memory settings when remote refresh fails
        } finally {
          if (refreshSequence === loadSequence.value) {
            hydrating.value = false;
          }
        }
      }

      watch(
        () => getLoginOwnerKey(loginAccount.value),
        async ownerKey => {
          loadSequence.value += 1;
          const currentSequence = loadSequence.value;
          activeOwnerKey.value = ownerKey;

          if (saveTimer.value) {
            window.clearTimeout(saveTimer.value);
            saveTimer.value = null;
          }

          if (!ownerKey) {
            const defaultPreferences = clonePreferences();
            preferences.value = defaultPreferences;
            applyResponseMetadata();
            lastPersisted.value = JSON.stringify(defaultPreferences);
            hydrating.value = false;
            hasUnsavedChanges.value = false;
            return;
          }

          hydrating.value = true;

          try {
            await loadRemotePreferences(currentSequence);
          } catch {
            if (currentSequence !== loadSequence.value) {
              return;
            }
            const fallbackPreferences = clonePreferences(preferences.value);
            preferences.value = fallbackPreferences;
            applyResponseMetadata();
            lastPersisted.value = JSON.stringify(fallbackPreferences);
            hasUnsavedChanges.value = false;
          } finally {
            if (currentSequence === loadSequence.value) {
              hydrating.value = false;
            }
          }
        },
        { immediate: true }
      );

      watch(
        preferences,
        () => {
          if (hydrating.value) {
            return;
          }
          hasUnsavedChanges.value = activeOwnerKey.value
            ? JSON.stringify(preferences.value) !== lastPersisted.value
            : false;
        },
        { deep: true }
      );

      if (!listenersBound.value) {
        const onWindowFocus = () => {
          void refreshRemotePreferencesOnFocus();
        };
        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            void refreshRemotePreferencesOnFocus();
          }
        };

        window.addEventListener('focus', onWindowFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);
        listenersBound.value = true;
      }
    }

    initialized.value = true;
  }

  return preferences;
};
