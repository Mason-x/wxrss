import {
  DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT as CLEAN_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT,
  FIXED_AI_SUMMARY_SYSTEM_PROMPT as CLEAN_DEFAULT_AI_SUMMARY_SYSTEM_PROMPT,
  FIXED_AI_SUMMARY_PROMPT_NOTE as CLEAN_FIXED_AI_SUMMARY_PROMPT_NOTE,
  FIXED_AI_TAG_PROMPT_NOTE as CLEAN_FIXED_AI_TAG_PROMPT_NOTE,
} from '#shared/utils/ai-prompts';
import {
  BUILTIN_AI_QUALITY_TAG_DEFINITIONS,
  BUILTIN_AI_SPONSORED_TAG_DEFINITION,
  BUILTIN_AI_TAG_DEFINITIONS,
  DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS as BUILTIN_DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS,
} from '#shared/utils/ai-tags';
import { normalizeSyncDelayRange } from '#shared/utils/sync-delay';
import { MP_ORIGIN_TIMESTAMP } from '~/config';
import type { AiTagDefinition, Preferences } from '~/types/preferences';

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

const LEGACY_READING_TAGS = new Set(['{{featured}}', '{{low_signal}}', '{{sponsored}}']);

export const SYSTEM_AI_QUALITY_TAG_DEFINITIONS: AiTagDefinition[] = BUILTIN_AI_QUALITY_TAG_DEFINITIONS.map(item => ({
  ...item,
}));

export const SYSTEM_AI_SPONSORED_TAG_DEFINITION: AiTagDefinition = {
  ...BUILTIN_AI_SPONSORED_TAG_DEFINITION,
};

export const SYSTEM_AI_TAG_DEFINITIONS: AiTagDefinition[] = BUILTIN_AI_TAG_DEFINITIONS.map(item => ({ ...item }));

export const DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS = [...BUILTIN_DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS];

const SYSTEM_AI_TAG_VARIABLES = new Set(SYSTEM_AI_TAG_DEFINITIONS.map(item => item.variable));

export const DEFAULT_AI_TAG_DEFINITIONS: AiTagDefinition[] = SYSTEM_AI_TAG_DEFINITIONS.map(item => ({ ...item }));

export const DEFAULT_AI_SUMMARY_SYSTEM_PROMPT = CLEAN_DEFAULT_AI_SUMMARY_SYSTEM_PROMPT;

export const DEFAULT_AI_TAG_SYSTEM_PROMPT = CLEAN_FIXED_AI_TAG_PROMPT_NOTE;

export const DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT = CLEAN_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT;

const LEGACY_DEFAULT_AI_SUMMARY_SYSTEM_PROMPT = '';

const LEGACY_DEFAULT_AI_TAG_SYSTEM_PROMPT = '';

const LEGACY_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT = '';

const RUNTIME_DEFAULT_AI_TAG_DEFINITIONS: AiTagDefinition[] = [];

/*

const LEGACY_DEFAULT_AI_SUMMARY_SYSTEM_PROMPT = `浣犳槸涓€鍚嶉珮淇″櫔姣旂殑淇℃伅鎽樿缂栬緫锛屾搮闀夸粠鍏紬鍙锋枃绔犮€佸崥瀹€佺綉鏂囥€佽瘎璁烘枃銆佹暀绋嬫枃銆佽祫璁枃銆佽鐐规枃涓紝蹇€熸彁鐐尖€滆繖绡囨枃绔犲埌搴曡浜嗕粈涔堚€濅互鍙娾€滃€间笉鍊煎緱璇诲師鏂団€濄€備綘鐨勪换鍔′笉鏄満姊板帇缂╁師鏂囷紝鑰屾槸鍋氶珮璐ㄩ噺鐨勪俊鎭瓫閫夈€佽鐐规彁鐐间笌闃呰浼樺厛绾у垽鏂€俙;

const LEGACY_DEFAULT_AI_TAG_SYSTEM_PROMPT = [
  '杩欐槸瀵规爣绛惧垽瀹氱殑琛ュ厖瑙勫垯銆?,
  '鏃у崗璁渶澶氳緭鍑轰袱涓爣绛俱€?,
  '{{featured}}銆亄{skim}}銆亄{skip}} 涓夎€呬簰鏂ワ紝鍙兘淇濈暀涓€涓富闃呰浠峰€兼爣绛俱€?,
  '濡傛灉鍟嗕笟杞寲鎰忓浘瓒冲鏄庢樉锛屽彲鍦ㄤ富鏍囩涔嬪鍐嶈拷鍔?{{sponsored}}銆?,
].join('\n');

const LEGACY_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT = [
  '浣犳槸涓€鍚嶄腑鏂囧唴瀹圭紪杈戯紝璐熻矗鍩轰簬褰撳ぉ鏂囩珷鐨勭粨鏋勫寲鎽樿鐢熸垚 AI 鏃ユ姤銆?,
  '鏃ユ姤鍙弬鑰冩枃绔犳爣棰樸€佹潵婧愪俊鎭€乼ags銆乻ummary 鍜?highlights锛屼笉瑕佸亣璁捐嚜宸辩湅杩囧師鏂囥€?,
  '浼樺厛浣跨敤 {{featured}} 鍐呭浣滀负涓荤嚎锛屽皯閲忓紩鐢?{{skim}} 浣滀负鑳屾櫙琛ュ厖銆?,
].join('\n');

const RUNTIME_DEFAULT_AI_TAG_DEFINITIONS: AiTagDefinition[] = [];

*/

