import type { MatrixAccountPlan, MatrixAccountReview } from '../../src/lib/weeklyMatrix.js';

type Row = { id: string; [key: string]: unknown };
function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
const metric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = (values: Array<number | null>): number | null => values.length && values.every(value => value !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;

/** Input is already tenant/run scoped. Never attribute a grouped post's metrics to every account. */
export function summarizeWeeklyMatrix(rows: MatrixAccountPlan[], projects: Row[], posts: Row[], publishingExpected = true): MatrixAccountReview[] {
  return rows.map(row => {
    const ownProjects = projects.filter(project => object(object(project.spec).contentOrder).videoPlan?.matrix?.accountId === row.accountId || row.sourceProjectIds.includes(project.id));
    const produced = new Set(ownProjects.filter(project => {
      const automation = object(object(project.spec).automation);
      return automation.managedBy === 'digital_employee' ? automation.stage === 'completed' && automation.quality?.passed === true && Boolean(automation.renderOutputPath) : ['completed', 'published'].includes(String(project.status));
    }).map(project => project.id)).size;
    const projectIds = new Set(ownProjects.map(project => project.id));
    const receipts = new Map<string, { views: number | null; interactions: number | null; inquiries: number | null }>();
    for (const post of posts) {
      const stats = object(post.stats);
      if (post.platform !== row.platform || !projectIds.has(String(stats.sourceProjectId || post.content_id || ''))) continue;
      const targets = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds : [];
      if (!targets.includes(row.accountId)) continue;
      const result = object(object(stats.publishResults)[row.accountId]);
      const receiptId = String(result.platformPostId || result.postId || result.url || result.permalink || (targets.length === 1 ? post.platform_post_id || '' : ''));
      if (!receiptId || !['published', 'partial'].includes(String(result.status || stats.status))) continue;
      const values = targets.length === 1 ? stats : object(result.metrics);
      receipts.set(receiptId, { views: metric(values.views), interactions: sum([metric(values.likes), metric(values.comments), metric(values.shares)]),
        inquiries: targets.length === 1 ? metric(stats.inquiries ?? stats.leads ?? (post.wa_link ? post.inquiries : undefined)) : metric(values.inquiries) });
    }
    const values = [...receipts.values()];
    const views = sum(values.map(value => value.views));
    const inquiries = sum(values.map(value => value.inquiries));
    const recommendation = !publishingExpected ? produced < row.weeklyCount ? `先补齐本周尚未成片的 ${row.weeklyCount - produced} 条内容。` : '本周制作安排已完成；下周核对内容质量与账号方向后再安排制作。'
      : values.length < row.weeklyCount ? `先补齐本周未交付的 ${Math.max(0, row.weeklyCount - values.length)} 条内容，核对制作与发布阻塞。`
      : inquiries !== null && inquiries > 0 ? '保留本周账号定位和有效内容方向，核对询盘质量后调整下周条数。'
      : views === null || inquiries === null ? '表现数据尚未完整回流，先补齐曝光与询盘归因，再调整下周计划。'
      : '结合曝光与询盘检查内容方向和行动引导，修订下周主题后再执行。';
    return { accountId: row.accountId, platform: row.platform, planned: row.weeklyCount, produced, published: receipts.size,
      views, interactions: sum(values.map(value => value.interactions)), inquiries, recommendation };
  });
}
