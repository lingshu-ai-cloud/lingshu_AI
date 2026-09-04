import type { ContentOrder } from './contentBatchPlan.js';

type Row = { id: string; [key: string]: unknown };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

function receipt(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(item => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return ['published', 'partial'].includes(String(row.status || '')) && Boolean(row.postId || row.platformPostId || row.url || row.permalink);
  });
}

export function summarizeContentFeedback(input: { orders: ContentOrder[]; projects: Row[]; approvals: Row[]; posts: Row[] }) {
  const projectByOrder = new Map<string, Row>();
  input.projects.forEach(project => {
    const automation = obj(obj(project.spec).automation);
    const orderId = String(automation.contentOrderId || obj(project.spec).contentOrderId || '');
    if (orderId) projectByOrder.set(orderId, project);
  });
  const feedback = input.approvals.filter(item => String(item.decision_note || '').trim()).map(item => ({ decision: String(item.status || ''), note: String(item.decision_note || '').trim() }));
  const items = input.orders.map(order => {
    const project = projectByOrder.get(order.id);
    const post = input.posts.find(item => String(obj(item.stats).sourceProjectId || '') === project?.id);
    const stats = obj(post?.stats);
    const metrics = { views: Number(stats.views || 0), likes: Number(stats.likes || 0), comments: Number(stats.comments || 0), shares: Number(stats.shares || 0), leads: Number(stats.leads || stats.inquiries || 0) };
    const hasPerformance = Object.values(metrics).some(value => value > 0);
    return {
      orderId: order.id, projectId: project?.id || '', route: order.route, platform: order.platform, productId: order.productId,
      productionStatus: project ? String(project.status || 'draft') : 'pending',
      publicationStatus: post && (String(post.platform_post_id || '') || receipt(stats.publishResults || post.publishResults)) ? 'published' : 'not_published',
      performance: hasPerformance ? { status: 'available', ...metrics } : { status: 'pending', ...metrics },
    };
  });
  const routeCounts = items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.route]: (acc[item.route] || 0) + 1 }), {});
  const top = items.filter(item => item.performance.status === 'available').sort((a, b) => (b.performance.views + b.performance.likes + b.performance.comments + b.performance.shares + b.performance.leads) - (a.performance.views + a.performance.likes + a.performance.comments + a.performance.shares + a.performance.leads))[0];
  const nextPlanRecommendations = [
    top ? `下周优先保留 ${top.route} 路径与 ${top.platform} 平台的有效组合` : '内容表现数据尚未回流，下周保持可用路径均衡并继续收集真实表现',
    feedback.length ? `下周内容订单需应用 ${feedback.length} 条人工审批反馈` : '尚无人工审批修改意见，不生成虚构优化结论',
  ];
  return { items, routeCounts, approvalFeedback: feedback, nextPlanRecommendations };
}