const RUNTIME_DEFAULT_CUSTOM_AI_TAG_DEFINITIONS: AiTagDefinition[] = [];

export const DEFAULT_PREFERENCES: Preferences = {
  hideDeleted: true,
  themeMode: 'system',
  privateProxyList: [],
  privateProxyAuthorization: '',
  rsshubBaseUrl: '',
  newrankCookie: '',
  aiSummaryBaseUrl: 'https://api.openai.com/v1',
  aiSummaryApiKey: '',
  aiSummaryModel: 'gpt-4.1-mini',
  aiSummarySystemPrompt: CLEAN_FIXED_AI_SUMMARY_PROMPT_NOTE,
  aiTagDefinitions: RUNTIME_DEFAULT_CUSTOM_AI_TAG_DEFINITIONS.map(item => ({ ...item })),
  aiTagSystemPrompt: CLEAN_FIXED_AI_TAG_PROMPT_NOTE,
  aiDailyReportSystemPrompt: CLEAN_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT,
  aiDailyReportIncludedLabels: [...DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS],
  aiAutoSummaryOnSyncEnabled: true,
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

type PreferencesInput = Partial<Preferences> & {
  accountSyncSeconds?: number;
  aiTagListText?: string;
  aiTagReportSystemPrompt?: string;
};

function cloneDefaultAiTagDefinitions(): AiTagDefinition[] {
  return RUNTIME_DEFAULT_CUSTOM_AI_TAG_DEFINITIONS.map(item => ({ ...item }));
}

function normalizeSyncDateRange(value?: string): Preferences['syncDateRange'] {
  if (value && SYNC_DATE_RANGE_VALUES.includes(value as Preferences['syncDateRange'])) {
    return value as Preferences['syncDateRange'];
  }
  return DEFAULT_PREFERENCES.syncDateRange;
}

function normalizeThemeMode(value?: string): Preferences['themeMode'] {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'light' || normalized === 'dark' || normalized === 'system') {
    return normalized;
  }
  return DEFAULT_PREFERENCES.themeMode;
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

function looksLikeReplacementPlaceholder(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }

  const stripped = normalized.replace(/[\s\n\r\t.,:;!'"()[\]{}\-_/\\|<>`~@#$%^&*+=]+/g, '');
  if (!stripped) {
    return false;
  }

  const placeholderMatches = stripped.match(/[?锛燂拷]/g) || [];
  if (placeholderMatches.length === stripped.length) {
    return true;
  }

  return placeholderMatches.length >= 8 && placeholderMatches.length / stripped.length >= 0.35;
}

function looksLikeMojibake(text: string): boolean {
  const normalized = String(text || '');
  return (
    looksLikeReplacementPlaceholder(normalized) ||
    normalized.includes('浣犳槸') ||
    normalized.includes('鏃ユ姤') ||
    normalized.includes('闃呰浠峰€') ||
    normalized.includes('鍐呭') ||
    normalized.includes('璇疯繑鍥') ||
    normalized.includes('鏌ョ湅姝ｆ枃')
  );
}

function normalizeAiPrompt(value: unknown, fallback: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  const looksCorrupted =
    looksLikeMojibake(normalized) ||
    /\?{6,}/.test(normalized) ||
    /label\s*\?\s*summary/i.test(normalized) ||
    /report_html\s+\?{2,}/i.test(normalized) ||
    normalized.includes('???? AI ???') ||
    normalized.includes('???????');
  return looksCorrupted ? fallback : normalized;
}

function normalizePromptForCompare(value: unknown): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function resolveDefaultAiTagColor(variableOrLabel: unknown): string {
  const source = String(variableOrLabel || '')
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .trim()
    .toLowerCase();

  const matched = [...SYSTEM_AI_TAG_DEFINITIONS, ...RUNTIME_DEFAULT_CUSTOM_AI_TAG_DEFINITIONS].find(item => {
    const variable = item.variable
      .replace(/^\{\{\s*|\s*\}\}$/g, '')
      .trim()
      .toLowerCase();
    const label = item.label.trim().toLowerCase();
    return source === variable || source === label;
  });

  return matched?.color || '#94a3b8';
}

function normalizeAiTagColor(value: unknown, fallback = '#94a3b8'): string {
  const raw = String(value || '').trim();
  const normalized = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (normalized) {
    return `#${normalized[1].toLowerCase()}`;
  }
  return fallback;
}

function normalizeAiTagVariable(value: unknown, fallbackLabel = ''): string {
  const raw = String(value || '').trim();
  const fallback = String(fallbackLabel || '').trim();
  const source = (raw || fallback).replace(/^\{\{\s*|\s*\}\}$/g, '').toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9_\-\s]+/g, ' ')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  if (normalized) {
    return `{{${normalized}}}`;
  }

  const plain = (raw || fallback).replace(/^\{\{\s*|\s*\}\}$/g, '').slice(0, 48);
  return plain ? `{{${plain}}}` : '';
}

