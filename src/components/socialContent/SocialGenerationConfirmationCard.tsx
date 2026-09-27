import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Film, Image as ImageIcon, WalletCards } from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialProductionApproach,
  SocialProductionOption,
} from '../../../shared/contracts/socialContentWorkflow';

function money(value: number): string {
  return `¥${Math.max(0, value).toFixed(2)}`;
}

function durationLabel(seconds: number): string {
  const safe = Math.max(1, Math.round(seconds));
  return safe < 60 ? `约 ${safe} 秒` : `约 ${Math.ceil(safe / 60)} 分钟`;
}

function optionDescription(approach: SocialProductionApproach): string {
  if (approach === 'ai_enhanced') return '人物画面使用智能人物生成，纯产品展示使用产品场景生成，工厂、案例和其他画面优先匹配已有素材。';
  if (approach === 'shooting_plan') return '整理成可交给拍摄团队的镜头清单，本次不生成视频。';
  return '使用你已有的素材完成剪辑，不产生画面生成费用。';
}

const CURRENT_OPTION_META: Record<'ai_enhanced' | 'material_cut' | 'shooting_plan', {
  label: string;
  qualityTier: SocialProductionOption['qualityTier'];
}> = {
  ai_enhanced: { label: '智能混合制作·主推', qualityTier: 'premium' },
  material_cut: { label: '免费素材方案', qualityTier: 'standard' },
  shooting_plan: { label: '建立代拍清单', qualityTier: 'enhanced' },
};

function fallbackOptions(task: SocialContentTaskDetail): SocialProductionOption[] {
  const plan = task.agentWorkflow!.executionPlan;
  const firstAsset = plan.scenes.flatMap(scene => scene.candidates)
    .find(candidate => candidate.kind === 'asset' && candidate.mediaType);
  const firstFramePreview = firstAsset?.sourceRef && firstAsset.mediaType ? {
    assetId: firstAsset.sourceRef,
    label: firstAsset.label,
    mediaType: firstAsset.mediaType,
    url: firstAsset.previewUrl ?? null,
    sourceTimestampSeconds: 0 as const,
  } : null;
  return [
    ['ai_enhanced', '智能混合制作·主推', true, 'premium'],
    ['material_cut', '免费素材方案', false, 'standard'],
    ['shooting_plan', '建立代拍清单', false, 'enhanced'],
  ].map(([approach, label, paid, quality]) => ({
    approach: approach as SocialProductionApproach,
    label: label as string,
    description: optionDescription(approach as SocialProductionApproach),
    qualityTier: quality as SocialProductionOption['qualityTier'],
    available: approach === 'shooting_plan' || Boolean(paid) || Boolean(firstFramePreview),
    unavailableReason: approach === 'shooting_plan' || paid || firstFramePreview ? null : '“我的素材”中没有可用素材',
    usesPaidProviders: Boolean(paid),
    estimatedCostCny: paid ? plan.estimatedTotalCostCny : 0,
    includedOperations: [],
    selectedMaterialIds: firstFramePreview ? [firstFramePreview.assetId] : [],
    firstFramePreview,
  }));
}

function currentProductionOptions(task: SocialContentTaskDetail): SocialProductionOption[] {
  const fallback = fallbackOptions(task);
  const supplied = task.agentWorkflow?.executionPlan.productionOptions ?? [];
  const normalized = new Map<SocialProductionApproach, SocialProductionOption>();
  for (const option of supplied) {
    const approach: SocialProductionApproach = option.approach === 'material_polish' ? 'material_cut' : option.approach;
    if (!(approach in CURRENT_OPTION_META) || normalized.has(approach)) continue;
    const meta = CURRENT_OPTION_META[approach as keyof typeof CURRENT_OPTION_META];
    normalized.set(approach, {
      ...option,
      approach,
      label: meta.label,
      description: optionDescription(approach),
      qualityTier: meta.qualityTier,
    });
  }
  for (const option of fallback) {
    if (!normalized.has(option.approach)) normalized.set(option.approach, option);
  }
  return (['ai_enhanced', 'material_cut', 'shooting_plan'] as const)
    .map(approach => normalized.get(approach))
    .filter((option): option is SocialProductionOption => Boolean(option));
}

function Keyframe({ title, url, mediaType, empty }: {
  title: string;
  url: string | null | undefined;
  mediaType: 'video' | 'image';
  empty: string;
}) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-2">
      <div className="aspect-[9/16] max-h-64 bg-slate-950">
        {url && mediaType === 'video'
          ? <video src={url} aria-label={title} muted playsInline preload="metadata" onLoadedMetadata={event => { event.currentTarget.currentTime = Math.min(0.01, event.currentTarget.duration || 0.01); }} className="h-full w-full object-cover" />
          : url
            ? <img src={url} alt={title} className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-bold text-slate-300"><ImageIcon size={18} className="mr-2" />{empty}</div>}
      </div>
      <figcaption className="truncate bg-white px-3 py-2 text-center text-[10px] font-black text-text-secondary">{title}</figcaption>
    </figure>
  );
}

