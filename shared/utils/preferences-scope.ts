import { normalizePreferences } from '#shared/utils/preferences';
import type { PreferenceKey, PreferenceRole, Preferences } from '~/types/preferences';

export const USER_MANAGED_PREFERENCE_KEYS = [
  'aiTagDefinitions',
  'syncDateRange',
  'syncDatePoint',
  'aiAutoSummaryOnSyncEnabled',
] as const satisfies PreferenceKey[];

export const ADMIN_MANAGED_PREFERENCE_KEYS = [
  'hideDeleted',
  'privateProxyList',
  'privateProxyAuthorization',
  'rsshubBaseUrl',
  'aiSummaryBaseUrl',
  'aiSummaryApiKey',
  'aiSummaryModel',
  'aiSummarySystemPrompt',
  'aiTagSystemPrompt',
  'exportConfig',
  'downloadConfig',
  'accountSyncMinSeconds',
  'accountSyncMaxSeconds',
] as const satisfies PreferenceKey[];

export const USER_HIDDEN_PREFERENCE_KEYS = [
  'privateProxyList',
  'privateProxyAuthorization',
  'aiSummaryBaseUrl',
  'aiSummaryApiKey',
  'aiSummaryModel',
  'aiSummarySystemPrompt',
  'aiTagSystemPrompt',
  'aiDailyReportSystemPrompt',
] as const satisfies PreferenceKey[];

function pickPreferencesByKeys(
  source: Partial<Preferences> | null | undefined,
  keys: readonly PreferenceKey[]
): Partial<Preferences> {
  const result: Partial<Preferences> = {};
  const input = source || {};

  for (const key of keys) {
    if (key in input) {
      (result as Record<PreferenceKey, Preferences[PreferenceKey] | undefined>)[key] = input[key];
    }
  }

  return result;
}

export function pickUserManagedPreferences(source: Partial<Preferences> | null | undefined): Partial<Preferences> {
  return pickPreferencesByKeys(source, USER_MANAGED_PREFERENCE_KEYS);
}

export function pickAdminManagedPreferences(source: Partial<Preferences> | null | undefined): Partial<Preferences> {
  return pickPreferencesByKeys(source, ADMIN_MANAGED_PREFERENCE_KEYS);
}

export function normalizeUserManagedPreferences(source: Partial<Preferences> | null | undefined): Partial<Preferences> {
  return pickUserManagedPreferences(normalizePreferences(source));
}

export function normalizeAdminManagedPreferences(
  source: Partial<Preferences> | null | undefined
): Partial<Preferences> {
  return pickAdminManagedPreferences(normalizePreferences(source));
}

export function mergePreferenceScopes(
  userManaged: Partial<Preferences> | null | undefined,
  adminManaged: Partial<Preferences> | null | undefined
): Preferences {
  return normalizePreferences({
    ...(adminManaged || {}),
    ...(userManaged || {}),
  });
}

export function getEditablePreferenceKeys(role: PreferenceRole): PreferenceKey[] {
  return role === 'admin'
    ? [...USER_MANAGED_PREFERENCE_KEYS, ...ADMIN_MANAGED_PREFERENCE_KEYS]
    : [...USER_MANAGED_PREFERENCE_KEYS];
}
