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

const LEGACY_DEFAULT_TAG_VARIABLES = new Set(['{{featured}}', '{{skim}}', '{{skip}}', '{{sponsored}}']);

export const DEFAULT_AI_TAG_DEFINITIONS: AiTagDefinition[] = [
  {
    label: '精华',
    variable: '{{featured}}',
    description: '有独特洞察、关键细节、案例或数据支撑，信息密度高，值得优先阅读全文并进入日报。',
    color: '#ef4444',
  },
  {
    label: '略读',
    variable: '{{skim}}',
    description: '有一定信息量，但摘要已覆盖大部分价值，可快速浏览原文，无需精读。',
    color: '#3b82f6',
  },
  {
    label: '不读',
    variable: '{{skip}}',
    description: '信息密度低、结构松散、标题大于内容或重复铺陈，继续读原文的收益很低。',
    color: '#64748b',
  },
  {
    label: '软广',
    variable: '{{sponsored}}',
    description: '存在明显推广、导流、品牌植入、产品销售或付费转化意图，应单独标记为宣传内容。',
    color: '#f59e0b',
  },
];

export const DEFAULT_AI_SUMMARY_SYSTEM_PROMPT = [
  '你是一名高信噪比的信息摘要编辑，擅长从公众号文章、博客、网文、评论文、教程文、资讯文、观点文中，快速提炼“这篇文章到底讲了什么”以及“值不值得读原文”。',
  '',
  '你的任务不是机械压缩原文，而是做高质量的信息筛选、观点提炼与阅读优先级判断。',
  '',
  '## 核心目标',
  '请基于用户提供的文章内容，输出一份短、准、清晰、可结构化处理、便于 30 秒判断阅读价值的摘要，帮助用户：',
  '1. 快速了解文章在讲什么；',
  '2. 抓住真正的核心观点，而不是表面铺陈；',
  '3. 判断这篇文章是否值得读原文；',
  '4. 提炼可传播的信息价值；',
  '5. 识别低信息密度内容与伪装成内容的宣传性内容。',
  '',
  '## 工作原则',
  '### 1) 先识别文章类型，再决定摘要重点',
  '- 观点文 / 评论文：重点提炼作者的核心判断、立场、关键论据。',
  '- 资讯文 / 新闻整合文：重点提炼核心事实、主要变化、真正重要的信息点。',
  '- 教程文 / 方法文：重点提炼问题、方法、步骤逻辑、适用场景。',
  '- 叙事文 / 故事型文章：重点提炼故事主线、作者真正想表达的主题或观点，而不是流水账。',
  '- 知识科普文：重点提炼核心概念、关键解释、结论与实际意义。',
  '- 商业 / 行业分析文：重点提炼核心结论、判断依据、对谁有影响。',
  '',
  '### 2) 摘要不是复述',
  '不要按原文顺序机械缩写，不要照搬段落结构，不要把细枝末节堆成摘要。',
  '要优先回答：',
  '- 这篇文章核心在讲什么？',
  '- 作者真正的观点或结论是什么？',
  '- 支撑这个观点的关键信息是什么？',
  '- 用户还有没有必要去读原文？',
  '',
  '### 3) 阅读价值必须输出为固定变量标签',
  '你需要明确给出阅读价值判断，但必须基于文章的信息密度、观点独特性、论据质量、细节含量、案例价值、原文必要性与宣传意图来判断，不能空泛评价。',
  '',
  'tags 数组必须满足：',
  '- 至少 1 个，最多 2 个；',
  '- {{featured}}、{{skim}}、{{skip}} 三者互斥，只能出现一个主阅读价值标签；',
  '- {{sponsored}} 可以与主标签同时出现；',
  '- 不要输出中文标签名。',
  '',
  '### 4) 判断时要识别“内容价值”与“商业意图”',
  '请特别区分：',
  '- 这是在提供信息，还是在借信息包装推广？',
  '- 这是在真分析，还是在为某产品 / 服务建立购买理由？',
  '- 这是内容中顺带提到品牌，还是全文叙事本身就在服务转化？',
  '',
  '若商业转化意图明显，优先追加 {{sponsored}}。',
  '',
  '### 5) 保持客观、知识型、条理强',
  '整体语气要求：客观中性、表达简洁、结构清晰、有判断、有洞察、不夸张、不鸡汤、不卖弄、不替作者过度脑补。',
  '',
  '### 6) 尽量短，但不能丢核心信息',
  '优先高信息密度表达。宁可删掉修饰，也不要漏掉核心观点。避免输出过长内容。',
  '',
  '## 输出格式',
  '你必须只输出一个合法 JSON 对象，不得输出任何前言、解释、Markdown 代码块、注释或额外文字。',
  '',
  '{',
  '  "tags": ["{{featured}}"],',
  '  "summary": "一句话总述",',
  '  "highlights": [',
  '    "要点1",',
  '    "要点2",',
  '    "要点3"',
  '  ]',
  '}',
  '',
  '## 字段要求',
  '- tags：数组类型，包含 1 到 2 个变量标签；若存在明显商业转化意图，可输出类似 ["{{featured}}", "{{sponsored}}"]。',
  '- summary：用 1 句话概括这篇文章到底在讲什么，必须直击主题，不能空泛。',
  '- highlights：数组类型，包含 1 到 3 条核心要点；如果文章信息量低，可少于 3 条，但不得为空。',
  '- 每条 highlights 都应只保留真正重要的信息，不要写废话，不要重复 summary。',
  '- 如果标题党明显，要以正文真实重点为准，不要被标题带偏。',
  '- 如果作者真正观点隐藏在大量铺垫之后，要直接提炼出来。',
  '- 如果文章主要是情绪表达、观点重复、信息增量很低，要如实反映。',
  '- 若存在明显推广、导流、品牌植入、产品转化、课程销售、社群引流、付费订阅转化等倾向，要优先追加 {{sponsored}}。',
  '',
  '## 严格约束',
  '- 只输出合法 JSON。',
  '- 不要输出判断理由。',
  '- 不要输出字段说明。',
  '- 不要输出 Markdown。',
  '- 不要输出多余无关内容。',
  '- 不要使用未定义字段。',
  '- 不要把 JSON 包在代码块中。',
  '- 不要输出 null。',
  '- 不要输出空数组。',
].join('\n');

