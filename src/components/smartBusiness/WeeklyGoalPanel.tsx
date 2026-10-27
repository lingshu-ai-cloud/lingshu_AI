import { useEffect, useRef, useState } from 'react';
import { Button, InputNumber, Select, Steps } from 'antd';
import { Check, Megaphone, Plus, Trash2, Video } from 'lucide-react';
import { day as shanghaiDay } from '../../../shared/mobile-domain.mjs';
import { socialOperatingProfile } from '../../../shared/contracts/socialOperatingProfile';
import { weeklyPublishingPlatforms } from '../../../shared/contracts/weeklyPublishingTargets';
import { MASTER_VIDEO_COST_MAX_CNY, MASTER_VIDEO_COST_MIN_CNY } from '../../../shared/contracts/contentCostModel';
import { scheduleWeeklyVideos } from '../../lib/weeklyGoalSchedule';
import { buildPresetMatrixVideoPlans, WEEKLY_TASK_PACKAGE_PRESETS, weeklyTaskPackagePreset, type WeeklyTaskPackagePresetId } from '../../lib/weeklyTaskPackagePresets';
import { defaultMatrixPlan } from '../../lib/weeklyMatrix';
import { loadSocialContentStage, readSocialContentStage, type SocialContentStageProfile } from '../../lib/socialContentStage';
import type { DigitalEmployeeConfig, WeeklyGoal, WeeklyPromotionPlan } from '../../lib/digitalEmployees';
import WeeklyPlanConfirmationCard from '../WeeklyPlanConfirmationCard';

export type BusinessLine = 'full_funnel' | 'content_growth' | 'customer_conversion';
export type ContentPlatform = 'all' | 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin';
type PublishingPlatform = Exclude<ContentPlatform, 'all'>;
type VideoPlan = NonNullable<WeeklyGoal['videoPlans']>[number];

export const contentPlatformLabel: Record<ContentPlatform, string> = {
  all: '全部平台', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn',
};

export function isoDay(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return shanghaiDay(date.toISOString());
}

export const EMPTY_GOAL = {
  businessLine: 'full_funnel' as BusinessLine,
  contentPlatforms: ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'] as PublishingPlatform[],
  title: '本周内容增长目标', objective: '形成一组面向目标市场、证据充分且可进入审批的内容执行包',
  metric: 'approved_content_packages', baseline: 0, target: 5, unit: '项', startsAt: isoDay(0), endsAt: isoDay(6), scope: '',
  constraints: ['对外发布必须审批'],
};

export type GoalDraft = Omit<WeeklyGoal, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

const withContentIds = (plans: VideoPlan[]): VideoPlan[] => plans.map(plan => plan.contentId ? plan : { ...plan, contentId: crypto.randomUUID() });
const initialPromotionPlans = (plans: VideoPlan[]): WeeklyPromotionPlan[] => plans.slice(0, 2).flatMap(plan => plan.contentId ? [{ contentId: plan.contentId, budgetCny: 100 }] : []);

function videoOptionLabel(plan: VideoPlan, index: number): string {
  const subject = plan.theme.split(/[；;]/)[0]?.trim() || `第 ${index + 1} 条视频`;
  return `${contentPlatformLabel[plan.platform]} · ${subject}`;
}

