import { AlertTriangle, Bot, CheckCircle2, Clock3, Film, Image, ReceiptText, Sparkles, UserRound, WalletCards } from 'lucide-react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { FORMAT_OPTIONS, optionLabel } from './socialContentUi';
import {
  contentCreationReviewAdmissionAllowed,
  contentCreationTestBypassEnabled,
} from '../../lib/contentCreationTestBypass';
import { contentPreflightItems, type ContentPreflightState } from '../../lib/contentProductionExperience';

function money(value: number): string {
  return `¥${Math.max(0, value).toFixed(2)}`;
}

function preflightTone(state: ContentPreflightState): string {
  if (state === 'ready') return 'border-emerald-200 bg-emerald-50/70 text-emerald-800';
  if (state === 'blocked') return 'border-rose-200 bg-rose-50/70 text-rose-800';
  if (state === 'warning') return 'border-amber-200 bg-amber-50/70 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function SocialGenerationConfirmationCard({
  task,
  busy,
  onConfirm,
}: {
  task: SocialContentTaskDetail;
  busy: boolean;
  onConfirm: () => void;
}) {
  const workflow = task.agentWorkflow;
  const testBypass = contentCreationTestBypassEnabled();
  if (!workflow || task.status !== 'plan_review') return null;

  const plan = workflow.executionPlan;
  const scenes = plan.scenes;
  const averageSuccess = scenes.length
    ? scenes.reduce((sum, scene) => sum + scene.estimatedSuccessRate, 0) / scenes.length
    : 0;
  const feasibleCount = scenes.filter(scene => scene.feasibility === 'full_fidelity' || scene.feasibility === 'functional_equivalent').length;
  const riskCount = scenes.reduce((sum, scene) => sum + scene.rightsRisks.length + scene.dataTransferRisks.length, 0)
    + workflow.executionPlanReview.failedCriteria.length;
  const review = workflow.executionPlanReview;
  const approved = review.approved;
  const localBudgetOverride = !approved && testBypass && contentCreationReviewAdmissionAllowed(review);
  const explanationOnly = scenes.length > 0
    && scenes.every(scene => ['motion_graphics', 'verified_fact_card'].includes(scene.selectedSourceStrategy));
  const formalReplicationBlocked = task.brief.productionMode === 'social_ready'
    && task.brief.creationMode === 'viral_replication'
    && explanationOnly;
  const canConfirm = contentCreationReviewAdmissionAllowed(review) && !formalReplicationBlocked;
  const needsReplicationReview = task.brief.creationMode === 'viral_replication'
    && task.replicationScript?.status !== 'confirmed';
  const formats = task.brief.formats.map(value => optionLabel(FORMAT_OPTIONS, value)).filter(Boolean).join('、') || '内容成品';
  const estimatedMinutes = Math.max(1, Math.round(plan.estimatedTotalSeconds / 60));
  const preflightItems = contentPreflightItems(task);
  const preflightIcons = { materials: Image, account: UserRound, budget: WalletCards, time: Clock3 } as const;
  const blockedMaterialCount = plan.scenes.filter(scene => scene.feasibility === 'blocked_for_facts_or_rights').length;
  const budgetBlocked = review.reasonCodes.includes('budget_exceeded');
  const actionLabel = busy
    ? '正在提交任务'
    : formalReplicationBlocked || blockedMaterialCount > 0
      ? `补齐 ${Math.max(1, blockedMaterialCount)} 项必要素材`
      : budgetBlocked && !canConfirm
        ? '调整方案后开始制作'
        : canConfirm
          ? `${needsReplicationReview ? '确认逐镜方案' : '开始制作'} · 预计 ${money(plan.estimatedTotalCostCny)} · 约 ${estimatedMinutes} 分钟`
          : '先处理方案风险';

  return (
    <section id="social-generation-confirmation" data-social-generation-confirmation className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm" aria-labelledby="social-generation-confirmation-title">
      <div className="grid gap-px bg-border lg:grid-cols-3">
        <div className="bg-white p-4 sm:p-5">
          <p className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700"><Film size={13} />这次会产出</p>
          <h3 id="social-generation-confirmation-title" className="mt-2 text-base font-black text-text-primary">{task.brief.requestedOutputCount || 1} 条{formats}</h3>
          <p className="mt-1 text-xs text-text-muted">{scenes.length} 个镜头 · 脚本、口播、字幕与成片</p>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <p className="flex items-center gap-1.5 text-[10px] font-black text-blue-700"><ReceiptText size={13} />预计费用</p>
          <h3 className="mt-2 text-base font-black text-text-primary">{money(plan.estimatedTotalCostCny)}</h3>
          <p className="mt-1 text-xs text-text-muted">{plan.budgetLimitCny === null ? '未设置单条预算上限' : `预算上限 ${money(plan.budgetLimitCny)}`} · 预计 {estimatedMinutes} 分钟</p>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <p className="flex items-center gap-1.5 text-[10px] font-black text-violet-700"><Sparkles size={13} />效果预判</p>
          <h3 className="mt-2 text-base font-black text-text-primary">{feasibleCount}/{scenes.length} 镜头可完整或等价实现</h3>
          <p className="mt-1 text-xs text-text-muted">模型路线成功率约 {Math.round(averageSuccess * 100)}% · {riskCount ? `${riskCount} 项需留意` : '暂无阻断风险'}</p>
        </div>
      </div>

      <div className="border-t border-border bg-white px-4 py-4 sm:px-5" data-content-preflight>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-black tracking-[0.08em] text-text-muted">开始前确认</p>
            <h4 className="mt-1 text-sm font-black text-text-primary">素材、账号、预算和时间一眼看清</h4>
          </div>
          <p className="text-[10px] text-text-muted">缺账号不会阻止制作，成片会先保存到作品库</p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {preflightItems.map(item => {
            const Icon = preflightIcons[item.id];
            return (
              <div key={item.id} className={`rounded-xl border px-3 py-3 ${preflightTone(item.state)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-black"><Icon size={13} />{item.label}</span>
                  <span className="text-[9px] font-black">{item.state === 'ready' ? '已就绪' : item.state === 'blocked' ? '需处理' : item.state === 'warning' ? '可稍后补' : '计算中'}</span>
                </div>
                <p className="mt-2 text-xs font-black leading-5">{item.value}</p>
                <p className="mt-1 text-[9px] leading-4 opacity-80">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`border-t px-4 py-3 text-[10px] font-semibold leading-4 sm:px-5 ${formalReplicationBlocked ? 'border-rose-200 bg-rose-50 text-rose-800' : localBudgetOverride ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-blue-100 bg-blue-50/60 text-blue-900'}`}>
        {formalReplicationBlocked
          ? '当前方案只会生成说明卡片，达不到爆款复刻的画面预期。请先补充产品视频或图片；也可以改为“概念样片”，但不可直接发布。'
          : localBudgetOverride
            ? '本地演示仅放行预算上限；事实、权利、素材覆盖、生成能力和成片质量仍需全部通过。'
          : '若执行时必须改用更低质量的画面路线，系统会暂停并再次请你确认，不会静默生成占位稿。'}
      </div>

      <div className="flex flex-col gap-3 border-t border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-2 text-[10px] leading-4 text-text-muted">{canConfirm ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700" />}<span>{formalReplicationBlocked ? '正式生成已阻止：补充真实产品素材后会重新计算费用和效果。' : localBudgetOverride ? '预算上限已在本地演示中放行，其他质量检查均已通过。' : approved ? '费用为当前执行方案预估，最终账单按实际调用结算；重试或改稿前会重新提示。' : review.requiredRevision.join('；') || '方案存在阻断项，请先补齐信息。'}</span></div>
        <button type="button" disabled={busy || !canConfirm} onClick={onConfirm} aria-busy={busy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Clock3 size={14} className="animate-spin" /> : <Bot size={14} />}{actionLabel}</button>
      </div>
    </section>
  );
}
