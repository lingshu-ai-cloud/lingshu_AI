import { recommendWeeklyMixedContent, type WeeklyMixedContentSlot } from '../../shared/contracts/weeklyMixedContentPlan.js';
import { SOCIAL_PLATFORM_EXECUTION_RULES } from '../../shared/contracts/socialOperatingProfile.js';
import type { MatrixAccountPlan } from '../../src/lib/weeklyMatrix.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';

/** New default only. An explicitly authored historic or video-only plan is unchanged. */
export function mixedWeeklyRecommendation(input: { goal: WeeklyGoalInput; config: DigitalEmployeeConfig }):
  { rows: MatrixAccountPlan[]; slots: WeeklyMixedContentSlot[] } | null {
  const { goal, config } = input;
  if (goal.businessLine === 'customer_conversion' || goal.videoPlans?.length
    || goal.contentPlatforms.length !== 2
    || !goal.contentPlatforms.includes('facebook') || !goal.contentPlatforms.includes('linkedin')) return null;
  const targets = config.publishingTargets;
  const fb = targets.filter(target => target.platform === 'facebook').slice(0, 2);
  const li = targets.find(target => target.platform === 'linkedin');
  const accountIds: [string, string] = [fb[0]?.accountId || 'planned:facebook:brand_capability:1',
    fb[1]?.accountId || 'planned:facebook:buyer_advisor:2'];
  const linkedinId = li?.accountId || 'planned:linkedin:brand_combined:1';
  const slots = recommendWeeklyMixedContent({ facebookAccountIds: accountIds, linkedinAccountId: linkedinId });
  const productName = config.focusProducts.split(/[、，,；;\n]/).map(value => value.trim()).find(Boolean) || '';
  const rows: MatrixAccountPlan[] = [accountIds[0], accountIds[1], linkedinId].map((accountId, index) => {
    const platform = index === 2 ? 'linkedin' : 'facebook';
    const connected = targets.some(target => target.platform === platform && target.accountId === accountId);
    return {
      accountId, connected, platform,
      accountRole: index === 0 ? 'brand_capability' : index === 1 ? 'buyer_advisor' : 'brand_combined',
      formats: platform === 'linkedin' ? ['image', 'video'] : ['reel', 'product_image'],
      audience: config.customerProfile || '本期目标买家', productName,
      language: config.videoDefaults?.language || 'en', objective: goal.objective,
      contentDirection: platform === 'linkedin' ? '以产品图片与采购证据为主，精选视频轻适配' : '以买家问题与产品证据组织短视频和单图',
      cta: SOCIAL_PLATFORM_EXECUTION_RULES[platform].ctaRule,
      weeklyCount: 5, sourceProjectIds: [],
    };
  });
  return { rows, slots };
}
