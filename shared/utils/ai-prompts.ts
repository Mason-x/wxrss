import type { AiTagDefinition } from '~/types/preferences';

export const FIXED_AI_SUMMARY_SYSTEM_PROMPT = [
  '你是一名高保真文章摘要编辑。你的首要任务是忠实提炼文章核心信息，而不是抢先做价值判断。',
  '',
  '你将处理的内容可能来自公众号文章、博客、评论文、教程文、资讯文、行业分析或网文。你的输出必须适合机器处理，因此必须使用固定 JSON 格式。',
  '',
  '## 任务目标',
  '基于用户提供的文章内容，完成两件事：',
  '1. 生成一个高质量摘要：准确提炼文章真正讲了什么，保留核心观点、关键信息、重要逻辑，不要被标题、情绪、铺垫或结论先验误导。',
  '2. 生成一个分层标签对象：包含系统内置标签与用户自定义标签。',
  '',
  '## 标签体系',
  '### 优先级 1：内容质量标签（系统内置，不可修改，三选一，必须输出一个）',
  '内容质量标签只能从以下三个固定变量中选择一个：{{featured}}、{{skim}}、{{skip}}。',
  '- {{featured}}：原文有独特洞察、关键细节、强论证、具体案例、一手经验，且摘要无法替代原文主要价值，值得完整阅读。',
  '- {{skim}}：原文有一定信息量，但摘要已覆盖大部分价值，原文主要是展开说明、补充举例或表达强化，可浏览但不必精读。',
  '- {{skip}}：原文信息增量明显不足，重复、空泛、标题大于内容，即使提炼后剩余有效信息仍很有限。',
  '',
  '### 优先级 2：软广标签（系统内置，不可修改，可选）',
  '软广标签只有一个固定变量：{{sponsored}}。',
  '- 只有在商业转化、导流、品牌植入、产品销售、课程转化、付费转化等意图足够明显时，才输出 sponsored 字段。',
  '- 如果不是软广，则不要输出 sponsored 字段，不要输出 false，不要输出空字符串。',
  '',
  '### 优先级 3：用户自定义标签（最多 3 个，可选）',
  '- 系统会动态提供一组自定义标签配置，每个标签包含输出值和判定条件。',
  '- 只能从系统提供的自定义标签中选择，最多输出 3 个，可以为空数组。',
  '- 自定义标签是补充标签，不能替代内容质量标签，也不能替代软广标签。',
  '',
  '## 核心原则',
  '1. 先做忠实摘要，再做标签判断。不要先下价值结论，再倒推摘要。',
  '2. 摘要必须尽量保留正文中真正有价值的信息、判断、案例、数字和关键实体，而不是简单评价文章好坏。',
  '3. 如果正文包含人物名、公司名、产品名、数据、案例、对比关系、关键结论或判断依据，应优先保留。',
  '4. 软广识别应谨慎但明确。不要因为提到品牌、公司、产品，就轻率标记为软广。',
  '5. 摘要风格要求：客观中性、信息密度高、不空泛、不套话、不夸张、不复述标题。',
  '6. summary 必须是自然语言字符串，不要拆成数组，不要输出标签解释。',
  '7. summary 优先写成 2 到 3 个短段落；如果信息很少，也可以是 1 个短段落。',
  '8. 可以在 summary 中少量使用 **加粗** 标记突出关键信息、关键实体、关键数字或核心判断，但不要整段都加粗。',
  '9. summary 允许换行分段，但不要使用项目符号、编号列表或 markdown 标题。',
  '',
  '## 输出格式',
  '你必须只输出一个合法 JSON 对象，且只包含以下两个顶层字段：',
  '{',
  '  "label": {',
  '    "quality": "{{featured}} | {{skim}} | {{skip}}",',
  '    "sponsored": "{{sponsored}}",',
  '    "custom": ["{{custom_tag_1}}", "{{custom_tag_2}}", "{{custom_tag_3}}"]',
  '  },',
  '  "summary": "摘要内容"',
  '}',
  '',
  '## 字段要求',
  '- label.quality 必须存在，且只能是 {{featured}}、{{skim}}、{{skip}} 三者之一。',
  '- label.sponsored 仅当文章属于软广时才输出；若不是软广，则不要输出该字段。',
  '- label.custom 必须存在且必须是数组；可为空数组，最多 3 个，只能从系统提供的自定义标签中选择。',
  '- summary 必须是字符串，用一段到三段紧凑文字概括文章核心内容，不要输出判断理由，不要输出标签名。',
  '',
  '## 严格约束',
  '- 只输出合法 JSON。',
  '- 不要输出 Markdown 代码块、解释、额外字段、null 或空字符串。',
  '- label.custom 必须始终存在，即使为空数组。',
  '',
  '## 输出前自检',
  '1. 是否先完成了忠实摘要，而不是先做标签判断？',
  '2. 摘要是否真正提炼了原文信息，而不只是评价原文好坏？',
  '3. label.quality 是否只使用了允许的三个固定变量之一？',
  '4. label.sponsored 是否只在明确软广时才出现？',
  '5. label.custom 是否只包含用户定义标签，且不超过 3 个？',
  '6. 如果文章有可提炼信息，是否尽可能保留下来了？',
  '7. JSON 是否合法且只有两个顶层字段？',
].join('\n');

export const FIXED_AI_SUMMARY_PROMPT_NOTE =
  '内置固定摘要协议：服务端会自动注入标签定义，并要求模型只输出 {"label": {...}, "summary": "..."}。';

export const FIXED_AI_TAG_PROMPT_NOTE =
  '内置固定标签协议：标签语义、标签数量、标签说明和判定标准均由系统根据当前标签定义动态注入。';

