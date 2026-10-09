import { Bot, CheckCircle2, ChevronRight, CircleAlert, Clapperboard, Target } from 'lucide-react';
import type {
  SocialAgentWorkflowStage,
  SocialContentExecutionScenePlan,
  SocialContentTaskDetail,
  SocialDirectorBriefScene,
  SocialExecutionPlanSceneReview,
  SocialProductionFeasibility,
} from '../../../shared/contracts/socialContentWorkflow';
import { socialShotFunctionLabel, socialShotSourceStrategyLabel } from '../../lib/socialContentModel';

const STAGE_LABEL: Record<SocialAgentWorkflowStage, string> = {
  planned: '经营目标已建立',
  reference_ready: '参考分析已完成',
  factor_ready: '爆点因素已冻结',
  director_ready: '导演方案已完成',
  execution_planning: '内容方案规划中',
  director_review: '编导自动审核中',
  producing: '内容制作中',
  technical_review: '技术质检中',
  media_evaluation: '相似度与原创度检测中',
  creative_review: '表达验收中',
  asset_review: '成片待验收',
  ready_to_publish: '可以准备发布',
  needs_facts: '等待事实确认',
  needs_rights: '等待权利确认',
  needs_budget: '等待预算确认',
  goal_degraded: '需要确认目标降级',
  failed_recoverable: '可恢复异常',
};

const FEASIBILITY_LABEL: Record<SocialProductionFeasibility, string> = {
  full_fidelity: '完整实现',
  functional_equivalent: '功能等价',
  goal_degraded: '目标降级',
  blocked_for_facts_or_rights: '事实或权利阻断',
};

const READINESS_LABEL = {
  discovery_reference: '发现级参考',
  strategy_reference: '策略级参考',
  production_reference: '生产级参考',
} as const;

const EVALUATION_DIMENSIONS = [
  ['viralFactorFidelity', '爆点因果保真'],
  ['identityReplacement', '产品与人物替换'],
  ['originalityDifference', '原创差异'],
  ['unauthorizedReuseRisk', '未授权复用风险'],
  ['accountAndFactFit', '账号与事实适配'],
] as const;

const EVALUATION_STATUS_LABEL = {
  passed: '通过', failed: '未通过', review_required: '需复核', not_applicable: '不适用',
} as const;

function evaluationTone(status: keyof typeof EVALUATION_STATUS_LABEL): string {
  if (status === 'passed') return 'border-emerald-100 bg-emerald-50 text-emerald-900';
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-amber-100 bg-amber-50 text-amber-900';
}

function feasibilityTone(value: SocialProductionFeasibility): string {
  if (value === 'full_fidelity') return 'bg-emerald-50 text-emerald-800';
  if (value === 'functional_equivalent') return 'bg-blue-50 text-blue-800';
  if (value === 'goal_degraded') return 'bg-amber-50 text-amber-900';
  return 'bg-rose-50 text-rose-800';
}

