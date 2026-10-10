import type { BusinessMetric, ContentQueueItem, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { ConnectedSocialPerformance } from '../../lib/socialPerformance';

export const reviewNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const reviewMetric = (metric?: BusinessMetric): number | null => metric?.status === 'available' ? reviewNumber(metric.value) : null;
export function reviewSum(values: Array<number | null | undefined>): number | null {
  const available = values.filter((value): value is number => reviewNumber(value) !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}
export function reviewDateInRange(value: string, startsAt: string, endsAt: string): boolean {
  const date = value.slice(0, 10);
  return Boolean(date) && (!startsAt || date >= startsAt) && (!endsAt || date <= endsAt);
}

export interface ReviewContentRow {
  id: string; contentId: string; accountId: string; accountLabel: string; platform: string;
  title: string; product: string; caption: string; tags: string[]; date: string; status: ContentQueueItem['status'];
  origin: 'weekly_plan' | 'manual'; estimatedCost: number | null; settledCost: number | null;
  duration: number | null; taskId: string; socialContentTaskId: string; executionItemId: string;
}
export interface ReviewAccountRow {
  id: string; label: string; platform: string; connected: boolean; planned: number;
  contents: ReviewContentRow[]; published: ConnectedSocialPerformance['contents']; publicationSampleAvailable: boolean;
  views: number | null; interactions: number | null; followerCount: number | null;
}

/** Plans exist before execution is enqueued; never derive the inventory only from runtime jobs. */
export function buildReviewContents(data: DigitalEmployeeOverview, selectedAccountId = ''): ReviewContentRow[] {
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const plans = packagePlans.length ? packagePlans : data.goal?.videoPlans || [];
  const queue = data.contentQueue?.items || [];
  const claimed = new Set<string>();
  const accounts = data.plan?.businessPackage?.operatingContext?.accounts || [];
  const label = (id: string) => accounts.find(item => item.accountId === id)?.accountLabel
    || data.config?.publishingTargets.find(item => item.accountId === id)?.accountLabel || '待关联账号';
  const rows: ReviewContentRow[] = plans.map((plan, index) => {
    // A queue item may be attached to exactly one planned publication. Ambiguous title/date matching is not evidence.
    const direct = queue.find(item => !claimed.has(item.id) && Boolean(plan.contentId) && item.contentId === plan.contentId
      && item.platform === plan.platform && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId));
    if (direct) claimed.add(direct.id);
    const accountId = plan.matrix?.accountId || direct?.accountId || `plan-${plan.platform}`;
    return {
      id: direct?.id || `${plan.contentId || 'plan'}:${plan.platform}:${accountId}:${index}`, contentId: plan.contentId || '', accountId,
      accountLabel: direct?.accountLabel || label(accountId), platform: plan.platform,
      title: plan.publication?.title || plan.theme || `计划内容 ${index + 1}`,
      product: plan.productName || direct?.productName || '待绑定产品', caption: plan.publication?.caption || '',
      tags: plan.publication?.tags || [], date: plan.plannedPublishDate || '', status: direct?.status || 'planned',
      origin: 'weekly_plan', estimatedCost: reviewNumber(direct?.estimatedCostCny ?? plan.estimatedCost),
      settledCost: reviewNumber(direct?.settledCostCny), duration: reviewNumber(plan.duration),
      taskId: direct?.taskId || '', socialContentTaskId: direct?.socialContentTaskId || '', executionItemId: direct?.id || '',
    };
  });
  for (const item of queue) {
    if (claimed.has(item.id)) continue;
    rows.push({
      id: item.id, contentId: item.contentId, accountId: item.accountId, accountLabel: item.accountLabel || label(item.accountId),
      platform: item.platform, title: item.title, product: item.productName || '待绑定产品', caption: '', tags: [],
      date: item.plannedPublishDate, status: item.status, origin: item.origin === 'weekly_plan' ? 'weekly_plan' : 'manual',
      estimatedCost: reviewNumber(item.estimatedCostCny), settledCost: reviewNumber(item.settledCostCny), duration: null,
      taskId: item.taskId, socialContentTaskId: item.socialContentTaskId, executionItemId: item.id,
    });
  }
  return rows.filter(item => !selectedAccountId || item.accountId === selectedAccountId);
}

/** A partial refresh cannot replace the last confirmed snapshot with missing rows. */
export function retainReviewPerformance(previous: ConnectedSocialPerformance | null, next: ConnectedSocialPerformance): ConnectedSocialPerformance {
  return next.unavailable.length && previous ? previous : next;
}

export function buildReviewAccounts(data: DigitalEmployeeOverview, performance: ConnectedSocialPerformance | null, selectedAccountId = ''): ReviewAccountRow[] {
  const contents = buildReviewContents(data, selectedAccountId);
  const context = data.plan?.businessPackage?.operatingContext;
  const startsAt = context?.cycle?.startsAt || data.goal?.startsAt || '';
  const endsAt = context?.cycle?.endsAt || data.goal?.endsAt || '';
  const candidates = new Map<string, { id: string; label: string; platform: string }>();
  for (const item of context?.accounts || []) candidates.set(item.accountId, { id: item.accountId, label: item.accountLabel, platform: item.platform });
  for (const item of data.config?.publishingTargets || []) candidates.set(item.accountId, { id: item.accountId, label: item.accountLabel, platform: item.platform });
  for (const item of performance?.accounts || []) candidates.set(item.id, { id: item.id, label: item.title, platform: item.platform });
  for (const item of contents) if (!candidates.has(item.accountId)) candidates.set(item.accountId, { id: item.accountId, label: item.accountLabel, platform: item.platform });
  return [...candidates.values()].filter(item => !selectedAccountId || item.id === selectedAccountId).map(item => {
    const accountContents = contents.filter(content => content.accountId === item.id);
    const published = (performance?.contents || []).filter(content => content.accountId === item.id && reviewDateInRange(content.publishedAt, startsAt, endsAt));
    const account = performance?.accounts.find(candidate => candidate.id === item.id);
    return {
      ...item, connected: Boolean(account),
      planned: accountContents.filter(content => content.origin === 'weekly_plan').length,
      contents: accountContents, published, publicationSampleAvailable: Boolean(account && !performance?.unavailable.some(issue => !issue.accountId || issue.accountId === item.id)), views: reviewSum(published.map(content => content.metrics.views)),
      interactions: reviewSum(published.map(content => reviewSum([content.metrics.likes, content.metrics.comments, content.metrics.shares]))),
      // Metadata parsing in the shared loader substitutes missing counts with 0; do not promote that to verified follower evidence.
      followerCount: account && account.followerCount > 0 ? account.followerCount : null,
    };
  });
}
