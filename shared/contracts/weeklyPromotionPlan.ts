import type { VideoCreationPlan } from './videoCreationPlan.js';

export interface WeeklyPromotionPlan {
  contentId: string;
  budgetCny: number;
}
const money = (value: unknown): number => Math.max(0, Math.min(1_000_000, Math.round((Number(value) || 0) * 100) / 100));

export function normalizeWeeklyPromotionPlans(
  value: unknown,
  videoPlans: Array<Pick<VideoCreationPlan, 'contentId'>> = [],
): WeeklyPromotionPlan[] {
  if (!Array.isArray(value)) return [];
  const available = new Set(videoPlans.map(item => String(item.contentId || '')).filter(Boolean));
  const seen = new Set<string>();
  return value.flatMap(item => {
    const source = item && typeof item === 'object' ? item as Partial<WeeklyPromotionPlan> : {};
    const contentId = String(source.contentId || '').trim().slice(0, 160);
    const budgetCny = money(source.budgetCny);
    if (!contentId || !available.has(contentId) || seen.has(contentId) || budgetCny <= 0) return [];
    seen.add(contentId);
    return [{ contentId, budgetCny }];
  }).slice(0, 30);
}
