import { day as shanghaiDay } from '../../shared/mobile-domain.mjs';
import { socialOperatingProfile } from '../../shared/contracts/socialOperatingProfile';
import { weeklyPublishingPlatforms } from '../../shared/contracts/weeklyPublishingTargets';
import { buildPresetMatrixVideoPlans, weeklyTaskPackagePreset, type WeeklyTaskPackagePresetId } from './weeklyTaskPackagePresets';
import { defaultMatrixPlan } from './weeklyMatrix';
import type { BusinessLine, ContentPlatform, DigitalEmployeeConfig, WeeklyGoal } from './digitalEmployees';

export type GoalDraft = Omit<WeeklyGoal, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

export function isoDay(offset: number): string {
  return shanghaiDay(new Date(Date.now() + offset * 86_400_000).toISOString());
}

export const EMPTY_GOAL: GoalDraft = {
  businessLine: 'full_funnel',
  contentPlatforms: ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'],
  title: '本周内容增长目标',
  objective: '形成一组面向目标市场、证据充分且可进入审批的内容执行包',
  metric: 'approved_content_packages', baseline: 0, target: 5, unit: '项',
  startsAt: isoDay(0), endsAt: isoDay(6), scope: '', constraints: ['对外发布必须审批'],
};

export function defaultWeeklyGoal(config: DigitalEmployeeConfig, businessLine: BusinessLine = 'full_funnel', contentPlatform: ContentPlatform = 'all') {
  const targetPlatforms = weeklyPublishingPlatforms(config.publishingTargets, config.socialCadence);
  const configuredPlatforms = targetPlatforms.length
    ? targetPlatforms
    : [...new Set(socialOperatingProfile(config.socialOperatingProfile).accounts.map(account => account.platform))];
  const initialPlatforms = contentPlatform !== 'all' && configuredPlatforms.includes(contentPlatform)
    ? [contentPlatform]
    : config.enabledWorkflows.includes('content_publish') ? configuredPlatforms : [configuredPlatforms[0]].filter(Boolean);
  const presetId: WeeklyTaskPackagePresetId = config.operatingMaturity === 'starting' ? 'b2b_starting' : 'b2b_growing';
  const preset = weeklyTaskPackagePreset(presetId);
  const presetPlatforms = preset.platforms.filter(platform => configuredPlatforms.includes(platform));
  const platforms = presetPlatforms.length ? presetPlatforms : initialPlatforms;
  const product = config.focusProducts.split(/[、，,；;\n]/).map(item => item.trim()).filter(Boolean)[0] || '';
  const videoPlans = businessLine === 'customer_conversion' ? [] : buildPresetMatrixVideoPlans({
    preset, productName: product, focus: '', defaults: config.videoDefaults, platforms,
    matrixRows: defaultMatrixPlan(config, platforms, preset.objective),
  });
  const target = ['approved_content_packages', 'published_posts'].includes(preset.metric) ? videoPlans.length : preset.weeklyOutput;
  const draft: GoalDraft = {
    ...EMPTY_GOAL,
    startsAt: isoDay(0), endsAt: isoDay(6), businessLine,
    videoPlans,
    contentPlatforms: businessLine === 'customer_conversion' ? initialPlatforms : platforms,
    title: businessLine === 'customer_conversion' ? '本周客户转化目标' : `${preset.label}周任务包`,
    objective: businessLine === 'customer_conversion' ? '提升高意向客户的报价、跟进与成交转化' : preset.objective,
    metric: businessLine === 'customer_conversion' ? 'qualified_inquiries' : preset.metric,
    target: businessLine === 'customer_conversion' ? 1 : target,
    unit: businessLine === 'customer_conversion' ? '位' : '条',
    scope: config.targetMarkets,
  };
  return { draft, configuredPlatforms, initialPlatforms, presetId, preset, product };
}
