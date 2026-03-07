import { StorageSerializers } from '@vueuse/core';
import { clonePreferences, isDefaultPreferences, normalizePreferences } from '#shared/utils/preferences';
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
  const storage = useLocalStorage<Preferences>('preferences', clonePreferences(), {
    serializer: StorageSerializers.object,
    mergeDefaults: true,
  });
  const preferences = useState<Preferences>('preferences-state', () => normalizePreferences(storage.value));
  const loginAccount = useLoginAccount();

  const initialized = useState<boolean>('preferences-sync-initialized', () => false);
  const hydrating = useState<boolean>('preferences-sync-hydrating', () => false);
  const activeOwnerKey = useState<string>('preferences-sync-owner-key', () => '');
  const lastPersisted = useState<string>('preferences-sync-last-persisted', () => '');
  const loadSequence = useState<number>('preferences-sync-load-sequence', () => 0);
  const saveTimer = useState<number | null>('preferences-sync-save-timer', () => null);

  if (!initialized.value) {
    preferences.value = normalizePreferences(storage.value);

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
            const localPreferences = normalizePreferences(storage.value);
            preferences.value = localPreferences;
            lastPersisted.value = JSON.stringify(localPreferences);
            hydrating.value = false;
            return;
          }

          const localPreferences = normalizePreferences(storage.value);
          hydrating.value = true;

          try {
            const resp = await request<PreferencesResponse>('/api/web/preferences');
            if (currentSequence !== loadSequence.value) {
              return;
            }

            const remotePreferences = normalizePreferences(resp?.data);
            if (resp?.exists) {
              preferences.value = remotePreferences;
              storage.value = clonePreferences(remotePreferences);
              lastPersisted.value = JSON.stringify(remotePreferences);
              return;
            }

            const seedPreferences = isDefaultPreferences(localPreferences) ? remotePreferences : localPreferences;
            preferences.value = seedPreferences;
            storage.value = clonePreferences(seedPreferences);
            lastPersisted.value = '';
            await persistRemote(seedPreferences);
          } catch {
            if (currentSequence !== loadSequence.value) {
              return;
            }
            preferences.value = localPreferences;
            storage.value = clonePreferences(localPreferences);
            lastPersisted.value = JSON.stringify(localPreferences);
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
          storage.value = clonePreferences(normalized);

          if (hydrating.value || serialized === lastPersisted.value) {
            return;
          }

          if (!activeOwnerKey.value) {
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
    }

    initialized.value = true;
  }

  return preferences;
};
