import { AlertTriangle, Bot, CheckCircle2, Clock3, Film, ReceiptText, Sparkles } from 'lucide-react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { FORMAT_OPTIONS, optionLabel } from './socialContentUi';
import {
  contentCreationHasSafetyBlocker,
  contentCreationReviewAdmissionAllowed,
  contentCreationTestBypassEnabled,
} from '../../lib/contentCreationTestBypass';

function money(value: number): string {
  return `¥${Math.max(0, value).toFixed(2)}`;
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
  if (!workflow || (task.status !== 'plan_review'
    && !(testBypass && ['draft', 'needs_input'].includes(task.status)))) return null;

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
  const safetyBlocked = contentCreationHasSafetyBlocker(review.reasonCodes);
  const explanationOnly = scenes.length > 0
    && scenes.every(scene => ['motion_graphics', 'verified_fact_card'].includes(scene.selectedSourceStrategy));
  const formalReplicationBlocked = task.brief.productionMode === 'social_ready'
    && task.brief.creationMode === 'viral_replication'
    && explanationOnly;
  const canConfirm = contentCreationReviewAdmissionAllowed(review)
    && (!formalReplicationBlocked || testBypass);
  const needsReplicationReview = task.brief.creationMode === 'viral_replication'
    && task.replicationScript?.status !== 'confirmed';
  const formats = task.brief.formats.map(value => optionLabel(FORMAT_OPTIONS, value)).filter(Boolean).join('、') || '内容成品';
  const estimatedMinutes = Math.max(1, Math.round(plan.estimatedTotalSeconds / 60));

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

      <div className={`border-t px-4 py-3 text-[10px] font-semibold leading-4 sm:px-5 ${formalReplicationBlocked && !testBypass ? 'border-rose-200 bg-rose-50 text-rose-800' : testBypass ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-blue-100 bg-blue-50/60 text-blue-900'}`}>
        {testBypass
          ? '本地节点测试模式已开启：所有内容制作门禁均已放行，可直接检查后续生产节点。'
          : formalReplicationBlocked
          ? '当前方案只会生成说明卡片，达不到爆款裂变的画面预期。请先补充产品视频或图片；也可以改为“概念样片”，但不可直接发布。'
          : '若执行时必须改用更低质量的画面路线，系统会暂停并再次请你确认，不会静默生成占位稿。'}
      </div>

      <div className="flex flex-col gap-3 border-t border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-2 text-[10px] leading-4 text-text-muted">{canConfirm ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700" />}<span>{testBypass ? `${safetyBlocked ? '事实或权利风险已记录，但不阻断本地测试。' : ''} 当前仅在本地放行，不代表内容已达到正式发布条件。` : formalReplicationBlocked ? '正式生成已阻止：补充真实产品素材后会重新计算费用和效果。' : approved ? '费用为当前执行方案预估，最终账单按实际调用结算；重试或改稿前会重新提示。' : review.requiredRevision.join('；') || '方案存在阻断项，请先补齐信息。'}</span></div>
        <button type="button" disabled={busy || !canConfirm} onClick={onConfirm} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Clock3 size={14} className="animate-spin" /> : <Bot size={14} />}{testBypass ? '测试下一生产节点' : formalReplicationBlocked ? '请先补充产品素材' : approved ? needsReplicationReview ? '确认逐镜方案' : `开始生成 · 预计 ${money(plan.estimatedTotalCostCny)}` : '先处理方案风险'}</button>
      </div>
    </section>
  );
}
