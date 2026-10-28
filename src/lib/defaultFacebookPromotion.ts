import type { WeeklyPromotionPlan } from '../../shared/contracts/weeklyPromotionPlan';

/** Planning assumption only: US$5 per Facebook content × ¥7.2/US$. Actual ad spend is platform-reported. */
export const DEFAULT_FACEBOOK_PROMOTION_CNY = 36;

export function defaultFacebookPromotionPlans(plans: Array<{ contentId?: string; platform: string }>): WeeklyPromotionPlan[] {
  return plans.flatMap(plan => plan.platform === 'facebook' && plan.contentId
    ? [{ contentId: plan.contentId, budgetCny: DEFAULT_FACEBOOK_PROMOTION_CNY }] : []);
}
