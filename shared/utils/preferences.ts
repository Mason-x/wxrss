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
  rsshubBaseUrl: '',
  aiSummaryBaseUrl: 'https://api.openai.com/v1',
  aiSummaryApiKey: '',
  aiSummaryModel: 'gpt-4.1-mini',
  aiSummarySystemPrompt:
    '你是一个中文文章摘要助手。请只基于用户提供的文章内容输出简洁摘要，不要编造原文没有的信息。先用 2 句话概括全文，再给出 3 条以内的关键信息，每条单独一行。',
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
  dailySyncEnabled: true,
  dailySyncTime: '03:00',
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

function resolveDailySyncConfig(source: PreferencesInput): Pick<Preferences, 'dailySyncEnabled' | 'dailySyncTime'> {
  const rawTime = String(source.dailySyncTime || '').trim();
  const normalizedTime = normalizeDailySyncTime(source.dailySyncTime);
  const hasLegacyDefaultCombo = source.dailySyncEnabled === false && (!rawTime || normalizedTime === '06:00');

  if (hasLegacyDefaultCombo) {
    return {
      dailySyncEnabled: true,
      dailySyncTime: DEFAULT_PREFERENCES.dailySyncTime,
    };
  }

  return {
    dailySyncEnabled: source.dailySyncEnabled ?? DEFAULT_PREFERENCES.dailySyncEnabled,
    dailySyncTime: normalizedTime,
  };
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
  const dailySyncConfig = resolveDailySyncConfig(source);

  return {
    hideDeleted: source.hideDeleted ?? DEFAULT_PREFERENCES.hideDeleted,
    privateProxyList: normalizeProxyList(source.privateProxyList),
    privateProxyAuthorization: String(source.privateProxyAuthorization || '').trim(),
    rsshubBaseUrl: String(source.rsshubBaseUrl || '').trim(),
    aiSummaryBaseUrl: String(source.aiSummaryBaseUrl || DEFAULT_PREFERENCES.aiSummaryBaseUrl).trim(),
    aiSummaryApiKey: String(source.aiSummaryApiKey || '').trim(),
    aiSummaryModel: String(source.aiSummaryModel || DEFAULT_PREFERENCES.aiSummaryModel).trim(),
    aiSummarySystemPrompt: String(
      source.aiSummarySystemPrompt || DEFAULT_PREFERENCES.aiSummarySystemPrompt
    ).trim(),
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
    dailySyncEnabled: dailySyncConfig.dailySyncEnabled,
    dailySyncTime: dailySyncConfig.dailySyncTime,
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
