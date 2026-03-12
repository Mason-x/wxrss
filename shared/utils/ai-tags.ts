import type { AiTagDefinition } from '~/types/preferences';

export const BUILTIN_AI_QUALITY_TAG_DEFINITIONS: AiTagDefinition[] = [
  {
    label: '精华',
    variable: '{{featured}}',
    description: '信息密度高、细节关键或论证充分，值得优先阅读全文。',
    color: '#ef4444',
  },
  {
    label: '略读',
    variable: '{{skim}}',
    description: '有一定信息量，但摘要已覆盖主要价值，原文适合快速浏览。',
    color: '#3b82f6',
  },
  {
    label: '不读',
    variable: '{{skip}}',
    description: '信息增量有限、内容重复或标题大于内容，继续阅读收益较低。',
    color: '#64748b',
  },
];

export const BUILTIN_AI_SPONSORED_TAG_DEFINITION: AiTagDefinition = {
  label: '软广',
  variable: '{{sponsored}}',
  description: '存在明显推广、导流、品牌植入或其他商业转化意图时追加该标签。',
  color: '#f59e0b',
};

export const BUILTIN_AI_TAG_DEFINITIONS: AiTagDefinition[] = [
  ...BUILTIN_AI_QUALITY_TAG_DEFINITIONS,
  BUILTIN_AI_SPONSORED_TAG_DEFINITION,
];

export const DEFAULT_AI_DAILY_REPORT_INCLUDED_LABELS = ['{{featured}}'];
