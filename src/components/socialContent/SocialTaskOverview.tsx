import { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Image,
  PackageCheck,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import type { Page } from '../../App';
import type {
  SocialContentArtifact,
  SocialContentTaskDetail,
  SocialContentTaskMode,
  SocialContentTaskSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  socialContentCanRegisterPublication,
  socialContentCurrentArtifacts,
  socialContentCurrentDelivery,
} from '../../lib/socialContentModel';
import SocialArtifactPreviewDialog from './SocialArtifactPreviewDialog';
import SocialProductionProgressPanel from './SocialProductionProgressPanel';
import SocialReplicationAnalysisPanel from './SocialReplicationAnalysisPanel';
import SocialAgentWorkflowPanel from './SocialAgentWorkflowPanel';
import SocialGenerationConfirmationCard from './SocialGenerationConfirmationCard';
import SocialWeeklySummary from './SocialWeeklySummary';
import ContentProductionExperiencePanel, { type ContentProductionView } from './ContentProductionExperiencePanel';
import AgentDecisionCard from '../AgentDecisionCard';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
import {
  contentCreationReviewAdmissionAllowed,
  contentCreationTestBypassEnabled,
} from '../../lib/contentCreationTestBypass';
import { PLATFORM_OPTIONS, artifactKindLabel, contentLanguageLabel, optionLabel, packageVersionLabel } from './socialContentUi';
import { contentProductionExceptions } from '../../lib/contentProductionExperience';

const ARTIFACT_STATUS: Record<SocialContentArtifact['status'], string> = {
  draft: '制作中',
  review_required: '待确认',
  approved: '已确认',
  changes_requested: '修改中',
  superseded: '历史版本',
};
const READINESS_LABEL: Record<string, string> = {
  product: '产品或业务主题',
  audience: '目标客户',
  market: '目标市场',
  language: '内容语言',
  platform: '发布平台',
  content_format: '内容形式',
  source_material: '本次任务资料',
  enterprise_knowledge: '已确认的企业资料',
  theme_confirmation: '自定义主题归类确认',
};

function artifactPreview(content: Record<string, unknown> | null): string {
  if (!content) return '';
  for (const key of ['title', 'headline', 'caption', 'copy', 'text', 'summary']) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return '';
}

interface SocialTaskOverviewProps {
  task: SocialContentTaskDetail | null;
  tasks: SocialContentTaskSummary[];
  taskTotalItems: number;
  hasMoreTasks: boolean;
  loadingMoreTasks: boolean;
  busy: boolean;
  onSelectTask: (taskId: string) => void;
  onLoadMoreTasks: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onStart: () => void;
  onDownload: () => void;
  onOpenPublication: () => void;
  onOpenMetrics: () => void;
  onArtifactDecision: (artifact: SocialContentArtifact, decision: 'approved' | 'changes_requested') => void;
  onBatchDecision: (decision: 'approved' | 'changes_requested') => void;
  onCreateDeliveryPackage: () => void;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
  createMode?: SocialContentTaskMode;
}

function ReadinessPanel({ task }: { task: SocialContentTaskDetail }) {
  const sources = task.sources.filter(item => item.status === 'active');
  const hasKnowledge = sources.some(item => item.kind === 'knowledge');
  const hasMaterial = sources.some(item => item.kind === 'material');
  const testBypass = contentCreationTestBypassEnabled();
  const workflowReady = task.agentWorkflow
    ? contentCreationReviewAdmissionAllowed(task.agentWorkflow.executionPlanReview)
    : true;
  const managedWithoutShoot = workflowReady && (task.assetSupplyPlan?.overallFeasibility === 'full_fidelity'
    || task.assetSupplyPlan?.overallFeasibility === 'functional_equivalent');
  const canStart = task.readiness.complete && workflowReady;
  const explicitReferenceCount = sources.filter(item => item.kind === 'reference_link').length;
  const analyzedReferenceCount = task.referenceVideoAnalysis ? 1 : 0;
  const handoffReferenceCount = task.agentWorkflow?.inspirationHandoffs.length ?? 0;
  const readinessTitle = !workflowReady
    ? task.agentWorkflow?.stage === 'needs_facts'
      ? '还需要最少必要事实'
      : task.agentWorkflow?.stage === 'needs_rights'
        ? '还需要确认素材权利'
        : task.agentWorkflow?.stage === 'goal_degraded'
          ? '需要确认是否接受目标降级'
          : '编导分析或执行方案尚未完成'
    : managedWithoutShoot
    ? '零素材托管方案已就绪，可直接制作'
    : hasMaterial && canStart
    ? '真实素材已就绪，可以制作'
    : canStart
      ? '系统托管方案已就绪，可以制作'
      : `还差 ${task.readiness.missing.length} 项`;
  const sourceStats = [
    { label: '客户素材', value: sources.filter(item => item.kind === 'material').length, icon: Image },
    { label: '企业资料', value: sources.filter(item => item.kind === 'knowledge').length, icon: FileText },
    { label: '参考内容', value: Math.max(explicitReferenceCount, analyzedReferenceCount, handoffReferenceCount), icon: ExternalLink },
  ];
  return (
    <section className="rounded-lg border border-border bg-white p-5 shadow-none">
      {testBypass && <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] font-semibold leading-4 text-sky-900">本地演示仅允许超出预算后继续；资料完整性、事实、素材权利与成片质量仍严格检查。</div>}
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">准备情况</p><h3 className="mt-1 text-base font-semibold text-text-primary">{readinessTitle}</h3>{canStart && !hasKnowledge && <p className="mt-1 text-[10px] text-text-muted">企业资料可选；未提供时系统不会编造参数或功效。</p>}{managedWithoutShoot && <p className="mt-1 text-[10px] text-emerald-700">系统已逐镜确认可以完整实现或功能等价实现；补充实拍只作为可选增强。</p>}{task.assetSupplyPlan?.overallFeasibility === 'blocked_for_facts_or_rights' && <p className="mt-1 text-[10px] text-amber-800">部分镜头缺少不可替代的事实或权利信息，系统不会用生成画面冒充真实证据。</p>}</div><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${canStart ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{canStart ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2">{sourceStats.map(item => <div key={item.label} className="rounded-lg bg-surface-2 px-3 py-2.5"><item.icon size={14} className="text-text-muted" /><strong className="mt-2 block text-lg text-text-primary">{item.value}</strong><span className="text-[10px] font-semibold text-text-muted">{item.label}</span></div>)}</div>
      {task.materialRequirements && task.materialRequirements.length > 0 && <div className="mt-4 space-y-2"><div><p className="text-[11px] font-semibold text-text-secondary">可选的拍摄与素材建议</p><p className="mt-1 text-[10px] text-text-muted">不会影响开始制作；编导 Agent 会结合现有素材安排导演方案。</p></div>{task.materialRequirements.map(item => <div key={item.requirementId} className="rounded-lg border border-border bg-white px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-text-primary">{item.shotFunction}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">可补充 {item.subject} · {item.action}{item.environment ? ` · ${item.environment}` : ''}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${item.status === 'satisfied' ? 'bg-emerald-50 text-emerald-700' : item.status === 'unusable' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{item.status === 'satisfied' ? '已有素材' : '可选补充'}</span></div></div>)}</div>}
      {!canStart && task.readiness.missing.length > 0 && <ul className="mt-4 space-y-1.5">{task.readiness.missing.filter(item => !item.startsWith('material_requirement:') && item !== 'publish_ready_material' && item !== 'source_material').slice(0, 4).map(item => <li key={item} className="flex items-start gap-2 text-xs text-amber-800"><Circle size={6} fill="currentColor" className="mt-1.5 shrink-0" />{`请补充${READINESS_LABEL[item] || '任务资料'}`}</li>)}</ul>}
    </section>
  );
}

function ArtifactPanel({ task, busy, onArtifactDecision, onBatchDecision, onCreateDeliveryPackage }: Pick<SocialTaskOverviewProps, 'busy' | 'onArtifactDecision' | 'onBatchDecision' | 'onCreateDeliveryPackage'> & { task: SocialContentTaskDetail }) {
  const currentArtifacts = socialContentCurrentArtifacts(task.artifacts);
  const pendingArtifacts = currentArtifacts.filter(artifact => artifact.status === 'review_required' && socialArtifactGenerationDisclosure(artifact).approvalAllowed);
  const readyToPackage = currentArtifacts.length > 0 && currentArtifacts.every(artifact => artifact.status === 'approved') && task.deliveryPackages.length === 0;
  const [previewArtifact, setPreviewArtifact] = useState<SocialContentArtifact | null>(null);
  return (
    <section id="social-task-artifacts" className="rounded-lg border border-border bg-white p-5 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">批次验收</p><h3 className="mt-1 text-base font-semibold text-text-primary">{currentArtifacts.length > 0 ? `${currentArtifacts.length} 项内容` : '内容制作'}</h3></div>{readyToPackage && <button type="button" disabled={busy} onClick={onCreateDeliveryPackage} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"><PackageCheck size={13} />整理交付包</button>}</div>
      {pendingArtifacts.length > 0 && <div className="mt-4"><AgentDecisionCard
        kind="content_approval"
        title={`确认本批 ${pendingArtifacts.length} 项内容`}
        summary="确认后进入交付或发布环节；退回会保留当前版本与修改记录。"
        cost={task.brief.weeklyBudgetCny ? `预算 ¥${task.brief.weeklyBudgetCny.toFixed(2)}` : task.brief.perItemBudgetCny ? `单项 ¥${task.brief.perItemBudgetCny.toFixed(2)}` : '未单独设置'}
        outputs={{ count: pendingArtifacts.length, format: [...new Set(pendingArtifacts.map(item => artifactKindLabel(item.kind)))].join(' / ') }}
        facts={[{ label: '任务来源', value: task.mode === 'weekly' ? '经营周计划' : '手动单项' }, { label: '计划版本', value: task.weeklyPlanId ? `${task.weeklyPlanId} · ${task.version}` : task.version }]}
        primary={{ label: `确认本批 ${pendingArtifacts.length} 项`, disabled: busy, onClick: () => onBatchDecision('approved') }}
        secondary={{ label: '批量退回', disabled: busy, onClick: () => onBatchDecision('changes_requested') }}
      /></div>}
      {currentArtifacts.length === 0 ? <div className="mt-5 rounded-lg bg-surface-2 px-4 py-6 text-center"><Sparkles size={18} className="mx-auto text-emerald-600" /><p className="mt-2 text-xs font-semibold text-text-muted">首批内容完成后将在这里出现</p></div> : <div role="list" aria-label={`全部 ${currentArtifacts.length} 项内容成品`} className="mt-4 max-h-[34rem] divide-y divide-border overflow-y-auto overscroll-contain pr-1">{currentArtifacts.map(artifact => {
        const preview = artifactPreview(artifact.content);
        const generation = socialArtifactGenerationDisclosure(artifact);
        return <article role="listitem" key={artifact.artifactId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-muted"><FileCheck2 size={16} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-text-primary">{artifactKindLabel(artifact.kind)}</p><p className="mt-0.5 text-[10px] text-text-muted">{[artifact.platform && optionLabel(PLATFORM_OPTIONS, artifact.platform), contentLanguageLabel(artifact.language), packageVersionLabel(artifact.version)].filter(Boolean).join(' · ')}</p><p className={`mt-1 text-[10px] font-bold ${generation.approvalAllowed ? 'text-emerald-700' : 'text-amber-700'}`}>{generation.sourceLabel} · {generation.verificationLabel}</p>{preview && <p className="mt-1 truncate text-[11px] text-text-secondary">{preview}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${artifact.status === 'review_required' ? 'bg-amber-50 text-amber-800' : artifact.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-surface-2 text-text-muted'}`}>{ARTIFACT_STATUS[artifact.status]}</span><button type="button" onClick={() => setPreviewArtifact(artifact)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">预览</button>{artifact.status === 'review_required' && <div className="flex gap-1.5"><button type="button" disabled={busy} onClick={() => onArtifactDecision(artifact, 'changes_requested')} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">退回修改</button><button type="button" disabled={busy || !generation.approvalAllowed} title={generation.approvalAllowed ? undefined : generation.verificationLabel} onClick={() => onArtifactDecision(artifact, 'approved')} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">确认</button></div>}</article>;
      })}</div>}
      {previewArtifact && <SocialArtifactPreviewDialog artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </section>
  );
}

function DeliveryPanel({ task, busy, onDownload, onOpenPublication, onOpenMetrics }: Pick<SocialTaskOverviewProps, 'busy' | 'onDownload' | 'onOpenPublication' | 'onOpenMetrics'> & { task: SocialContentTaskDetail }) {
  const delivery = socialContentCurrentDelivery(task);
  const lastPublication = task.publications.at(-1);
  const canRegisterPublication = socialContentCanRegisterPublication(task);
  const metricCount = lastPublication ? task.metricSubmissions.filter(item => item.publicationId === lastPublication.publicationId).length : 0;
  const heading = task.metricSubmissions.length > 0 ? '发布数据已回传'
    : lastPublication ? '发布结果已登记'
      : delivery?.status === 'preparing' ? '正在整理交付包'
        : canRegisterPublication ? '交付包已准备好' : '等待交付';
  return (
    <section className="rounded-lg border border-border bg-white p-5 shadow-none">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">交付与回收</p><h3 className="mt-1 text-base font-semibold text-text-primary">{heading}</h3></div><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><PackageCheck size={20} /></span></div>
      <div className="mt-4 space-y-2.5">
        {delivery && <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-3"><div><p className="text-xs font-bold text-text-primary">交付包 · {packageVersionLabel(delivery.version)}</p><p className="mt-0.5 text-[10px] text-text-muted">{delivery.artifactIds.length} 项内容</p></div>{delivery.downloadHref && <button type="button" disabled={busy} onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-emerald-700 shadow-none"><Download size={12} />下载</button>}</div>}
        {lastPublication && <div className="rounded-lg bg-surface-2 px-3 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-text-primary">{optionLabel(PLATFORM_OPTIONS, lastPublication.platform)} 已发布</p><p className="mt-0.5 text-[10px] text-text-muted">{lastPublication.accountLabel || new Date(lastPublication.publishedAt).toLocaleString('zh-CN')}</p></div><span className="text-[10px] font-bold text-text-muted">已回传 {metricCount} 次</span></div></div>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{canRegisterPublication && <button type="button" disabled={busy} onClick={onOpenPublication} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2"><Send size={13} />{task.publications.length > 0 ? '登记其他平台' : '登记发布'}</button>}{task.publications.length > 0 && <button type="button" disabled={busy} onClick={onOpenMetrics} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2"><BarChart3 size={13} />{task.metricSubmissions.length > 0 ? '继续回传数据' : '回传数据'}</button>}</div>
    </section>
  );
}

export default function SocialTaskOverview(props: SocialTaskOverviewProps) {
  const { task, onCreate, createMode } = props;
  const [productionView, setProductionView] = useState<ContentProductionView>('overview');
  useEffect(() => {
    if (!task) return;
    setProductionView(contentProductionExceptions(task).length > 0
      ? 'exceptions'
      : ['producing', 'attention', 'paused'].includes(task.status) ? 'shots' : 'overview');
  }, [task?.taskId]);
  if (!task) {
    const weekly = createMode === 'weekly';
    return (
      <section className="rounded-lg border border-dashed border-border-bright bg-white px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Sparkles size={18} /></span>
            <div><p className="text-sm font-semibold text-text-primary">{weekly ? '还没有本周内容计划' : '还没有内容任务'}</p><p className="mt-1 text-xs text-text-muted">{weekly ? '先安排本周重点，后续单条内容会进入内容制作页。' : '从上方选择自由创作或爆款复刻；没有素材也能开始。'}</p></div>
          </div>
          <button type="button" onClick={onCreate} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-semibold text-text-secondary transition hover:border-border-bright hover:bg-surface-2"><Plus size={14} />{weekly ? '安排本周内容' : '从空白创建'}</button>
        </div>
      </section>
    );
  }
  const showDelivery = Boolean(
    socialContentCurrentDelivery(task)
    || task.publications.length > 0
    || task.metricSubmissions.length > 0
    || socialContentCanRegisterPublication(task),
  );
  const openProductionView = (view: ContentProductionView) => {
    setProductionView(view);
    window.requestAnimationFrame(() => document.getElementById('social-production-experience')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <div className="space-y-4 pb-8">
      <SocialProductionProgressPanel
        task={task}
        tasks={props.tasks}
        taskTotalItems={props.taskTotalItems}
        hasMoreTasks={props.hasMoreTasks}
        loadingMoreTasks={props.loadingMoreTasks}
        busy={props.busy}
        onRefresh={props.onRefresh}
        onSelectTask={props.onSelectTask}
        onLoadMoreTasks={props.onLoadMoreTasks}
        onStart={props.onStart}
        onPlanReview={() => document.getElementById('social-generation-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        onEdit={props.onEdit}
        onOpenShots={() => openProductionView('shots')}
        onOpenExceptions={() => openProductionView('exceptions')}
        onReview={() => document.getElementById('social-task-artifacts')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      />
      <div className="min-w-0 space-y-4">
        <SocialGenerationConfirmationCard task={task} busy={props.busy} onConfirm={props.onStart} />
        <ContentProductionExperiencePanel
          task={task}
          busy={props.busy}
          view={productionView}
          onViewChange={setProductionView}
          onOpenWorkbench={props.onEdit}
          onRetry={props.onStart}
        />
        {task.mode === 'weekly' && <SocialWeeklySummary task={task} onEdit={props.onEdit} />}
        <div className={`grid gap-4 ${showDelivery ? 'xl:grid-cols-2' : ''}`}>
          <ReadinessPanel task={task} />
          {showDelivery && <DeliveryPanel task={task} busy={props.busy} onDownload={props.onDownload} onOpenPublication={props.onOpenPublication} onOpenMetrics={props.onOpenMetrics} />}
        </div>
        <SocialAgentWorkflowPanel task={task} />
        <SocialReplicationAnalysisPanel task={task} />
        <ArtifactPanel task={task} busy={props.busy} onArtifactDecision={props.onArtifactDecision} onBatchDecision={props.onBatchDecision} onCreateDeliveryPackage={props.onCreateDeliveryPackage} />
      </div>
    </div>
  );
}
