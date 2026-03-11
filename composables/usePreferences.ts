import { clonePreferences, normalizePreferences } from '#shared/utils/preferences';
import { request } from '#shared/utils/request';
import type { Preferences } from '~/types/preferences';
import type { LoginAccount } from '~/types/types';

interface PreferencesResponse {
  data?: Partial<Preferences>;
  exists?: boolean;
  source?: 'stored' | 'default';
  updatedAt?: number;
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

  if (!initialized.value) {
    preferences.value = normalizePreferences(preferences.value);

    if (import.meta.client) {
      async function persistRemote(next: Preferences): Promise<void> {
        if (!activeOwnerKey.value) {
          return;
        }

        const normalized = normalizePreferences(next);
        await request<PreferencesResponse>('/api/web/preferences', {
          method: 'POST',
          body: normalized,
        });
        lastPersisted.value = JSON.stringify(normalized);
      }

      async function loadRemotePreferences(currentSequence: number, options?: { seedDefaults?: boolean }) {
        const ownerKey = activeOwnerKey.value;
        if (!ownerKey) {
          return;
        }

        const response = await request<PreferencesResponse>('/api/web/preferences');
        if (currentSequence !== loadSequence.value || ownerKey !== activeOwnerKey.value) {
          return;
        }

        const remotePreferences = normalizePreferences(response?.data);
        if (response?.exists) {
          preferences.value = remotePreferences;
          lastPersisted.value = JSON.stringify(remotePreferences);
          return;
        }

        const seedPreferences = clonePreferences();
        preferences.value = seedPreferences;
        lastPersisted.value = '';

        if (options?.seedDefaults !== false) {
          await persistRemote(seedPreferences);
        }
      }

      async function refreshRemotePreferencesOnFocus() {
        if (!activeOwnerKey.value || hydrating.value) {
          return;
        }

        const refreshSequence = ++loadSequence.value;
        hydrating.value = true;

        try {
          await loadRemotePreferences(refreshSequence, { seedDefaults: false });
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
            lastPersisted.value = JSON.stringify(defaultPreferences);
            hydrating.value = false;
            return;
          }

          hydrating.value = true;

          try {
            await loadRemotePreferences(currentSequence, { seedDefaults: true });
          } catch {
            if (currentSequence !== loadSequence.value) {
              return;
            }
            const fallbackPreferences = clonePreferences(preferences.value);
            preferences.value = fallbackPreferences;
            lastPersisted.value = JSON.stringify(fallbackPreferences);
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
        nextValue => {
          const normalized = normalizePreferences(nextValue);
          const serialized = JSON.stringify(normalized);

          if (hydrating.value || serialized === lastPersisted.value) {
            return;
          }

          if (!activeOwnerKey.value) {
            preferences.value = normalized;
            lastPersisted.value = serialized;
            return;
          }

          if (saveTimer.value) {
            window.clearTimeout(saveTimer.value);
          }

          saveTimer.value = window.setTimeout(async () => {
            saveTimer.value = null;
            if (hydrating.value || !activeOwnerKey.value) {
              return;
            }
            await persistRemote(normalized);
          }, 400);
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
