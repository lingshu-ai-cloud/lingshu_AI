import type { ContentQueueItem } from './digitalEmployees';
import type { VideoCreationPlan } from './videoCreationPlan';

export function productionQueueItemForPlan(plan: VideoCreationPlan | undefined, items: ContentQueueItem[]): ContentQueueItem | null {
  if (!plan?.contentId) return null;
  const matches = items.filter(item => item.contentId === plan.contentId && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId));
  return matches.length === 1 ? matches[0]! : null;
}
