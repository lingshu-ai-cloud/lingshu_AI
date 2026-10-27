import { useState } from 'react';
import { Button } from 'antd';
import { Check, CheckCircle2, Loader2, Target, X } from 'lucide-react';
import { socialOperatingProfile } from '../../../shared/contracts/socialOperatingProfile';
import { weeklyPublishingPlatforms } from '../../../shared/contracts/weeklyPublishingTargets';
import { scheduleWeeklyVideos } from '../../lib/weeklyGoalSchedule';
import { videoSchedulingErrors } from '../../lib/videoCreationPlan';
import { buildPresetMatrixVideoPlans, WEEKLY_TASK_PACKAGE_PRESETS, weeklyTaskPackagePreset, type WeeklyTaskPackagePresetId } from '../../lib/weeklyTaskPackagePresets';
import { defaultMatrixPlan } from '../../lib/weeklyMatrix';
import type { DigitalEmployeeConfig } from '../../lib/digitalEmployees';
import { defaultWeeklyGoal, EMPTY_GOAL, isoDay, type GoalDraft } from '../../lib/defaultWeeklyGoal';
import WeeklyPlanConfirmationCard from '../WeeklyPlanConfirmationCard';
import VideoPlanEditor from '../VideoPlanEditor';
import { Field, inputClass } from './DigitalEmployeeFormField';

export type BusinessLine = "full_funnel" | "content_growth" | "customer_conversion";
export type ContentPlatform = "all" | "facebook" | "instagram" | "tiktok" | "youtube" | "linkedin";

