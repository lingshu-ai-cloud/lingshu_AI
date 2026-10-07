import type { NextRoundRecommendations, WeeklyReviewSummary } from './digitalEmployees';

export type NextRoundRecommendationKind = 'inherit' | 'tags' | 'trends';

export interface NextRoundRecommendationCard {
  kind: NextRoundRecommendationKind;
  index: string;
  title: string;
  status: 'ready' | 'watch' | 'waiting';
  statusLabel: string;
  conclusion: string;
  evidence: string[];
  systemActions: string[];
  links: Array<{ label: string; url: string; meta: string }>;
}

const safeHttpUrl = (value: unknown): string => {
  const candidate = String(value || '').trim();
  return /^https?:\/\//i.test(candidate) ? candidate : '';
};

function emptyRecommendations(summary?: WeeklyReviewSummary): NextRoundRecommendations {
  const legacy = summary?.nextPlanRecommendations?.filter(Boolean) || [];
  return {
    contentInheritance: {
      status: 'waiting', sourceContentId: '', title: '', platform: '', hook: '', framework: [], tags: [], sourceUrl: '',
      reason: legacy[0] || '等待已发布内容的真实播放、互动与询盘回流。',
      paidBoost: { status: 'not_enough_data', reason: '数据不足时不建议自动追加投放。' },
      systemActions: ['继续回收真实表现；没有证据时不复制某个内容模板'],
    },
    tagAdaptation: {
      status: 'waiting', publishedTags: [], hotTags: [], newTags: [], droppedTags: [], requiresConfirmation: false,
      systemActions: ['等待热门 Tag 基线；没有变化证据时不修改卖点关键词和采集范围'],
    },
    industryTrends: {
      status: 'waiting', signals: [],
      systemActions: ['只接收带原始社媒链接的行业信号，不生成无来源热点结论'],
    },
  };
}

export function buildNextRoundRecommendationCards(summary?: WeeklyReviewSummary): NextRoundRecommendationCard[] {
  const source = summary?.nextRoundRecommendations || emptyRecommendations(summary);
  const inheritance = source.contentInheritance;
  const tags = source.tagAdaptation;
  const trends = source.industryTrends;
  return [
    {
      kind: 'inherit', index: '01', title: '优秀内容继承',
      status: inheritance.status === 'ready' ? 'ready' : 'waiting',
      statusLabel: inheritance.status === 'ready' ? '可进入下一轮' : '等待真实表现',
      conclusion: inheritance.status === 'ready'
        ? `下一轮复用「${inheritance.title || '本期最佳内容'}」的内容框架和首镜钩子，并生成新的表达与镜头组合。`
        : inheritance.reason,
      evidence: inheritance.status === 'ready' ? [
        inheritance.reason,
        inheritance.hook ? `有效钩子：${inheritance.hook}` : '钩子结构等待补齐',
        inheritance.framework.length ? `内容框架：${inheritance.framework.join(' → ')}` : '内容框架等待补齐',
        `追加投放：${inheritance.paidBoost.reason}`,
      ] : [inheritance.paidBoost.reason],
      systemActions: inheritance.systemActions,
      links: safeHttpUrl(inheritance.sourceUrl) ? [{ label: '查看本期优秀内容', url: inheritance.sourceUrl, meta: inheritance.platform }] : [],
    },
    {
      kind: 'tags', index: '02', title: 'Tag 与卖点调整',
      status: tags.status === 'changed' ? 'ready' : tags.status === 'baseline' ? 'watch' : 'waiting',
      statusLabel: tags.status === 'changed' ? '发现变化' : tags.status === 'baseline' ? '已建立基线' : '等待 Tag 数据',
      conclusion: tags.status === 'changed'
        ? '热门 Tag 已发生变化；先形成卖点关键词、采集范围和内容计划候选，确认后再应用。'
        : tags.status === 'baseline'
          ? '本轮已建立热门 Tag 基线；下一轮将对比新增与退出标签。'
          : '尚无可比较的热门 Tag，不会静默修改产品卖点或采集范围。',
      evidence: [
        ...(tags.hotTags.length ? [`本轮热门：${tags.hotTags.slice(0, 8).map(tag => `#${tag}`).join(' ')}`] : []),
        ...(tags.newTags.length ? [`新增：${tags.newTags.slice(0, 8).map(tag => `#${tag}`).join(' ')}`] : []),
        ...(tags.droppedTags.length ? [`退出：${tags.droppedTags.slice(0, 8).map(tag => `#${tag}`).join(' ')}`] : []),
      ],
      systemActions: tags.systemActions,
      links: [],
    },
    {
      kind: 'trends', index: '03', title: '行业热点与变化',
      status: trends.status === 'available' ? 'watch' : 'waiting',
      statusLabel: trends.status === 'available' ? `${trends.signals.length} 条可追溯信号` : '等待可靠来源',
      conclusion: trends.status === 'available'
        ? '以下可追溯社媒信号可直接查看来源，并会作为下一周编导参考；只有连续周期对比后才判断为趋势变化。'
        : '暂未发现带原始链接的行业变化，系统不会用无来源判断影响下一周计划。',
      evidence: trends.signals.slice(0, 3).map(signal => `${signal.platform || '社媒'} · ${signal.summary}`),
      systemActions: trends.systemActions,
      links: trends.signals.slice(0, 3).flatMap(signal => {
        const url = safeHttpUrl(signal.sourceUrl);
        return url ? [{ label: signal.title, url, meta: signal.platform }] : [];
      }),
    },
  ];
}
