export interface AiTagDefinition {
  label: string;
  variable: string;
  description: string;
  color: string;
}

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

  exportConfig: ExportConfig;
  downloadConfig: DownloadConfig;

  accountSyncMinSeconds: number;
  accountSyncMaxSeconds: number;

  dailySyncEnabled: boolean;
  dailySyncTime: string;

  syncDateRange: '1d' | '3d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'all' | 'point';
  syncDatePoint: number;
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
