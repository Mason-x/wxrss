import { normalizePreferences } from '#shared/utils/preferences';
import { request } from '#shared/utils/request';
import type { Preferences } from '~/types/preferences';

function getLoginOwnerKey(account: Record<string, any> | null | undefined): string {
  return String(account?.identity_key || account?.auth_key || '').trim();
}

export default () => {
  const preferences = usePreferences() as unknown as Ref<Preferences>;
  const loginAccount = useLoginAccount();
  const saving = useState<boolean>('preferences-sync-saving', () => false);
  const lastPersisted = useState<string>('preferences-sync-last-persisted', () => '');
  const saveTimer = useState<number | null>('preferences-sync-save-timer', () => null);
  const hasUnsavedChanges = useState<boolean>('preferences-sync-dirty', () => false);

  async function saveNow() {
    const normalized = normalizePreferences(preferences.value);
    const serialized = JSON.stringify(normalized);

    preferences.value = normalized;

    if (import.meta.client && saveTimer.value) {
      window.clearTimeout(saveTimer.value);
      saveTimer.value = null;
    }

    const ownerKey = getLoginOwnerKey(loginAccount.value as Record<string, any> | null | undefined);
    if (!ownerKey) {
      lastPersisted.value = serialized;
      return;
    }

    saving.value = true;
    try {
      const response = await request<{ data?: Partial<Preferences> }>('/api/web/preferences', {
        method: 'POST',
        body: normalized,
      });
      const persisted = normalizePreferences(response?.data || normalized);
      preferences.value = persisted;
      lastPersisted.value = JSON.stringify(persisted);
      hasUnsavedChanges.value = false;
      return preferences.value;
    } finally {
      saving.value = false;
    }
  }

  return {
    saving: readonly(saving),
    saveNow,
  };
};