function SceneRow({
  scene,
  execution,
  review,
}: {
  scene: SocialDirectorBriefScene;
  execution: SocialContentExecutionScenePlan | undefined;
  review: SocialExecutionPlanSceneReview | undefined;
}) {
  return (
    <article className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#173d31] text-[10px] font-black text-white">{scene.order}</span>
          <div className="min-w-0">
            <p className="text-xs font-black text-text-primary">{socialShotFunctionLabel(scene.purpose, scene.order - 1)}</p>
            <p className="mt-1 text-[10px] leading-4 text-text-secondary">{scene.targetVisual}</p>
          </div>
        </div>
        {execution && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black ${feasibilityTone(execution.feasibility)}`}>{FEASIBILITY_LABEL[execution.feasibility]}</span>}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg bg-surface-2 px-3 py-2.5">
          <p className="text-[9px] font-black text-text-muted">编导 Agent：效果与边界</p>
          <p className="mt-1 text-[10px] leading-4 text-text-primary">{scene.acceptanceCriteria.slice(0, 3).join('；')}</p>
          {scene.requiredEvidence.length > 0 && <p className="mt-1 text-[10px] leading-4 text-amber-800">必须证据：{scene.requiredEvidence.join('、')}</p>}
        </div>
        <div className="rounded-lg bg-blue-50/65 px-3 py-2.5">
          <p className="text-[9px] font-black text-blue-900">内容 Agent：推荐执行方案</p>
          {execution ? <>
            <p className="mt-1 text-[10px] leading-4 text-blue-950">{socialShotSourceStrategyLabel(execution.selectedSourceStrategy)} · 预计 ¥{execution.estimatedCostCny.toFixed(2)} · 约 {Math.max(1, Math.round(execution.estimatedSeconds / 60))} 分钟 · 成功率约 {Math.round(execution.estimatedSuccessRate * 100)}%</p>
            <p className="mt-1 text-[10px] leading-4 text-blue-800">{execution.feasibilityReason}</p>
          </> : <p className="mt-1 text-[10px] text-blue-800">执行方案正在生成</p>}
        </div>
      </div>

      {review && <div className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[10px] leading-4 ${review.approved ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{review.approved ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <CircleAlert size={13} className="mt-0.5 shrink-0" />}<span><strong>{review.approved ? '编导审核通过' : '编导要求修改'}</strong>{review.approved ? '：满足当前逐镜验收条件。' : `：${review.requiredRevision.join('；') || review.failedCriteria.join('；')}`}</span></div>}

      {execution && <details className="mt-2 rounded-lg border border-border bg-surface-2/45 px-3 py-2">
        <summary className="cursor-pointer text-[9px] font-black text-text-muted">查看候选来源与风险（默认收起）</summary>
        <div className="mt-2 space-y-1.5 text-[10px] leading-4 text-text-secondary">
          <p>已召回 {execution.candidates.length} 个真实素材或可用能力候选；推荐 {execution.recommendedCandidateIds.length} 个，备选 {execution.alternativeCandidateGroups.length} 组。</p>
          {execution.rightsRisks.map(item => <p key={item}>权利：{item}</p>)}
          {execution.dataTransferRisks.map(item => <p key={item}>数据：{item}</p>)}
        </div>
      </details>}
    </article>
  );
}

export default function SocialAgentWorkflowPanel({ task, expanded = false, onReviewReference }: { task: SocialContentTaskDetail; expanded?: boolean; onReviewReference?: (recordId:string)=>void }) {
  const workflow = task.agentWorkflow;
  if (!workflow) return null;
  const context = workflow.weeklyPackage ?? workflow.adHocBusinessContext;
  const executionByScene = new Map(workflow.executionPlan.scenes.map(scene => [scene.sceneId, scene]));
  const reviewByScene = new Map(workflow.executionPlanReview.sceneResults.map(scene => [scene.sceneId, scene]));
  const reference = workflow.directorBrief.referenceAnalysis;
  const blocked = !workflow.executionPlanReview.approved;

  return (
    <section data-social-agent-workflow className="rounded-2xl border border-border bg-white p-5 shadow-sm" aria-labelledby="social-agent-workflow-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.08em] text-accent">经营 → 编导 → 内容</p>
          <h3 id="social-agent-workflow-title" className="mt-1 text-base font-black text-text-primary">统一制作链路</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">编导只定义表达目标和验收标准；具体素材、模型和制作路线由内容 Agent 规划，再交回编导自动审核。</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${blocked ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{STAGE_LABEL[workflow.stage]}</span>
      </div>

      <details open={expanded} className="mt-4 overflow-hidden rounded-xl border border-border bg-surface-2/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white px-4 py-3 text-xs font-black text-text-primary">
          <span>查看编导、逐镜方案与检测依据</span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-text-muted">{workflow.directorBrief.scenes.length} 个镜头{expanded ? '' : ' · 默认收起'}<ChevronRight size={13} /></span>
        </summary>
        <div className="border-t border-border p-4">
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/55 p-3"><p className="flex items-center gap-1.5 text-[10px] font-black text-emerald-800"><Target size={13} />经营 Agent</p><p className="mt-1 text-xs font-bold text-text-primary">{workflow.weeklyPackage ? '周任务包' : '即时经营上下文'} · v{context?.version}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">{workflow.weeklyPackage ? `${workflow.weeklyPackage.originalContentCount} 条原创 · ${workflow.weeklyPackage.publicationTaskCount} 个发布任务` : workflow.adHocBusinessContext?.objective}</p></div>
        <div className="rounded-xl border border-violet-100 bg-violet-50/55 p-3"><p className="flex items-center gap-1.5 text-[10px] font-black text-violet-800"><Clapperboard size={13} />编导 Agent</p><p className="mt-1 text-xs font-bold text-text-primary">DirectorBrief · v{workflow.directorBrief.version}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">{workflow.directorBrief.scenes.length} 个分镜 · 定义目标、事实边界和验收条件</p></div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/55 p-3"><p className="flex items-center gap-1.5 text-[10px] font-black text-blue-800"><Bot size={13} />内容 Agent</p><p className="mt-1 text-xs font-bold text-text-primary">ContentExecutionPlan · v{workflow.executionPlan.version}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">逐镜检索候选、比较成本耗时与风险，再执行</p></div>
      </div>

      {workflow.discoveryBrief && <div className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/55 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-black text-cyan-900">本次灵感发现范围</p>
            <p className="mt-1 text-xs font-bold text-text-primary">{workflow.discoveryBrief.productRef} · {workflow.discoveryBrief.market} · {workflow.discoveryBrief.audience}</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black text-cyan-800">{workflow.discoveryBrief.platforms.join(' / ')}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-text-muted">近 {workflow.discoveryBrief.lookbackDays} 天 · 最多召回 {workflow.discoveryBrief.resultLimit} 条 · {workflow.discoveryBrief.discoveryModes.map(mode => mode === 'momentum' ? '趋势发现' : mode === 'account' ? '标杆账号' : '表达创新').join('、')}</p>
      </div>}

      {workflow.inspirationHandoffs.length > 0 && <div className="mt-3 space-y-2">
        <p className="text-[10px] font-black text-text-muted">灵感采用依据与复刻边界</p>
        {workflow.inspirationHandoffs.map(handoff => <article key={`${handoff.inspirationId}:${handoff.analysisVersion}`} className="rounded-xl border border-violet-100 bg-violet-50/45 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black text-text-primary">{READINESS_LABEL[handoff.readiness]} · {handoff.source.platform}</p>
            <span className="text-[9px] font-bold text-text-muted">分析 {handoff.analysisVersion}</span>
            {onReviewReference && <button type="button" className="text-xs font-bold text-violet-900 underline" onClick={()=>onReviewReference(handoff.inspirationId)}>审核这条原参考</button>}
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-violet-950">为什么选它：{handoff.whySelected.join('；') || '作为本次表达结构参考'}</p>
          <p className="mt-1 text-[10px] leading-4 text-amber-900">必须替换：{handoff.adaptationBoundary.mustReplace.join('；') || '原作者身份、画面素材与品牌元素'}</p>
          <p className="mt-1 text-[10px] leading-4 text-text-muted">复用范围：{handoff.adaptationBoundary.reusable.join('；') || '仅复用结构、节奏与证明顺序'}</p>
        </article>)}
      </div>}

      {reference && <div className={`mt-3 rounded-xl border px-3 py-2.5 ${reference.gaps.length ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-black text-text-secondary">参考分析覆盖</p><span className="text-[9px] font-bold text-text-muted">全片 {reference.fullDurationSeconds?.toFixed(1) ?? '--'} 秒 · 精确区间 {reference.precisionIntervals.length} 段 · 置信度 {reference.overallConfidence === null ? '--' : `${Math.round(reference.overallConfidence * 100)}%`}</span></div>{reference.gaps.length > 0 && <p className="mt-1 text-[10px] leading-4 text-amber-800">存在 {reference.gaps.length} 个未覆盖区间，系统不会把已分析部分冒充整片分析。</p>}</div>}

      <div className="mt-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black text-text-muted">逐镜交接与审核</p><p className="mt-1 text-xs font-bold text-text-primary">表达目标和技术方案分开管理</p></div><span className="flex items-center gap-1 text-[9px] font-bold text-text-muted">内部候选默认收起<ChevronRight size={12} /></span></div>
      <div className="mt-3 space-y-3">{workflow.directorBrief.scenes.map(scene => <SceneRow key={scene.sceneId} scene={scene} execution={executionByScene.get(scene.sceneId)} review={reviewByScene.get(scene.sceneId)} />)}</div>

      {workflow.replicationEvaluation && <section className="mt-4 rounded-xl border border-border bg-surface-2/40 p-3.5" aria-label="成片相似度与原创度检测">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-[10px] font-black text-text-muted">独立媒体评估 Worker</p><p className="mt-1 text-xs font-black text-text-primary">成片相似度与原创度检测</p></div>
          <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black ${workflow.replicationEvaluation.status === 'passed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : workflow.replicationEvaluation.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{workflow.replicationEvaluation.status === 'passed' ? '可进入编导放行' : workflow.replicationEvaluation.status === 'failed' ? '存在硬阻断项' : '等待人工复核'}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {EVALUATION_DIMENSIONS.map(([key, label]) => {
            const result = workflow.replicationEvaluation![key];
            return <article key={key} className={`rounded-lg border p-2.5 ${evaluationTone(result.status)}`}><p className="text-[9px] font-black">{label}</p><p className="mt-1 text-xs font-black">{EVALUATION_STATUS_LABEL[result.status]}{result.score === null ? '' : ` · ${Math.round(result.score)}`}</p><p className="mt-1 line-clamp-3 text-[9px] leading-4 opacity-80">{result.summary}</p></article>;
          })}
        </div>
        {workflow.replicationEvaluation.directorDecision.failedCriteria.length > 0 && <p className="mt-2 text-[10px] leading-4 text-rose-800">逐镜返工／复核：{workflow.replicationEvaluation.directorDecision.failedCriteria.slice(0, 4).join('；')}</p>}
        <p className="mt-2 text-[9px] leading-4 text-text-muted">检测器只验证冻结因素和权利风险，不承诺传播结果；缺少连续帧、音频指纹或身份识别证据时不会自动判定通过。</p>
      </section>}
        </div>
      </details>

      {blocked && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-[10px] font-black text-amber-900">当前不能静默继续</p><p className="mt-1 text-[10px] leading-4 text-amber-800">{workflow.executionPlanReview.requiredRevision.join('；') || '需要补齐事实、权利或可执行候选后重新审核。'}</p></div>}
    </section>
  );
}
