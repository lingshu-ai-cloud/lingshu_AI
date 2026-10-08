import type { ContentOrder } from './contentBatchPlan.js';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS } from '../../shared/benchmarkAnalysis.js';

type Row = { id: string; [key: string]: unknown };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim().replace(/^#+/, '')).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim().replace(/^#+/, '')).filter(Boolean);
  } catch { /* A provider may return a comma-delimited tag field. */ }
  return value.split(/[,，\s]+/).map(item => item.trim().replace(/^#+/, '')).filter(Boolean);
};

const publicUrl = (value: unknown): string => {
  const candidate = String(value || '').trim().slice(0, 2_000);
  return /^https?:\/\//i.test(candidate) ? candidate : '';
};

function publicationUrl(post: Row | undefined): string {
  const stats = obj(post?.stats);
  const direct = [post?.permalink, post?.url, post?.sourceUrl, stats.permalink, stats.url]
    .map(publicUrl).find(Boolean);
  if (direct) return direct;
  const publishResults = obj(stats.publishResults || post?.publishResults);
  return Object.values(publishResults).map(obj)
    .flatMap(row => [row.permalink, row.url])
    .map(publicUrl).find(Boolean) || '';
}

export interface NextRoundRecommendations {
  contentInheritance: {
    status: 'ready' | 'waiting';
    sourceContentId: string;
    title: string;
    platform: string;
    hook: string;
    framework: string[];
    tags: string[];
    sourceUrl: string;
    reason: string;
    paidBoost: { status: 'recommended_for_review' | 'not_enough_data'; reason: string };
    systemActions: string[];
  };
  tagAdaptation: {
    status: 'changed' | 'baseline' | 'waiting';
    publishedTags: string[];
    hotTags: string[];
    newTags: string[];
    droppedTags: string[];
    requiresConfirmation: boolean;
    systemActions: string[];
  };
  industryTrends: {
    status: 'available' | 'waiting';
    signals: Array<{
      id: string;
      title: string;
      platform: string;
      summary: string;
      sourceUrl: string;
      observedAt: string;
      tags: string[];
    }>;
    systemActions: string[];
  };
}

/**
 * Build the live industry-signal slice independently from the end-of-week
 * review. Only public HTTP(S) sources are returned so the UI can always link
 * back to real collected evidence.
 */
export function traceableIndustryTrends(trendVideos: Row[]): NextRoundRecommendations['industryTrends'] {
  const signals = trendVideos.flatMap(video => {
    const sourceUrl = publicUrl(video.sourceUrl || video.url);
    if (!sourceUrl) return [];
    const tags = list(video.tags).slice(0, 8);
    const observedAt = String(video.updatedAt || video.updated_at || video.crawledAt || video.createdAt || video.created_at || '');
    const views = String(video.views || obj(video.aiAnalysis).views || '').trim();
    return [{
      id: video.id,
      title: String(video.title || '社媒行业信号').trim().slice(0, 240),
      platform: String(video.platform || '').trim(),
      summary: [views ? `播放 ${views}` : '', tags.length ? `标签：${tags.slice(0, 4).map(tag => `#${tag}`).join(' ')}` : ''].filter(Boolean).join(' · ') || '点击查看原始社媒内容',
      sourceUrl,
      observedAt,
      tags,
    }];
  }).slice(0, 5);
  return {
    status: signals.length ? 'available' : 'waiting',
    signals: signals.slice(0, 3),
    systemActions: signals.length
      ? ['把真实社媒信号写入下一周编导参考池', '仅把有来源链接的热点用于内容方向判断', '热点变化不自动覆盖用户已确认的产品与品牌事实']
      : ['等待可追溯的社媒热点来源，不生成无来源行业结论'],
  };
}

function receipt(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(item => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return ['published', 'partial'].includes(String(row.status || '')) && Boolean(row.postId || row.platformPostId || row.url || row.permalink);
  });
}

export function summarizeContentFeedback(input: {
  orders: ContentOrder[];
  projects: Row[];
  approvals: Row[];
  posts: Row[];
  trendVideos?: Row[];
  previousHotTags?: string[];
}) {
  const projectByOrder = new Map<string, Row>();
  input.projects.forEach(project => {
    const automation = obj(obj(project.spec).automation);
    const orderId = String(automation.contentOrderId || obj(project.spec).contentOrderId || '');
    if (orderId) projectByOrder.set(orderId, project);
  });
  const feedback = input.approvals.filter(item => String(item.decision_note || '').trim()).map(item => ({ decision: String(item.status || ''), note: String(item.decision_note || '').trim() }));
  const items = input.orders.map(order => {
    const project = projectByOrder.get(order.id);
    const post = input.posts.find(item => String(obj(item.stats).sourceProjectId || item.project_id || item.projectId || '') === project?.id);
    const stats = obj(post?.stats);
    const metrics = { views: Number(stats.views || 0), likes: Number(stats.likes || 0), comments: Number(stats.comments || 0), shares: Number(stats.shares || 0), leads: Number(stats.leads || stats.inquiries || 0) };
    const hasPerformance = Object.values(metrics).some(value => value > 0);
    const analysis = order.videoPlan?.benchmarkAnalysis;
    const hookShot = analysis?.shots.find(shot => shot.shotId === analysis.hookShotId);
    const framework = (analysis?.structure || []).slice(0, 8).map(step => `${MATERIAL_TYPE_LABELS[step.materialType]} · ${SHOT_ROLE_LABELS[step.narrativeRole]}`);
    const publishedTags = [...new Set([
      ...(order.videoPlan?.publication?.tags || []),
      ...list(post?.tags),
      ...list(stats.tags),
    ])].slice(0, 20);
    return {
      orderId: order.id, projectId: project?.id || '', route: order.route, platform: order.platform, productId: order.productId,
      title: order.videoPlan?.publication?.title || order.theme?.label || order.productName || order.id,
      productName: order.productName,
      hook: order.videoPlan?.preproduction?.benchmark.hook || hookShot?.purpose || hookShot?.onScreenText || order.videoPlan?.buyerProblem || '',
      framework,
      publishedTags,
      sourceUrl: publicationUrl(post),
      productionStatus: project ? String(project.status || 'draft') : 'pending',
      publicationStatus: post && (String(post.platform_post_id || '') || receipt(stats.publishResults || post.publishResults)) ? 'published' : 'not_published',
      performance: hasPerformance ? { status: 'available', ...metrics } : { status: 'pending', ...metrics },
    };
  });
  const routeCounts = items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.route]: (acc[item.route] || 0) + 1 }), {});
  const performanceScore = (item: typeof items[number]) => item.performance.views
    + item.performance.likes * 4 + item.performance.comments * 8 + item.performance.shares * 12 + item.performance.leads * 25;
  const top = items.filter(item => item.performance.status === 'available').sort((a, b) => performanceScore(b) - performanceScore(a))[0];

  const industryTrends = traceableIndustryTrends(input.trendVideos || []);
  const trendSignals = industryTrends.signals;
  const tagCounts = trendSignals.flatMap(signal => signal.tags).reduce<Record<string, number>>((acc, tag) => {
    const key = tag.toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const hotTags = Object.entries(tagCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([tag]) => tag);
  const previousHotTags = [...new Set((input.previousHotTags || []).map(tag => tag.toLowerCase()))];
  const newTags = previousHotTags.length ? hotTags.filter(tag => !previousHotTags.includes(tag)) : [];
  const droppedTags = hotTags.length ? previousHotTags.filter(tag => !hotTags.includes(tag)) : [];
  const publishedTags = [...new Set(items.flatMap(item => item.publishedTags).map(tag => tag.toLowerCase()))].slice(0, 12);
  const paidBoostEligible = Boolean(top && (top.performance.leads > 0
    || top.performance.shares >= 5
    || (top.performance.views >= 1_000 && (top.performance.likes + top.performance.comments + top.performance.shares) / top.performance.views >= 0.03)));

  const nextRoundRecommendations: NextRoundRecommendations = {
    contentInheritance: top ? {
      status: 'ready', sourceContentId: top.orderId, title: top.title, platform: top.platform,
      hook: top.hook, framework: top.framework, tags: top.publishedTags, sourceUrl: top.sourceUrl,
      reason: `本期综合表现最高：${top.performance.views} 播放、${top.performance.likes} 赞、${top.performance.comments} 评论、${top.performance.shares} 分享、${top.performance.leads} 条询盘。`,
      paidBoost: {
        status: paidBoostEligible ? 'recommended_for_review' : 'not_enough_data',
        reason: top.performance.leads > 0
          ? '已有询盘回流，可在预算内追加小额投放测试。'
          : paidBoostEligible
            ? '互动质量达到测试门槛，可在核对归因和预算后追加小额投放。'
            : '当前仅能确认相对领先，互动质量尚未达到追加投放建议门槛。',
      },
      systemActions: ['下一周选题优先复用该内容框架与首镜钩子', '保留产品事实，生成新的表达与镜头组合，避免原片重复', '追加投放只形成待确认建议，不会自动消耗预算'],
    } : {
      status: 'waiting', sourceContentId: '', title: '', platform: '', hook: '', framework: [], tags: [], sourceUrl: '',
      reason: '尚无已回流的真实内容表现，系统不会虚构优秀内容。',
      paidBoost: { status: 'not_enough_data', reason: '等待播放、互动或询盘数据后再判断是否追加投放。' },
      systemActions: ['继续回收真实播放、互动与询盘数据', '数据不足时维持现有内容分配，不自动放大单一模板'],
    },
    tagAdaptation: {
      status: hotTags.length ? (previousHotTags.length ? (newTags.length || droppedTags.length ? 'changed' : 'baseline') : 'baseline') : 'waiting',
      publishedTags, hotTags, newTags, droppedTags,
      requiresConfirmation: Boolean(newTags.length || droppedTags.length),
      systemActions: hotTags.length ? [
        '将新增热门 Tag 作为产品卖点关键词候选',
        '将 Tag 变化写入下一轮采集范围候选',
        '编导 Agent 在下一周内容计划中验证新旧关键词，不直接改写已确认产品事实',
      ] : ['等待真实热门 Tag 回流，不根据空数据调整卖点关键词或采集范围'],
    },
    industryTrends,
  };
  const nextPlanRecommendations = [
    top ? `优秀内容继承：下周优先复用「${top.title}」的内容框架与钩子，并生成新的表达和镜头组合` : '内容表现数据尚未回流，下周保持可用路径均衡并继续收集真实表现',
    newTags.length ? `热门 Tag 变化：验证 ${newTags.slice(0, 5).map(tag => `#${tag}`).join(' ')} 对卖点关键词、采集范围和内容计划的影响` : hotTags.length ? `热门 Tag 基线：持续观察 ${hotTags.slice(0, 5).map(tag => `#${tag}`).join(' ')}` : '热门 Tag 数据尚未回流，不调整卖点关键词或采集范围',
    trendSignals.length ? `行业信号：下一周编导参考 ${trendSignals.slice(0, 2).map(signal => signal.title).join('；')}` : '行业热点缺少可追溯来源，暂不写入下一周内容方向',
    feedback.length ? `下周内容订单需应用 ${feedback.length} 条人工审批反馈` : '尚无人工审批修改意见，不生成虚构优化结论',
  ];
  return { items, routeCounts, approvalFeedback: feedback, nextPlanRecommendations, nextRoundRecommendations };
}
