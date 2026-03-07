import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';
import { MP_ORIGIN_TIMESTAMP } from '~/config';
import type { Preferences } from '~/types/preferences';

const SYNC_DATE_RANGE_VALUES: Preferences['syncDateRange'][] = [
  '1d',
  '3d',
  '7d',
  '1m',
  '3m',
  '6m',
  '1y',
  'all',
  'point',
];

export const DEFAULT_PREFERENCES: Preferences = {
  hideDeleted: true,
  privateProxyList: [],
  privateProxyAuthorization: '',
  exportConfig: {
    dirname: '${title}',
    maxlength: 0,
    exportExcelIncludeContent: true,
    exportJsonIncludeComments: true,
    exportJsonIncludeContent: true,
    exportHtmlIncludeComments: true,
  },
  downloadConfig: {
    forceDownloadContent: false,
    metadataOverrideContent: false,
  },
  accountSyncMinSeconds: 3,
  accountSyncMaxSeconds: 5,
  dailySyncEnabled: false,
  dailySyncTime: '06:00',
  syncDateRange: '1y',
  syncDatePoint: MP_ORIGIN_TIMESTAMP,
};

function normalizeSyncDateRange(value?: string): Preferences['syncDateRange'] {
  if (value && SYNC_DATE_RANGE_VALUES.includes(value as Preferences['syncDateRange'])) {
    return value as Preferences['syncDateRange'];
  }
  return DEFAULT_PREFERENCES.syncDateRange;
}

function normalizeDailySyncTime(value?: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) {
    return DEFAULT_PREFERENCES.dailySyncTime;
  }
  return `${match[1]}:${match[2]}`;
}

function normalizeProxyList(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PREFERENCES.privateProxyList];
  }
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

type PreferencesInput = Partial<Preferences> & {
  accountSyncSeconds?: number;
};

export function normalizePreferences(input?: PreferencesInput | null): Preferences {
  const source = input || {};
  const syncDelayRange = normalizeSyncDelayRange(source, DEFAULT_PREFERENCES);

  return {
    hideDeleted: source.hideDeleted ?? DEFAULT_PREFERENCES.hideDeleted,
    privateProxyList: normalizeProxyList(source.privateProxyList),
    privateProxyAuthorization: String(source.privateProxyAuthorization || '').trim(),
    exportConfig: {
      dirname: String(source.exportConfig?.dirname || DEFAULT_PREFERENCES.exportConfig.dirname),
      maxlength: Math.max(0, Math.floor(Number(source.exportConfig?.maxlength) || 0)),
      exportExcelIncludeContent:
        source.exportConfig?.exportExcelIncludeContent ?? DEFAULT_PREFERENCES.exportConfig.exportExcelIncludeContent,
      exportJsonIncludeComments:
        source.exportConfig?.exportJsonIncludeComments ?? DEFAULT_PREFERENCES.exportConfig.exportJsonIncludeComments,
      exportJsonIncludeContent:
        source.exportConfig?.exportJsonIncludeContent ?? DEFAULT_PREFERENCES.exportConfig.exportJsonIncludeContent,
      exportHtmlIncludeComments:
        source.exportConfig?.exportHtmlIncludeComments ?? DEFAULT_PREFERENCES.exportConfig.exportHtmlIncludeComments,
    },
    downloadConfig: {
      forceDownloadContent:
        source.downloadConfig?.forceDownloadContent ?? DEFAULT_PREFERENCES.downloadConfig.forceDownloadContent,
      metadataOverrideContent:
        source.downloadConfig?.metadataOverrideContent ?? DEFAULT_PREFERENCES.downloadConfig.metadataOverrideContent,
    },
    accountSyncMinSeconds: syncDelayRange.accountSyncMinSeconds,
    accountSyncMaxSeconds: syncDelayRange.accountSyncMaxSeconds,
    dailySyncEnabled: source.dailySyncEnabled ?? DEFAULT_PREFERENCES.dailySyncEnabled,
    dailySyncTime: normalizeDailySyncTime(source.dailySyncTime),
    syncDateRange: normalizeSyncDateRange(source.syncDateRange),
    syncDatePoint: Number.isFinite(source.syncDatePoint)
      ? Number(source.syncDatePoint)
      : DEFAULT_PREFERENCES.syncDatePoint,
  };
}

export function clonePreferences(input?: Partial<Preferences> | null): Preferences {
  return normalizePreferences(input);
}

export function isDefaultPreferences(input?: Partial<Preferences> | null): boolean {
  return JSON.stringify(normalizePreferences(input)) === JSON.stringify(DEFAULT_PREFERENCES);
}