export default function SocialGenerationConfirmationCard({ task, busy, onConfirm }: {
  task: SocialContentTaskDetail;
  busy: boolean;
  onConfirm: (approach?: SocialProductionApproach) => void;
}) {
  const workflow = task.agentWorkflow;
  const plan = workflow?.executionPlan;
  const options = useMemo(() => workflow && plan
    ? currentProductionOptions(task)
    : [], [task, workflow, plan]);
  const [selectedApproach, setSelectedApproach] = useState<SocialProductionApproach>(
    task.brief.productionApproach === 'material_polish' ? 'material_cut' : task.brief.productionApproach ?? 'ai_enhanced',
  );
  useEffect(() => {
    setSelectedApproach(task.brief.productionApproach === 'material_polish' ? 'material_cut' : task.brief.productionApproach ?? 'ai_enhanced');
  }, [task.taskId, task.version, task.brief.productionApproach]);
  if (!workflow || !plan || task.status !== 'plan_review') return null;

  const selected = options.find(option => option.approach === selectedApproach) ?? options[0];
  const preview = selected?.firstFramePreview;
  const estimatedSeconds = selectedApproach === plan.selectedApproach
    ? plan.estimatedTotalSeconds
    : selectedApproach === 'shooting_plan'
      ? Math.max(5, workflow.directorBrief.scenes.length * 2)
    : selectedApproach === 'ai_enhanced'
      ? Math.max(plan.estimatedTotalSeconds, workflow.directorBrief.scenes.length * 120)
      : Math.max(30, workflow.directorBrief.scenes.length * 12);
  const expectedDuration = workflow.directorBrief.totalDurationSeconds
    || task.referenceVideoAnalysis?.durationSeconds
    || 15;
  const canConfirm = workflow.executionPlanReview.approved && Boolean(selected?.available);

  return (
    <section id="social-generation-confirmation" data-social-generation-confirmation className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm" aria-labelledby="social-generation-confirmation-title">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <p className="text-[10px] font-black tracking-[0.08em] text-emerald-700">制作前审核</p>
        <h3 id="social-generation-confirmation-title" className="mt-1 text-base font-black text-text-primary">选择制作方案并核对关键帧</h3>
      </div>

      <div className="grid gap-2 border-b border-border bg-[#f7faf8] p-4 sm:grid-cols-3 sm:p-5">
        {options.map(option => {
          const active = option.approach === selected?.approach;
          return <button key={option.approach} type="button" disabled={!option.available || busy} onClick={() => setSelectedApproach(option.approach)} className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${active ? 'border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_#10b981]' : 'border-border bg-white hover:border-emerald-200'}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-text-primary">{option.label}</span>{active && <Check size={14} className="text-emerald-700" />}</div><p className="mt-1 text-[10px] leading-4 text-text-muted">{optionDescription(option.approach)}</p><p className="mt-2 text-[10px] font-black text-emerald-700">{option.approach === 'shooting_plan' ? '输出代拍清单' : option.usesPaidProviders ? `预计 ${money(option.estimatedCostCny)}` : '无需画面生成费用'}</p></button>;
        })}
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px] sm:p-5">
        <div>
          <p className="text-[10px] font-black text-text-muted">关键帧对比</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Keyframe title="参考关键帧" url={plan.referenceFirstFramePreview?.url} mediaType={plan.referenceFirstFramePreview?.mediaType ?? 'image'} empty="参考画面准备中" />
            <Keyframe title="预计成片关键帧" url={preview?.url} mediaType={preview?.mediaType ?? 'image'} empty="预计画面准备中" />
          </div>
        </div>
        <div className="grid content-start gap-2">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-white p-3"><Film size={17} className="text-emerald-700" /><div><p className="text-[10px] font-bold text-text-muted">成片预计时长</p><p className="mt-0.5 text-sm font-black text-text-primary">{durationLabel(expectedDuration)}</p></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-white p-3"><Clock3 size={17} className="text-blue-700" /><div><p className="text-[10px] font-bold text-text-muted">预计制作耗时</p><p className="mt-0.5 text-sm font-black text-text-primary">{durationLabel(estimatedSeconds)}</p></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-white p-3"><WalletCards size={17} className="text-violet-700" /><div><p className="text-[10px] font-bold text-text-muted">预计费用</p><p className="mt-0.5 text-sm font-black text-text-primary">{money(selected?.estimatedCostCny ?? 0)}</p></div></div>
        </div>
      </div>

      <div className="flex justify-end border-t border-border p-4 sm:px-5">
        <button type="button" disabled={busy || !canConfirm} onClick={() => onConfirm(selected?.approach)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Clock3 size={14} className="animate-spin" /> : <Film size={14} />}{selected?.approach === 'shooting_plan' ? '确认并生成代拍清单' : '确认方案并开始制作'}</button>
      </div>
    </section>
  );
}