function normalizeAiTagDefinition(input: unknown): AiTagDefinition | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Partial<AiTagDefinition>;
  const label = String(source.label || '').trim();
  const description = String(source.description || '').trim();
  const variable = normalizeAiTagVariable(source.variable, label);

  if (!label) {
    return null;
  }

  return {
    label: label.slice(0, 32),
    variable,
    description: description.slice(0, 240),
    color: normalizeAiTagColor(source.color, resolveDefaultAiTagColor(variable || label)),
  };
}

function buildLegacyTagDefinitions(raw: unknown): AiTagDefinition[] {
  const rows = String(raw || '')
    .split(/\r?\n|,|，/)
    .map(item => String(item || '').trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const list: AiTagDefinition[] = [];
  for (const label of rows) {
    const variable = normalizeAiTagVariable('', label);
    if (!variable || seen.has(variable)) {
      continue;
    }
    seen.add(variable);
    list.push({
      label: label.slice(0, 32),
      variable,
      description: '',
      color: resolveDefaultAiTagColor(variable || label),
    });
    if (list.length >= 24) {
      break;
    }
  }
  return list;
}

function shouldReplaceWithDefaultAiTagDefinitions(list: AiTagDefinition[]): boolean {
  if (list.length === 0) {
    return false;
  }

  const variables = list.map(item => normalizeAiTagVariable(item.variable, item.label)).filter(Boolean);
  if (
    variables.length > 0 &&
    variables.every(variable => LEGACY_READING_TAGS.has(variable) || SYSTEM_AI_TAG_VARIABLES.has(variable))
  ) {
    return true;
  }

  return list.some(item => looksLikeMojibake(`${item.label} ${item.description}`));
}

function normalizeAiTagDefinitions(value: unknown, legacyValue: unknown): AiTagDefinition[] {
  const hasExplicitStructuredDefinitions = Array.isArray(value);
  const source = Array.isArray(value) ? value : [];
  const normalizedList = source.map(normalizeAiTagDefinition).filter((item): item is AiTagDefinition => Boolean(item));

  const legacyList = buildLegacyTagDefinitions(legacyValue);
  const fallback =
    normalizedList.length > 0
      ? normalizedList
      : legacyList.length > 0
        ? legacyList
        : hasExplicitStructuredDefinitions
          ? []
          : cloneDefaultAiTagDefinitions();

  const effectiveList = shouldReplaceWithDefaultAiTagDefinitions(fallback) ? cloneDefaultAiTagDefinitions() : fallback;

  const byVariable = new Map<string, AiTagDefinition>();
  for (const item of effectiveList) {
    if (SYSTEM_AI_TAG_VARIABLES.has(item.variable)) {
      continue;
    }
    if (!byVariable.has(item.variable)) {
      byVariable.set(item.variable, {
        ...item,
        color: normalizeAiTagColor(item.color, resolveDefaultAiTagColor(item.variable || item.label)),
      });
    }
    if (byVariable.size >= 24) {
      break;
    }
  }
  return Array.from(byVariable.values());
}

function normalizeAiDailyReportIncludedLabels(value: unknown, customDefinitions: AiTagDefinition[]): string[] {
  const allowed = new Set<string>([
    ...SYSTEM_AI_TAG_DEFINITIONS.map(item => item.variable),
    ...customDefinitions.map(item => item.variable),
  ]);

  const normalized = Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map(item => normalizeAiTagVariable(item))
            .filter(Boolean)
            .filter(item => allowed.has(item))
        )
      )
    : [];

  if (normalized.length > 0) {
    return normalized;
  }

  return DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS.filter(item => allowed.has(item));
}