export const DEFAULT_AI_TAG_SYSTEM_PROMPT = [
  '这是对标签判定的补充规则，会和摘要系统提示词一起发送给模型。',
  'tags 最多输出两个。',
  '{{featured}}、{{skim}}、{{skip}} 三者互斥，只能保留一个最合适的主阅读价值标签。',
  '如果商业转化意图足够明显，可以在主标签之外追加 {{sponsored}}。',
  '不要为了凑双标签而强行输出两个标签；如果没有明显商业意图，只输出一个主标签即可。',
].join('\n');

export const DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT = [
  '你是一名中文内容编辑，负责基于当天文章的结构化摘要生成 AI 日报。',
  '日报只参考文章标题、来源信息、tags、summary 和 highlights，不要假设你看过原文。',
  '优先使用带 {{featured}} 的内容作为主线，可少量引用 {{skim}} 做背景补充。',
  '默认不要把 {{skip}} 写成重点，也不要把纯 {{sponsored}} 内容写成日报主线。',
  '如果某篇内容同时带有 {{featured}} 和 {{sponsored}}，可以引用其信息价值，但要保持克制，不要写成推荐口吻。',
  '日报要帮助用户快速了解当天最值得读的内容、值得跟进的话题、关键观点和可执行信息。',
  '输出内容要克制、清晰、有主题分组，不要写成流水账，也不要有夸张措辞或广告腔。',
  'report_html 请使用简洁的 HTML 片段，不要输出 markdown，也不要包含 html/body 标签。',
].join('\n');

export const DEFAULT_PREFERENCES: Preferences = {
  hideDeleted: true,
  privateProxyList: [],
  privateProxyAuthorization: '',
  rsshubBaseUrl: '',
  newrankCookie: '',
  aiSummaryBaseUrl: 'https://api.openai.com/v1',
  aiSummaryApiKey: '',
  aiSummaryModel: 'gpt-4.1-mini',
  aiSummarySystemPrompt: DEFAULT_AI_SUMMARY_SYSTEM_PROMPT,
  aiTagDefinitions: DEFAULT_AI_TAG_DEFINITIONS.map(item => ({ ...item })),
  aiTagSystemPrompt: DEFAULT_AI_TAG_SYSTEM_PROMPT,
  aiDailyReportSystemPrompt: DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT,
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
  return DEFAULT_AI_TAG_DEFINITIONS.map(item => ({ ...item }));
}

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

function looksLikeMojibake(text: string): boolean {
  return /[濠电偠鎻紞浣割嚕娴煎瓨鍋ｉ柛銉墯閺咁剟姊洪棃娑欘棏闁稿鎹囬、姘舵偠閻愬瓨濯撮柣妯挎珪绗戦柣鐘叉川閺屽娆㈤銏犵婵炶揪缍佸浼存偣閸ヮ剚鏅梺闈涙閸嬫捇顢氶悶鐎匽]/.test(text);
}

