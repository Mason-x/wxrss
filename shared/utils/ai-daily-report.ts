export const DEFAULT_AI_DAILY_REPORT_TOPIC = '当日要点';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTopicSeparators(value: string): string {
  return value.replace(/^[\s|｜:：\-]+/u, '').replace(/[\s|｜:：\-]+$/u, '').trim();
}

export function normalizeAiDailyReportTopic(title: string, reportDate = ''): string {
  let normalized = String(title || '').trim();
  const dateText = String(reportDate || '').trim();

  if (!normalized) {
    return DEFAULT_AI_DAILY_REPORT_TOPIC;
  }

  if (dateText) {
    normalized = normalized.replace(
      new RegExp(`^${escapeRegExp(dateText)}(?:\\s*[|｜:：-]\\s*|\\s+)`, 'u'),
      ''
    );
  }

  normalized = normalized
    .replace(/^(今日聚焦|AI日报|AI 日报)\s*[|｜:：-]?\s*/u, '')
    .replace(/\s*(AI日报|AI 日报)\s*$/u, '');

  normalized = trimTopicSeparators(normalized);

  return normalized || DEFAULT_AI_DAILY_REPORT_TOPIC;
}

export function formatAiDailyReportListTitle(reportDate: string, title: string): string {
  const dateText = String(reportDate || '').trim();
  const topic = normalizeAiDailyReportTopic(title, dateText);
  return dateText ? `${dateText}｜${topic}` : topic;
}

export function formatAiDailyReportDisplayTitle(title: string, reportDate = ''): string {
  return `今日聚焦｜${normalizeAiDailyReportTopic(title, reportDate)}`;
}
