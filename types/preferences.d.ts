export interface AiTagDefinition {
  label: string;
  variable: string;
  description: string;
  color: string;
}

export type PreferenceKey = keyof Preferences;

export type PreferenceRole = 'admin' | 'user';

export interface Preferences {
  hideDeleted: boolean;

  privateProxyList: string[];
  privateProxyAuthorization: string;

  rsshubBaseUrl: string;

  aiSummaryBaseUrl: string;
  aiSummaryApiKey: string;
  aiSummaryModel: string;
  aiSummarySystemPrompt: string;
  aiTagDefinitions: AiTagDefinition[];
  aiTagSystemPrompt: string;
  aiDailyReportSystemPrompt: string;
  aiDailyReportIncludedLabels: string[];
  aiAutoSummaryOnSyncEnabled: boolean;

  exportConfig: ExportConfig;
  downloadConfig: DownloadConfig;

  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;

  syncDateRange: '24h' | '1d' | '3d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'all' | 'point';
  syncDatePoint: number;
}

export interface PreferencesAccess {
  role: PreferenceRole;
  editableKeys: PreferenceKey[];
  userManagedKeys: PreferenceKey[];
  adminManagedKeys: PreferenceKey[];
}

export interface PreferencesCapabilities {
  aiConfigured: boolean;
  privateProxyConfigured: boolean;
  privateProxyCount: number;
}

interface ExportConfig {
  dirname: string;
  maxlength: number;
  exportJsonIncludeContent: boolean;
  exportJsonIncludeComments: boolean;
  exportExcelIncludeContent: boolean;
  exportHtmlIncludeComments: boolean;
}

interface DownloadConfig {
  forceDownloadContent: boolean;
  metadataOverrideContent: boolean;
}