function normalizeAiPrompt(value: unknown, fallback: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  return looksLikeMojibake(normalized) ? fallback : normalized;
}

function resolveDefaultAiTagColor(variableOrLabel: unknown): string {
  const source = String(variableOrLabel || '')
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .trim()
    .toLowerCase();

  const matched = DEFAULT_AI_TAG_DEFINITIONS.find(item => {
    const variable = item.variable.replace(/^\{\{\s*|\s*\}\}$/g, '').trim().toLowerCase();
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
  const source = (raw || fallback)
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9_\-\s]+/g, ' ')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  if (normalized) {
    return `{{${normalized}}}`;
  }

  const plain = (raw || fallback)
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .slice(0, 48);
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
    if (seen.has(variable)) {
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

  if (list.some(item => looksLikeMojibake(`${item.label} ${item.description}`))) {
    return true;
  }

  const variables = new Set(list.map(item => normalizeAiTagVariable(item.variable, item.label)).filter(Boolean));

  return (
    variables.size === LEGACY_DEFAULT_TAG_VARIABLES.size
    && Array.from(LEGACY_DEFAULT_TAG_VARIABLES).every(variable => variables.has(variable))
  );
}

function normalizeAiTagDefinitions(value: unknown, legacyValue: unknown): AiTagDefinition[] {
  const hasExplicitStructuredDefinitions = Array.isArray(value);
  const source = Array.isArray(value) ? value : [];
  const normalizedList = source
    .map(normalizeAiTagDefinition)
    .filter((item): item is AiTagDefinition => Boolean(item));

  const legacyList = buildLegacyTagDefinitions(legacyValue);
  const fallback = normalizedList.length > 0
    ? normalizedList
    : legacyList.length > 0
      ? legacyList
      : hasExplicitStructuredDefinitions
        ? []
        : cloneDefaultAiTagDefinitions();

  const effectiveList = shouldReplaceWithDefaultAiTagDefinitions(fallback)
    ? cloneDefaultAiTagDefinitions()
    : fallback;

  const byVariable = new Map<string, AiTagDefinition>();
  for (const item of effectiveList) {
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

function isLegacyDefaultAiSummaryPrompt(text: string): boolean {
  return (
    text.includes('"rating"')
    || text.includes('{{low_signal}}')
    || (text.includes('核心要点') && !text.includes('"tags"'))
    || looksLikeMojibake(text)
  );
}

function isLegacyDefaultAiTagPrompt(text: string): boolean {
  return text.includes('{{low_signal}}') || text.includes('只能返回一个') || looksLikeMojibake(text);
}

function isLegacyDefaultAiDailyReportPrompt(text: string): boolean {
  return text.includes('{{low_signal}}') || text.includes('"rating"') || looksLikeMojibake(text);
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
  const legacyCombinedPrompt = normalizeAiPrompt(
    source.aiTagReportSystemPrompt,
    DEFAULT_PREFERENCES.aiTagSystemPrompt
  );

  return {
    hideDeleted: source.hideDeleted ?? DEFAULT_PREFERENCES.hideDeleted,
    privateProxyList: normalizeProxyList(source.privateProxyList),
    privateProxyAuthorization: String(source.privateProxyAuthorization || '').trim(),
    rsshubBaseUrl: String(source.rsshubBaseUrl || '').trim(),
    newrankCookie: String((source as any).newrankCookie || '').trim(),
    aiSummaryBaseUrl: String(source.aiSummaryBaseUrl || DEFAULT_PREFERENCES.aiSummaryBaseUrl).trim(),
    aiSummaryApiKey: String(source.aiSummaryApiKey || '').trim(),
    aiSummaryModel: String(source.aiSummaryModel || DEFAULT_PREFERENCES.aiSummaryModel).trim(),
    aiSummarySystemPrompt: normalizeStoredSummaryPrompt(source.aiSummarySystemPrompt),
    aiTagDefinitions: normalizeAiTagDefinitions((source as any).aiTagDefinitions, source.aiTagListText),
    aiTagSystemPrompt: normalizeStoredTagPrompt(
      (source as any).aiTagSystemPrompt,
      source.aiTagReportSystemPrompt ? legacyCombinedPrompt : DEFAULT_PREFERENCES.aiTagSystemPrompt
    ),
    aiDailyReportSystemPrompt: normalizeStoredDailyPrompt(
      (source as any).aiDailyReportSystemPrompt,
      source.aiTagReportSystemPrompt ? legacyCombinedPrompt : DEFAULT_PREFERENCES.aiDailyReportSystemPrompt
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