function isLegacyDefaultAiSummaryPrompt(text: string): boolean {
  const normalized = normalizePromptForCompare(text);
  return (
    looksLikeMojibake(normalized) ||
    normalized === normalizePromptForCompare(LEGACY_DEFAULT_AI_SUMMARY_SYSTEM_PROMPT) ||
    normalized.includes('{{low_signal}}') ||
    normalized.includes('"rating"') ||
    normalized.includes('阅读价值') ||
    normalized.includes('一句话总述')
  );
}

function isLegacyDefaultAiTagPrompt(text: string): boolean {
  const normalized = normalizePromptForCompare(text);
  return (
    looksLikeMojibake(normalized) ||
    normalized === normalizePromptForCompare(LEGACY_DEFAULT_AI_TAG_SYSTEM_PROMPT) ||
    normalized.includes('{{low_signal}}') ||
    normalized.includes('只返回一个标签')
  );
}

function isLegacyDefaultAiDailyReportPrompt(text: string): boolean {
  const normalized = normalizePromptForCompare(text);
  return (
    looksLikeMojibake(normalized) ||
    normalized === normalizePromptForCompare(LEGACY_DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT) ||
    normalized.includes('{{low_signal}}') ||
    normalized.includes('"rating"') ||
    normalized.includes('阅读价值')
  );
}

function normalizeStoredSummaryPrompt(value: unknown): string {
  const normalized = normalizeAiPrompt(value, DEFAULT_PREFERENCES.aiSummarySystemPrompt);
  return isLegacyDefaultAiSummaryPrompt(normalized) ? DEFAULT_PREFERENCES.aiSummarySystemPrompt : normalized;
}

function normalizeStoredTagPrompt(value: unknown, fallback: string): string {
  const normalized = normalizeAiPrompt(value, fallback);
  return isLegacyDefaultAiTagPrompt(normalized) ? DEFAULT_PREFERENCES.aiTagSystemPrompt : normalized;
}

function normalizeStoredDailyPrompt(value: unknown, fallback: string): string {
  const normalized = normalizeAiPrompt(value, fallback);
  return isLegacyDefaultAiDailyReportPrompt(normalized) ? DEFAULT_PREFERENCES.aiDailyReportSystemPrompt : normalized;
}

export function normalizePreferences(input?: PreferencesInput | null): Preferences {
  const source = input || {};
  const syncDelayRange = normalizeSyncDelayRange(source, DEFAULT_PREFERENCES);
  const dailySyncConfig = resolveDailySyncConfig(source);
  const legacyCombinedPrompt = normalizeAiPrompt(source.aiTagReportSystemPrompt, DEFAULT_PREFERENCES.aiTagSystemPrompt);
  const aiTagDefinitions = normalizeAiTagDefinitions(source.aiTagDefinitions, source.aiTagListText);

  return {
    hideDeleted: source.hideDeleted ?? DEFAULT_PREFERENCES.hideDeleted,
    themeMode: normalizeThemeMode(source.themeMode),
    privateProxyList: normalizeProxyList(source.privateProxyList),
    privateProxyAuthorization: String(source.privateProxyAuthorization || '').trim(),
    rsshubBaseUrl: String(source.rsshubBaseUrl || '').trim(),
    newrankCookie: String(source.newrankCookie || '').trim(),
    aiSummaryBaseUrl: String(source.aiSummaryBaseUrl || DEFAULT_PREFERENCES.aiSummaryBaseUrl).trim(),
    aiSummaryApiKey: String(source.aiSummaryApiKey || '').trim(),
    aiSummaryModel: String(source.aiSummaryModel || DEFAULT_PREFERENCES.aiSummaryModel).trim(),
    aiSummarySystemPrompt: normalizeStoredSummaryPrompt(source.aiSummarySystemPrompt),
    aiTagDefinitions,
    aiTagSystemPrompt: normalizeStoredTagPrompt(
      source.aiTagSystemPrompt,
      source.aiTagReportSystemPrompt ? legacyCombinedPrompt : DEFAULT_PREFERENCES.aiTagSystemPrompt
    ),
    aiAutoSummaryOnSyncEnabled: source.aiAutoSummaryOnSyncEnabled ?? DEFAULT_PREFERENCES.aiAutoSummaryOnSyncEnabled,
    aiDailyReportSystemPrompt: normalizeStoredDailyPrompt(
      source.aiDailyReportSystemPrompt,
      source.aiTagReportSystemPrompt ? legacyCombinedPrompt : DEFAULT_PREFERENCES.aiDailyReportSystemPrompt
    ),
    aiDailyReportIncludedLabels: normalizeAiDailyReportIncludedLabels(
      (source as Partial<Preferences>).aiDailyReportIncludedLabels,
      aiTagDefinitions
    ),
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