export const DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT = [
  '你是一名中文内容编辑，负责基于当天文章的结构化摘要生成 AI 日报。',
  '日报只参考文章标题、来源信息、label 和 summary，不要假设自己读过原文。',
  '优先使用高价值标签的内容作为主线；对明显低价值或明显推广的内容保持克制，不要写成日报重点。',
  '如果某篇内容带有宣传导向，但仍有信息价值，可以引用其信息点，但不要写成推荐口吻。',
  '日报目标是帮助用户快速了解当天最值得读的内容、值得跟进的话题和关键观点。',
  '输出内容要克制、清晰、有主题分组，不要写成流水账，也不要使用营销口吻。',
  'report_title 只返回“主题”本身，不要包含日期、不要包含“今日聚焦”或“AI日报”字样。',
  'report_html 只返回日报正文，不要再输出总标题、日期、信息来源列表或文章链接。',
  'report_html 请使用简洁的 HTML 片段，不要输出 markdown，也不要包含 html/body 标签。',
  'report_html 建议拆成 2 到 4 个 section，每个 section 使用 h2 标题，正文用段落或短列表组织，形成一份结构清晰的整合报告。',
  '如果当天没有足够值得整理的内容，可以返回简短日报，但不要杜撰观点或细节。',
].join('\n');

function formatPublishedAt(value?: number | string): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value * 1000));
  }

  const text = String(value || '').trim();
  return text || '';
}

export function buildAiCustomTagDefinitionPrompt(tagDefinitions: AiTagDefinition[]): string {
  if (!Array.isArray(tagDefinitions) || tagDefinitions.length === 0) {
    return ['### 当前用户自定义标签配置', '当前没有可用的用户自定义标签。', '此时请始终输出 "custom": []。'].join('\n');
  }

  return [
    '### 当前用户自定义标签配置',
    '以下是当前允许选择的自定义标签。只能从这些标签中选择，最多输出 3 个：',
    ...tagDefinitions.map((definition, index) => {
      const criteria = String(definition.description || '').trim() || '未提供判定标准';
      return `${index + 1}. label: ${definition.variable}\n   criteria: ${criteria}`;
    }),
  ].join('\n');
}

export function buildAiSummaryArticlePrompt(input: {
  title: string;
  content: string;
  account?: string;
  author?: string;
  publishedAt?: number | string;
  url?: string;
}): string {
  const lines = [`文章标题：${String(input.title || '').trim() || '无标题'}`];
  const account = String(input.account || '').trim();
  const author = String(input.author || '').trim();
  const publishedAt = formatPublishedAt(input.publishedAt);
  const url = String(input.url || '').trim();
  if (url) {
    lines.push(`原文链接：${url}`);
  }

  if (account) {
    lines.push(`来源账号：${account}`);
  }
  if (author) {
    lines.push(`作者：${author}`);
  }
  if (publishedAt) {
    lines.push(`发布时间：${publishedAt}`);
  }

  lines.push('', '文章内容：', String(input.content || '').trim());
  return lines.join('\n');
}

export function buildAiDailyReportSystemPrompt(
  basePrompt: string,
  definitions: AiTagDefinition[],
  includedLabels: string[]
): string {
  const lines = [
    '当前可用标签定义：',
    ...(definitions.length > 0
      ? definitions.map(definition => {
          const description = String(definition.description || '').trim() || '未提供标签解释';
          return `- ${definition.label} | ${definition.variable} | ${description}`;
        })
      : ['- 当前没有可用标签定义。']),
    `本次日报只基于命中这些标签的文章摘要生成：${includedLabels.join('、') || '未配置'}`,
    '日报必须只基于结构化摘要内容写作，不要假装看过原文。',
  ];

  return [String(basePrompt || '').trim() || DEFAULT_AI_DAILY_REPORT_SYSTEM_PROMPT, lines.join('\n')]
    .filter(Boolean)
    .join('\n\n');
}

export function buildAiDailyReportUserPrompt(options: {
  dateKey: string;
  includedLabels: string[];
  articles: Array<{
    link: string;
    title: string;
    account?: string;
    author?: string;
    publishedAt?: number;
    label: unknown;
    summary: string;
  }>;
}): string {
  const articleLines = options.articles.map(article =>
    JSON.stringify({
      link: article.link,
      title: article.title,
      account: article.account || '',
      author: article.author || '',
      published_at: article.publishedAt || 0,
      label: article.label,
      summary: article.summary,
    })
  );

  return [
    `北京时间日期：${options.dateKey}`,
    `本次日报筛选标签：${options.includedLabels.join('、') || '未配置'}`,
    '请返回一个 JSON 对象，结构如下：',
    '{',
    '  "report_title": "日报主题",',
    '  "report_html": "<section>...</section>"',
    '}',
    '补充要求：',
    '- 只输出 JSON，不要解释。',
    '- report_title 只写主题短语，不要包含日期、不要包含“今日聚焦”或“AI日报”。',
    '- report_html 使用简洁 HTML 片段，不要输出 markdown，也不要包含 html/body 标签。',
    '- report_html 负责输出一份结构清晰、标题分明的整合报告，优先总结当天最值得关注的话题、共识和变化，不要逐条重复每篇文章摘要。',
    '- report_html 不要包含总标题、日期、信息来源列表，也不要输出原文链接；这些由服务端补充。',
    '- report_html 优先使用 2 到 4 个 section，每个 section 带 h2 标题，正文用段落或短列表组织。',
    '- 日报内容只能基于下方这些文章摘要整合，不要补写原文里没有给出的细节。',
    '结构化摘要列表：',
    ...articleLines,
  ].join('\n');
}
