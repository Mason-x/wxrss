import { request } from '#shared/utils/request';
import type { LoginAccount } from '~/types/types';

interface AccountStateResponse<T> {
  data?: T | null;
  exists?: boolean;
  updatedAt?: number;
}

interface UseAccountSyncedStateOptions<T> {
  storageKey: string;
  remoteKey: string;
  defaultValue: T;
  normalize?: (value: unknown) => T;
}

function getLoginOwnerKey(account: LoginAccount | null | undefined): string {
  return String(account?.identity_key || account?.auth_key || '').trim();
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function useAccountSyncedState<T>(options: UseAccountSyncedStateOptions<T>) {
  const normalize = (value: unknown): T =>
    options.normalize
      ? options.normalize(value)
      : value === undefined
        ? cloneValue(options.defaultValue)
        : (value as T);

  const storage = useLocalStorage<T>(options.storageKey, cloneValue(options.defaultValue));
  const state = useState<T>(`account-synced:${options.remoteKey}:state`, () => normalize(storage.value));
  const hydrating = useState<boolean>(`account-synced:${options.remoteKey}:hydrating`, () => false);
  const initialized = useState<boolean>(`account-synced:${options.remoteKey}:initialized`, () => false);
  const activeOwnerKey = useState<string>(`account-synced:${options.remoteKey}:owner`, () => '');
  const lastPersisted = useState<string>(`account-synced:${options.remoteKey}:persisted`, () => '');
  const loadSequence = useState<number>(`account-synced:${options.remoteKey}:seq`, () => 0);
  const saveTimer = useState<number | null>(`account-synced:${options.remoteKey}:timer`, () => null);
  const loginAccount = useLoginAccount();

  async function persistRemote(next: T): Promise<void> {
    if (!activeOwnerKey.value) {
      return;
    }

    const normalized = normalize(next);
    await request<AccountStateResponse<T>>('/api/web/account-state', {
      method: 'POST',
      body: {
        key: options.remoteKey,
        data: normalized,
      },
    });
    lastPersisted.value = JSON.stringify(normalized);
  }

  async function hydrate(): Promise<void> {
    loadSequence.value += 1;
    const currentSequence = loadSequence.value;
    const ownerKey = getLoginOwnerKey(loginAccount.value);
    activeOwnerKey.value = ownerKey;

    if (saveTimer.value) {
      window.clearTimeout(saveTimer.value);
      saveTimer.value = null;
    }

    const localValue = normalize(storage.value);
    if (!ownerKey) {
      state.value = localValue;
      lastPersisted.value = JSON.stringify(localValue);
      hydrating.value = false;
      return;
    }

    hydrating.value = true;

    try {
      const resp = await request<AccountStateResponse<T>>('/api/web/account-state', {
        query: {
          key: options.remoteKey,
        },
      });
      if (currentSequence !== loadSequence.value) {
        return;
      }

      const remoteValue = normalize(resp?.data);
      if (resp?.exists) {
        state.value = remoteValue;
        storage.value = cloneValue(remoteValue);
        lastPersisted.value = JSON.stringify(remoteValue);
        return;
      }

      state.value = localValue;
      storage.value = cloneValue(localValue);
      lastPersisted.value = '';
      await persistRemote(localValue);
    } catch {
      if (currentSequence !== loadSequence.value) {
        return;
      }
      state.value = localValue;
      storage.value = cloneValue(localValue);
      lastPersisted.value = JSON.stringify(localValue);
    } finally {
      if (currentSequence === loadSequence.value) {
        hydrating.value = false;
      }
    }
  }

  if (!initialized.value) {
    state.value = normalize(storage.value);
    activeOwnerKey.value = getLoginOwnerKey(loginAccount.value);
    lastPersisted.value = JSON.stringify(state.value);

    if (import.meta.client) {
      watch(
        state,
        nextValue => {
          const normalized = normalize(nextValue);
          const serialized = JSON.stringify(normalized);
          storage.value = cloneValue(normalized);

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
            try {
              await persistRemote(normalized);
            } catch {
              // Keep local cache even when remote persistence fails.
            }
          }, 400);
        },
        { deep: true }
      );
    }

    initialized.value = true;
  }

  return {
    state,
    hydrating,
    hydrate,
  };
}