export function GoalPanel({
  config,
  busy,
  onSave,
  businessLine,
  contentPlatform,
}: {
  config: DigitalEmployeeConfig;
  busy: boolean;
  onSave: (goal: GoalDraft) => void;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
  onOpenSettings?: () => void;
}) {
  const configuredTargetPlatforms = weeklyPublishingPlatforms(config.publishingTargets, config.socialCadence);
  const profilePlatforms = [...new Set(socialOperatingProfile(config.socialOperatingProfile).accounts.map(account => account.platform))];
  const configuredPlatforms = (configuredTargetPlatforms.length ? configuredTargetPlatforms : profilePlatforms.length ? profilePlatforms : ['youtube']) as PublishingPlatform[];
  const requestedPlatform = contentPlatform !== 'all' && configuredPlatforms.includes(contentPlatform) ? contentPlatform : null;
  const initialStageProfile = readSocialContentStage();
  const initialPresetId: WeeklyTaskPackagePresetId = initialStageProfile?.presetId
    ?? (config.operatingMaturity === 'starting' ? 'b2b_starting' : 'b2b_growing');
  const presetPlatforms = (presetId: WeeklyTaskPackagePresetId) => {
    const allowed = weeklyTaskPackagePreset(presetId).platforms.filter(platform => configuredPlatforms.includes(platform));
    return requestedPlatform ? [requestedPlatform] : allowed.length ? allowed : [configuredPlatforms[0]!];
  };
  const initialProduct = config.focusProducts.split(/[、，,；;\n]/).map(item => item.trim()).filter(Boolean)[0] || '';
  const buildPlans = (presetId: WeeklyTaskPackagePresetId, platforms: PublishingPlatform[]) => {
    const preset = weeklyTaskPackagePreset(presetId);
    return withContentIds(buildPresetMatrixVideoPlans({
      preset,
      productName: initialProduct,
      defaults: config.videoDefaults,
      platforms,
      matrixRows: defaultMatrixPlan(config, platforms, preset.objective),
    }));
  };
  const initialPlatforms = presetPlatforms(initialPresetId);
  const initialPlans = businessLine === 'customer_conversion' ? [] : buildPlans(initialPresetId, initialPlatforms);
  const initialPreset = weeklyTaskPackagePreset(initialPresetId);
  const [stage, setStage] = useState<'plan' | 'budget'>('plan');
  const [submitted, setSubmitted] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<WeeklyTaskPackagePresetId>(initialPresetId);
  const [onboardingStageProfile, setOnboardingStageProfile] = useState<SocialContentStageProfile | null>(initialStageProfile);
  const presetManuallyChanged = useRef(false);
  const [form, setForm] = useState<GoalDraft>(() => ({
    ...EMPTY_GOAL,
    startsAt: isoDay(0), endsAt: isoDay(6), businessLine,
    videoPlans: initialPlans,
    promotionPlans: initialPromotionPlans(initialPlans),
    contentPlatforms: businessLine === 'customer_conversion' ? initialPlatforms : initialPlatforms,
    title: businessLine === 'customer_conversion' ? '本周客户转化目标' : `${initialPreset.label}周任务包`,
    objective: businessLine === 'customer_conversion' ? '提升高意向客户的报价、跟进与成交转化' : initialPreset.objective,
    metric: businessLine === 'customer_conversion' ? 'qualified_inquiries' : initialPreset.metric,
    target: businessLine === 'customer_conversion' ? 1 : initialPlans.length,
    unit: businessLine === 'customer_conversion' ? '位' : '条', scope: config.targetMarkets,
  }));

  const plans = form.videoPlans || [];
  const promotions = form.promotionPlans || [];
  const platformPlanCounts = configuredPlatforms.map(platform => ({ platform, count: plans.filter(plan => plan.platform === platform).length }));
  const promotionBudgetCny = promotions.reduce((sum, item) => sum + item.budgetCny, 0);
  const productionBudgetMinCny = plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || MASTER_VIDEO_COST_MIN_CNY), 0);
  const productionBudgetMaxCny = plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || MASTER_VIDEO_COST_MAX_CNY), 0);
  const validPlanIds = new Set(plans.map(plan => plan.contentId).filter(Boolean));
  const promotionInvalid = promotions.some(item => !validPlanIds.has(item.contentId) || item.budgetCny <= 0);
  const hasErrors = businessLine !== 'customer_conversion' && (!plans.length || !form.contentPlatforms.length || plans.some(plan => !form.contentPlatforms.includes(plan.platform)) || promotionInvalid);

  const choosePreset = (presetId: WeeklyTaskPackagePresetId) => {
    const platforms = presetPlatforms(presetId);
    const nextPlans = buildPlans(presetId, platforms);
    const preset = weeklyTaskPackagePreset(presetId);
    setSelectedPresetId(presetId);
    setForm(current => ({
      ...current, title: `${preset.label}周任务包`, objective: preset.objective, metric: preset.metric,
      target: nextPlans.length, unit: '条', contentPlatforms: platforms, videoPlans: nextPlans,
      promotionPlans: initialPromotionPlans(nextPlans),
    }));
  };

  useEffect(() => {
    let active = true;
    void loadSocialContentStage().then(profile => {
      if (!active || !profile) return;
      setOnboardingStageProfile(profile);
      if (!presetManuallyChanged.current && profile.presetId !== selectedPresetId) choosePreset(profile.presetId);
    });
    return () => { active = false; };
  }, []);

  const updatePlatformCount = (platform: PublishingPlatform, requestedCount: number | null) => {
    setForm(current => {
      const currentPlans = current.videoPlans || [];
      const otherPlans = currentPlans.filter(plan => plan.platform !== platform);
      const desired = Math.max(0, Math.min(30 - otherPlans.length, Math.floor(requestedCount || 0)));
      const existing = currentPlans.filter(plan => plan.platform === platform).slice(0, desired);
      const templates = buildPlans(selectedPresetId, [platform]);
      const additions = Array.from({ length: Math.max(0, desired - existing.length) }, (_, index) => ({
        ...(templates[index % Math.max(1, templates.length)] || currentPlans[0]),
        contentId: crypto.randomUUID(), platform,
      } as VideoPlan));
      const byPlatform = [...otherPlans, ...existing, ...additions];
      const nextPlans = configuredPlatforms.flatMap(item => byPlatform.filter(plan => plan.platform === item));
      const contentPlatforms = configuredPlatforms.filter(item => nextPlans.some(plan => plan.platform === item));
      const nextIds = new Set(nextPlans.map(plan => plan.contentId).filter(Boolean));
      return {
        ...current, videoPlans: nextPlans, contentPlatforms, target: nextPlans.length,
        promotionPlans: (current.promotionPlans || []).filter(item => nextIds.has(item.contentId)),
      };
    });
  };

  const updatePromotion = (index: number, patch: Partial<WeeklyPromotionPlan>) => setForm(current => ({
    ...current,
    promotionPlans: (current.promotionPlans || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  }));
  const removePromotion = (index: number) => setForm(current => ({ ...current, promotionPlans: (current.promotionPlans || []).filter((_, itemIndex) => itemIndex !== index) }));
  const availablePromotionPlans = plans.filter(plan => plan.contentId && !promotions.some(item => item.contentId === plan.contentId));
  const addPromotion = () => {
    const next = availablePromotionPlans[0];
    if (!next?.contentId) return;
    setForm(current => ({ ...current, promotionPlans: [...(current.promotionPlans || []), { contentId: next.contentId!, budgetCny: 100 }] }));
  };

  const reviewBudget = () => {
    setSubmitted(true);
    if (hasErrors) return;
    setStage('budget');
  };
  const confirmBudget = () => {
    setSubmitted(true);
    if (hasErrors) { setStage('plan'); return; }
    onSave({ ...form, videoPlans: scheduleWeeklyVideos(plans, form.startsAt, form.endsAt) });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Steps current={stage === 'plan' ? 0 : 1} responsive={false} items={[{ title: '确认执行方案' }, { title: '确认预算并启动' }]} />
      {stage === 'budget' ? (
        <WeeklyPlanConfirmationCard
          busy={busy}
          videoCount={plans.length}
          platformPlanCounts={platformPlanCounts}
          promotionPlanCount={promotions.length}
          promotionBudgetCny={promotionBudgetCny}
          productionBudgetMinCny={productionBudgetMinCny}
          productionBudgetMaxCny={productionBudgetMaxCny}
          onEdit={() => setStage('plan')}
          onConfirm={confirmBudget}
        />
      ) : (
        <section aria-label="本周执行方案确认" className="rounded-lg border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-accent">第 1 步 · 确认执行方案</p>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">本周准备怎么做</h2>
            </div>
            <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-secondary">{plans.length} 条视频</span>
          </div>

          {submitted && hasErrors && <p role="alert" className="mt-4 rounded-lg border border-warning/30 bg-warning-dim px-4 py-3 text-sm text-warning">请至少安排 1 条视频；投流金额必须大于 0。</p>}

          <div className="mt-6 space-y-6">
            <section aria-labelledby="weekly-scheme-title">
              <div className="flex items-center gap-2"><Video size={18} className="text-accent" /><h3 id="weekly-scheme-title" className="text-base font-semibold text-text-primary">任务方案</h3></div>
              <Select
                aria-label="选择本周任务方案"
                className="mt-3 w-full [&_.ant-select-selection-item]:!font-medium [&_.ant-select-selection-item]:!text-text-primary [&_.ant-select-selection-search-input]:!bg-transparent [&_.ant-select-selection-search-input]:!shadow-none"
                value={selectedPresetId}
                onChange={value => {
                  presetManuallyChanged.current = true;
                  choosePreset(value as WeeklyTaskPackagePresetId);
                }}
                options={WEEKLY_TASK_PACKAGE_PRESETS.map(preset => ({ value: preset.id, label: preset.label }))}
              />
              <p className="mt-2 text-sm text-text-secondary">
                {onboardingStageProfile && onboardingStageProfile.presetId === selectedPresetId
                  ? `默认采用新手引导中的“${onboardingStageProfile.name}”。`
                  : ''}
                {weeklyTaskPackagePreset(selectedPresetId).description}
              </p>
            </section>

            {businessLine !== 'customer_conversion' && <section aria-labelledby="weekly-distribution-title" className="border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 id="weekly-distribution-title" className="text-base font-semibold text-text-primary">视频条数与发布分配</h3><p className="mt-1 text-xs text-text-muted">直接改数字，平台适配数量会同步更新。</p></div>
                <strong className="text-sm text-text-primary">合计 {plans.length} 条</strong>
              </div>
              <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                {platformPlanCounts.map(item => {
                  const account = config.publishingTargets.find(target => target.platform === item.platform)?.accountLabel || '平台账号';
                  return <div key={item.platform} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0"><p className="font-medium text-text-primary">{contentPlatformLabel[item.platform]}</p><p className="truncate text-xs text-text-muted">{account}</p></div>
                    <div className="flex items-center gap-2">
                      <InputNumber aria-label={`${contentPlatformLabel[item.platform]}视频条数`} min={0} max={30} precision={0} value={item.count} onChange={value => updatePlatformCount(item.platform, value)} />
                      <span className="text-sm text-text-secondary">条</span>
                    </div>
                  </div>;
                })}
              </div>
            </section>}

            {businessLine !== 'customer_conversion' && <section aria-labelledby="weekly-promotion-title" className="border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Megaphone size={18} className="text-accent" /><div><h3 id="weekly-promotion-title" className="text-base font-semibold text-text-primary">投流计划</h3><p className="mt-1 text-xs text-text-muted">选要投的内容，填写每条预算。</p></div></div>
                <Button htmlType="button" icon={<Plus size={15} />} disabled={!availablePromotionPlans.length} onClick={addPromotion}>添加一条</Button>
              </div>
              {promotions.length ? <div className="mt-3 space-y-2">{promotions.map((promotion, index) => <div key={`${promotion.contentId}-${index}`} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_180px_40px]">
                <Select
                  aria-label={`第 ${index + 1} 条投流内容`}
                  value={promotion.contentId}
                  onChange={contentId => updatePromotion(index, { contentId })}
                  options={plans.filter(plan => plan.contentId && (plan.contentId === promotion.contentId || !promotions.some(item => item.contentId === plan.contentId))).map((plan, planIndex) => ({ value: plan.contentId!, label: videoOptionLabel(plan, planIndex) }))}
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">¥</span>
                  <InputNumber className="w-full" aria-label={`第 ${index + 1} 条投流预算`} min={1} max={1_000_000} precision={2} value={promotion.budgetCny} onChange={value => updatePromotion(index, { budgetCny: Number(value || 0) })} />
                </div>
                <Button htmlType="button" aria-label={`删除第 ${index + 1} 条投流计划`} icon={<Trash2 size={16} />} onClick={() => removePromotion(index)} />
              </div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-muted">本周不投流；需要时点击“添加一条”。</div>}
            </section>}
          </div>

          <div className="mt-6 flex justify-end">
            <Button type="primary" htmlType="button" disabled={busy} onClick={reviewBudget} className="inline-flex items-center gap-2"><Check size={16} />方案无误，核算预算</Button>
          </div>
        </section>
      )}
    </div>
  );
}