export const contentPlatformLabel: Record<ContentPlatform, string> = {
  all: "全部平台",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

export { EMPTY_GOAL, isoDay } from '../../lib/defaultWeeklyGoal';
export type { GoalDraft } from '../../lib/defaultWeeklyGoal';

export function GoalPanel({
  config,
  busy,
  onSave,
  businessLine,
  contentPlatform,
  onOpenSettings,
}: {
  config: DigitalEmployeeConfig;
  busy: boolean;
  onSave: (goal: GoalDraft) => void;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
  onOpenSettings?: () => void;
}) {
  const defaults = defaultWeeklyGoal(config, businessLine, contentPlatform);
  const configuredTargetPlatforms = weeklyPublishingPlatforms(config.publishingTargets, config.socialCadence);
  const configuredPlatforms = configuredTargetPlatforms.length
    ? configuredTargetPlatforms
    : [...new Set(socialOperatingProfile(config.socialOperatingProfile).accounts.map(account => account.platform))];
  const initialPlatforms = contentPlatform !== "all" && configuredPlatforms.includes(contentPlatform)
    ? [contentPlatform]
    : config.enabledWorkflows.includes("content_publish") ? configuredPlatforms : [configuredPlatforms[0]];
  const initialPresetId: WeeklyTaskPackagePresetId = defaults.presetId;
  const initialPreset = weeklyTaskPackagePreset(initialPresetId);
  const presetPlatforms = (presetId: WeeklyTaskPackagePresetId) => {
    const preset = weeklyTaskPackagePreset(presetId);
    const available = preset.platforms.filter(platform => configuredPlatforms.includes(platform));
    return available.length ? available : initialPlatforms;
  };
  const initialPresetPlatforms = presetPlatforms(initialPresetId);
  const initialProduct = config.focusProducts.split(/[、，,；;\n]/).map(item => item.trim()).filter(Boolean)[0] || '';
  const buildPlans = (preset: ReturnType<typeof weeklyTaskPackagePreset>, platforms: Array<Exclude<ContentPlatform, "all">>, focus = '') => buildPresetMatrixVideoPlans({
    preset,
    productName: initialProduct,
    focus,
    defaults: config.videoDefaults,
    platforms,
    matrixRows: defaultMatrixPlan(config, platforms, focus.trim() ? `${preset.objective}；本周重点：${focus.trim()}` : preset.objective),
  });
  const targetFor = (preset: ReturnType<typeof weeklyTaskPackagePreset>, videoCount: number) =>
    ['approved_content_packages', 'published_posts'].includes(preset.metric) ? videoCount : preset.weeklyOutput;
  const initialVideoPlans = defaults.draft.videoPlans || [];
  const [selectedPresetId, setSelectedPresetId] = useState<WeeklyTaskPackagePresetId>(initialPresetId);
  const [weeklyFocus, setWeeklyFocus] = useState('');
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [form, setForm] = useState<GoalDraft>(() => defaults.draft);
  const [submitted, setSubmitted] = useState(false);
  const estimatedPlanCost = (form.videoPlans || []).reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const errors = {
    title: form.title.trim() ? "" : "请填写目标名称",
    objective: form.objective.trim() ? "" : "请填写本周重点结果",
    scope: form.scope.trim() ? "" : "请明确业务范围",
    target: form.target > form.baseline ? "" : "目标值必须大于基线",
    dates: form.endsAt >= form.startsAt ? "" : "结束日期不能早于开始日期",
    contentPlatforms: businessLine !== "customer_conversion" && !form.contentPlatforms.length ? "请至少选择一个内容制作平台" : "",
    product: businessLine !== 'customer_conversion' && !initialProduct ? '请先在 Agent 设置中选择重点产品' : '',
  };
  const hasErrors = Object.values(errors).some(Boolean) || (form.videoPlans || []).some(plan => videoSchedulingErrors(plan).length > 0 || !form.contentPlatforms.includes(plan.platform));
  const goalErrorLabels: Record<keyof typeof errors, string> = {
    title: '目标名称', objective: '本周重点结果', scope: '业务范围（目标市场）', target: '目标值', dates: '目标周期', contentPlatforms: '内容制作平台', product: '重点产品',
  };
  const missingGoalFields = (Object.entries(errors) as Array<[keyof typeof errors, string]>).filter(([, error]) => Boolean(error)).map(([key, error]) => `${goalErrorLabels[key]}：${error}`);
  const videoPlanIssues = (form.videoPlans || []).flatMap((plan, index) => videoSchedulingErrors(plan).map(error => `第 ${index + 1} 条：${error}`));
  const platformPlanCounts = form.contentPlatforms.map(platform => ({ platform, count: (form.videoPlans || []).filter(plan => plan.platform === platform).length }));
  const confirmPlanDraft = () => {
    setSubmitted(true);
    if (hasErrors) {
      setGoalEditorOpen(true);
      return;
    }
    setGoalEditorOpen(false);
    onSave({ ...form, videoPlans: scheduleWeeklyVideos(form.videoPlans || [], form.startsAt, form.endsAt) });
  };
  const choosePreset = (presetId: WeeklyTaskPackagePresetId) => {
    const preset = weeklyTaskPackagePreset(presetId);
    const platforms = presetPlatforms(presetId);
    setSelectedPresetId(presetId);
    setForm(current => {
      const videoPlans = buildPlans(preset, platforms, weeklyFocus);
      return {
        ...current,
        title: `${preset.label}周任务包`,
        objective: preset.objective,
        metric: preset.metric,
        target: targetFor(preset, videoPlans.length),
        unit: '条',
        contentPlatforms: platforms,
        videoPlans,
      };
    });
  };
  const updateWeeklyFocus = (value: string) => {
    setWeeklyFocus(value);
    const preset = weeklyTaskPackagePreset(selectedPresetId);
    setForm(current => {
      const videoPlans = buildPlans(preset, current.contentPlatforms, value);
      return {
        ...current,
        objective: value.trim() ? `${preset.objective}；本周重点：${value.trim()}` : preset.objective,
        target: targetFor(preset, videoPlans.length),
        videoPlans,
      };
    });
  };
  const updateContentPlatforms = (platform: Exclude<ContentPlatform, "all">) => {
    setForm(current => {
      const selected = current.contentPlatforms.includes(platform);
      const contentPlatforms = selected ? current.contentPlatforms.filter(item => item !== platform) : [...current.contentPlatforms, platform];
      const videoPlans = contentPlatforms.length ? buildPlans(weeklyTaskPackagePreset(selectedPresetId), contentPlatforms, weeklyFocus) : [];
      const target = ['approved_content_packages', 'published_posts'].includes(current.metric) ? videoPlans.length : current.target;
      return { ...current, contentPlatforms, videoPlans, target };
    });
  };
  return (
    <>
      <WeeklyPlanConfirmationCard busy={busy} businessLine={businessLine} packageLabel={weeklyTaskPackagePreset(selectedPresetId).label}
        plans={form.videoPlans || []} publishingTargets={config.publishingTargets} startsAt={form.startsAt} endsAt={form.endsAt}
        scope={form.scope} objective={form.objective} estimatedCostCny={estimatedPlanCost} platformPlanCounts={platformPlanCounts}
        targetPlatformCount={form.contentPlatforms.length} missingItems={submitted && hasErrors ? [...missingGoalFields, ...videoPlanIssues.slice(0, 3)] : []}
        missingItemCount={missingGoalFields.length + videoPlanIssues.length} hasValidationErrors={hasErrors} missingProduct={Boolean(errors.product)} onOpenSettings={onOpenSettings}
        onEdit={() => setGoalEditorOpen(true)} onConfirm={confirmPlanDraft} />
      {goalEditorOpen && <section aria-label="调整本周设置" className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <Button htmlType="button" aria-label="关闭本周设置" disabled={busy} onClick={() => setGoalEditorOpen(false)} className="!h-auto min-h-9 !whitespace-normal sticky top-0 z-10 float-right rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></Button>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
          <Target size={22} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            选一个周任务包，告诉灵小枢本周重点
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            灵小枢会把内容方向、平台节奏和 Agent 分工整理成可确认计划；你只需补充本周重点。
          </p>
        </div>
      </div>
      {submitted && hasErrors && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><p className="font-semibold">请先补齐以下信息：</p><ul className="mt-2 list-disc space-y-1 pl-4">{[...missingGoalFields, ...videoPlanIssues.slice(0, 3)].map(item => <li key={item}>{item}</li>)}</ul>{errors.product && onOpenSettings && <Button htmlType="button" onClick={onOpenSettings} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-amber-900 px-3 py-2 text-[11px] font-semibold text-white">去 Agent 设置选择重点产品</Button>}</div>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {businessLine !== 'customer_conversion' && <>
          <details className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">更换周任务方案（当前：{weeklyTaskPackagePreset(selectedPresetId).label}）</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {WEEKLY_TASK_PACKAGE_PRESETS.map(preset => {
                const selected = selectedPresetId === preset.id;
                return <Button key={preset.id} htmlType="button" aria-pressed={selected} onClick={() => choosePreset(preset.id)} className={`!h-auto min-h-9 !whitespace-normal rounded-lg border p-3 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className="flex items-start justify-between gap-2"><strong className="text-sm text-slate-950">{preset.label}</strong>{selected && <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />}</span>
                  <span className="mt-1.5 block text-[11px] leading-5 text-slate-500">{preset.description}</span>
                  <span className="mt-3 block text-[10px] font-bold text-emerald-700">主平台：{contentPlatformLabel[preset.primaryPlatform]} · {preset.weeklyOutput} 个选题方向</span>
                </Button>;
              })}
            </div>
          </details>
          <label className="md:col-span-2 text-xs font-semibold text-slate-700">本周最想解决什么？
            <input className={`${inputClass} mt-2`} value={weeklyFocus} onChange={event => updateWeeklyFocus(event.target.value)} placeholder="例如：验证东南亚采购商最关心的选型问题" />
          </label>
          {submitted && errors.product && <p role="alert" className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{errors.product}</p>}
          <details className="md:col-span-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-xs">
            <summary className="cursor-pointer font-semibold text-emerald-950">查看执行安排</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><p className="font-semibold text-emerald-950">发布节奏</p><p className="mt-1 leading-5 text-emerald-800">{weeklyTaskPackagePreset(selectedPresetId).frequency}</p></div>
            <div><p className="font-semibold text-emerald-950">账号安排</p><p className="mt-1 leading-5 text-emerald-800">{weeklyTaskPackagePreset(selectedPresetId).accountRoles}</p></div>
            <div><p className="font-semibold text-emerald-950">由谁完成</p><p className="mt-1 leading-5 text-emerald-800">灵小枢安排各数字员工完成，并在需要你决定时提醒。</p></div>
            </div>
          </details>
        </>}
        {businessLine !== "customer_conversion" && <div className="md:col-span-2 rounded-lg border border-blue-100 bg-blue-50/50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">确认本期制作平台</p><p className="mt-1 text-xs text-slate-500">选择平台会立即重算该平台账号的周配额和实际内容任务数。</p></div><span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-blue-700">{!config.enabledWorkflows.includes("content_publish")?"仅制作内容，不发布":config.allowRealPublishing?"获批后允许真实发布":"获批后停在人工待发布"}</span></div><div className="mt-3 flex flex-wrap gap-2">{configuredPlatforms.map(platform=>{const selected=form.contentPlatforms.includes(platform);const accounts=config.publishingTargets.filter(target=>target.platform===platform);const count=(form.videoPlans||[]).filter(plan=>plan.platform===platform).length;return <Button key={platform} htmlType="button" aria-pressed={selected} onClick={()=>updateContentPlatforms(platform)} className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-3 py-2 text-left ${selected?"border-blue-400 bg-white text-blue-800":"border-slate-200 bg-slate-50 text-slate-500"}`}><span className="block text-xs font-semibold">{contentPlatformLabel[platform]}{selected?` · ${count} 条`:''}</span><span className="mt-0.5 block text-[9px]">{accounts.map(account=>account.accountLabel).join("、")||"待连接账号"}</span></Button>})}</div>{submitted&&errors.contentPlatforms&&<p className="mt-2 text-[10px] font-semibold text-red-600">{errors.contentPlatforms}</p>}</div>}
        {businessLine !== 'customer_conversion' && <details className="md:col-span-2 rounded-lg border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">查看并调整具体视频计划（可选）</summary><div className="mt-4"><VideoPlanEditor plans={form.videoPlans || []} config={config} platforms={form.contentPlatforms} themeWorkflow onChange={videoPlans => setForm(current => ({ ...current, videoPlans, target: ['approved_content_packages', 'published_posts'].includes(current.metric) ? videoPlans.length : current.target }))} /></div></details>}
        <details className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">系统生成的目标设置（需要时可修改）</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field
          label="目标名称"
          error={submitted ? errors.title : ""}
          wide
        >
          <input
            className={inputClass}
            value={form.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>
        <Field
          label="本周重点结果"
          error={submitted ? errors.objective : ""}
          wide
        >
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={form.objective}
            onChange={(event) => set("objective", event.target.value)}
          />
        </Field>
        <Field label="衡量指标">
          <select
            className={inputClass}
            value={form.metric}
            onChange={(event) => setForm(current => ({ ...current, metric: event.target.value, target: ['approved_content_packages', 'published_posts'].includes(event.target.value) ? (current.videoPlans?.length || 0) : current.target }))}
          >
            <option value="approved_content_packages">获批内容包</option>
            <option value="published_posts">真实发布内容</option>
            <option value="qualified_inquiries">高意向询盘</option>
            <option value="won_customers">成交客户</option>
            <option value="reactivated_customers">唤醒客户</option>
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="基线">
            <input
              className={inputClass}
              type="number"
              value={form.baseline}
              onChange={(event) => set("baseline", Number(event.target.value))}
            />
          </Field>
          <Field label="目标" error={submitted ? errors.target : ""}>
            <input
              className={inputClass}
              type="number"
              value={form.target}
              onChange={(event) => set("target", Number(event.target.value))}
            />
          </Field>
          <Field label="单位">
            <input
              className={inputClass}
              value={form.unit}
              onChange={(event) => set("unit", event.target.value)}
            />
          </Field>
        </div>
        <Field label="开始日期">
          <input
            className={inputClass}
            type="date"
            value={form.startsAt}
            onChange={(event) => set("startsAt", event.target.value)}
          />
        </Field>
        <Field label="结束日期" error={submitted ? errors.dates : ""}>
          <input
            className={inputClass}
            type="date"
            value={form.endsAt}
            onChange={(event) => set("endsAt", event.target.value)}
          />
        </Field>
        <Field
          label="业务范围"
          error={submitted ? errors.scope : ""}
          wide
        >
          <input
            className={inputClass}
            value={form.scope}
            onChange={(event) => set("scope", event.target.value)}
          />
        </Field>
        <Field label="本周特殊限制">
          <input
            className={inputClass}
            value={form.constraints.join("；")}
            onChange={(event) =>
              set(
                "constraints",
                event.target.value
                  .split(/[；;\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
          </div>
        </details>
      </div>
      <div className="mt-6 flex justify-end">
        <Button type="primary"
          htmlType="button"
          disabled={busy || (submitted && hasErrors)}
          onClick={confirmPlanDraft}
          className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          保存设置并确认周计划
        </Button>
      </div>
    </section>}
    </>
  );
}
