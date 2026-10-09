import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock3,
  FileCheck2,
  Film,
  Loader2,
  Mic2,
  RefreshCcw,
  RotateCcw,
  Subtitles,
  X,
  XCircle,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskStatus,
  SocialContentTaskSummary,
  SocialDirectorPlanSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  socialContentCurrentArtifacts,
  socialContentStatusLabel,
} from '../../lib/socialContentModel';
import {
  contentCreationReviewAdmissionAllowed,
} from '../../lib/contentCreationTestBypass';
import {
  contentProgressNodes,
  formatContentDuration,
  type ContentProgressNodeState,
} from '../../lib/contentProductionExperience';

interface SocialProductionProgressPanelProps {
  task: SocialContentTaskDetail;
  tasks?: SocialContentTaskSummary[];
  taskTotalItems?: number;
  hasMoreTasks?: boolean;
  loadingMoreTasks?: boolean;
  busy: boolean;
  onRefresh: () => void;
  onSelectTask?: (taskId: string) => void;
  onLoadMoreTasks?: () => void;
  onStart?: () => void;
  onPlanReview?: () => void;
  onEdit?: () => void;
  onOpenShots?: () => void;
  onOpenExceptions?: () => void;
  onReview?: () => void;
}

type TaskListItem = SocialContentTaskSummary | SocialContentTaskDetail;

const ACTIVE_STATUSES = new Set<SocialContentTaskStatus>(['producing', 'attention', 'paused', 'packaging']);
const COMPLETE_STATUSES = new Set<SocialContentTaskStatus>(['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed']);
const CONTENT_COMPLETE_STATUSES = new Set<SocialContentTaskStatus>(['asset_review', 'packaging', ...COMPLETE_STATUSES]);

function isTaskDetail(task: TaskListItem): task is SocialContentTaskDetail {
  return 'artifacts' in task;
}

function contentReleaseBlocked(task: TaskListItem): boolean {
  if (!isTaskDetail(task)) return false;
  const evaluation = task.agentWorkflow?.replicationEvaluation;
  return Boolean(evaluation && evaluation.status !== 'passed');
}

function workflowInterruption(task: TaskListItem): string | null {
  if (!isTaskDetail(task)) return null;
  const stage = task.agentWorkflow?.stage;
  if (stage === 'needs_facts') return '缺少可核验的产品事实，请补充资料后继续';
  if (stage === 'needs_rights') return '素材使用权尚未确认，请确认后继续';
  if (stage === 'needs_budget') return '预计费用超出预算，请调整方案后继续';
  if (stage === 'goal_degraded') return '当前方案会降低成片目标，请补充素材或改为概念样片';
  if (stage === 'failed_recoverable') return '本次制作未完成；请查看原因并补充素材后继续';
  return null;
}

function taskCounts(task: TaskListItem): { generated: number; pendingReview: number } {
  if (isTaskDetail(task)) {
    const artifacts = socialContentCurrentArtifacts(task.artifacts);
    return {
      generated: artifacts.length,
      pendingReview: artifacts.filter(item => item.status === 'review_required').length,
    };
  }
  return {
    generated: task.artifactCount,
    pendingReview: task.status === 'asset_review'
      ? Math.max(0, task.artifactCount - task.approvedArtifactCount)
      : 0,
  };
}

function directorPlanComplete(task: TaskListItem): boolean {
  return (isTaskDetail(task) && task.agentWorkflow?.directorBrief.status === 'ready')
    || task.directorPlan?.status === 'ready'
    || CONTENT_COMPLETE_STATUSES.has(task.status);
}

function canProduceWithoutCustomerShoot(task: TaskListItem): boolean {
  const feasibility = task.assetSupplyPlan?.overallFeasibility;
  return feasibility === 'full_fidelity' || feasibility === 'functional_equivalent';
}

function automaticStep(task: TaskListItem): string {
  const interruption = workflowInterruption(task);
  if (interruption) return interruption;
  if ((task.status === 'draft' || task.status === 'needs_input') && canProduceWithoutCustomerShoot(task)) return '逐镜方案已确认可完整或等价实现，确认事实后即可自动制作';
  if (task.status === 'draft' || task.status === 'needs_input') return '等待必要资料确认';
  if (task.status === 'plan_review') return '确认任务后，编导 Agent 会先完成导演方案';
  if (task.status === 'producing' && !directorPlanComplete(task)) return '编导 Agent 正在整理脚本、口播、字幕与镜头节奏';
  if (task.status === 'producing') return '内容 Agent 正按编导方案生成配音、字幕并剪辑视频';
  if (task.status === 'attention') return '系统正在自动切换可用模型或素材来源；如需确认产品事实或版权，会单独列出';
  if (task.status === 'paused') {
    if (isTaskDetail(task) && task.agentWorkflow?.stage === 'needs_facts') return '缺少可核验的产品事实，请补充资料后继续';
    if (isTaskDetail(task) && task.agentWorkflow?.stage === 'needs_rights') return '素材使用权尚未确认，请确认后继续';
    if (isTaskDetail(task) && task.agentWorkflow?.stage === 'needs_budget') return '预计费用超出预算，请调整方案后继续';
    if (isTaskDetail(task) && task.agentWorkflow?.stage === 'goal_degraded') return '当前只能降低目标，需要你确认生成概念样片还是补充素材';
    return '自动处理遇到可恢复问题，现有方案和素材已保留';
  }
  if (task.status === 'asset_review') return contentReleaseBlocked(task) ? '视频已生成，但内容检查未通过，需要修改' : '视频、口播和字幕已经生成，等待你审核';
  if (task.status === 'packaging') return '正在整理视频、封面、文案和发布包';
  if (task.status === 'delivered' || task.status === 'awaiting_publish') return '成品与发布包已经准备完成';
  if (task.status === 'awaiting_metrics') return '等待发布数据回收';
  return '本轮内容任务已经完成';
}

function milestoneTone(state: ContentProgressNodeState): string {
  if (state === 'complete') return 'border-emerald-500 bg-emerald-500 text-white';
  if (state === 'active') return 'border-blue-500 bg-blue-50 text-blue-700';
  if (state === 'blocked') return 'border-amber-500 bg-amber-50 text-amber-700';
  if (state === 'failed') return 'border-rose-500 bg-rose-50 text-rose-700';
  return 'border-slate-300 bg-white text-slate-300';
}

function milestoneTextTone(state: ContentProgressNodeState): string {
  if (state === 'complete') return 'text-emerald-800';
  if (state === 'active') return 'text-blue-800';
  if (state === 'blocked') return 'text-amber-900';
  if (state === 'failed') return 'text-rose-800';
  return 'text-slate-400';
}

function milestoneStateLabel(state: ContentProgressNodeState): string {
  if (state === 'complete') return '已完成';
  if (state === 'active') return '进行中';
  if (state === 'blocked') return '需处理';
  if (state === 'failed') return '失败';
  return '等待中';
}

function TaskMilestoneRail({ task }: { task: TaskListItem }) {
  const milestones = contentProgressNodes(task);
  return (
    <span className="mt-3 block rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3" data-content-milestone-rail>
      <span className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[9px] font-semibold tracking-[0.08em] text-slate-500">任务进度 · 自动保存</span>
        <span className="text-[9px] font-bold text-slate-400">共 7 个节点</span>
      </span>
      <span className="block">
        {milestones.map((milestone, index) => {
          const nextState = milestones[index + 1]?.state;
          const completedConnector = milestone.state === 'complete' && nextState === 'complete';
          return (
            <span key={milestone.id} className="relative flex min-h-14 items-start gap-3 last:min-h-0">
              {index < milestones.length - 1 && <span className={`absolute bottom-0 left-[9px] top-[20px] w-0.5 ${completedConnector ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
              <span className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${milestoneTone(milestone.state)}`}>
                {milestone.state === 'complete' ? <CheckCircle2 size={12} />
                  : milestone.state === 'active' ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />
                    : milestone.state === 'blocked' ? <AlertTriangle size={11} />
                      : milestone.state === 'failed' ? <XCircle size={11} />
                        : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className="min-w-0 flex-1 pb-3">
                <span className="flex items-start justify-between gap-2">
                  <span className={`text-[10px] font-semibold ${milestoneTextTone(milestone.state)}`}>{milestone.label}</span>
                  <span className={`shrink-0 text-[9px] font-semibold ${milestoneTextTone(milestone.state)}`}>{milestoneStateLabel(milestone.state)}</span>
                </span>
                <span className={`mt-0.5 block text-[9px] leading-4 ${milestone.state === 'pending' ? 'text-slate-400' : 'text-slate-600'}`}>{milestone.result}</span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

function compactHeadline(task: SocialContentTaskDetail): string {
  const counts = taskCounts(task);
  if (workflowInterruption(task)) return '制作遇到问题，已有资料和进度均已保留';
  if ((counts.pendingReview > 0 || task.status === 'asset_review') && contentReleaseBlocked(task)) return '成片需要修改，当前不可发布';
  if (counts.pendingReview > 0 || task.status === 'asset_review') return '内容已经生成，等待你审核';
  if (COMPLETE_STATUSES.has(task.status)) return '本轮内容已经制作完成';
  if ((task.status === 'draft' || task.status === 'needs_input') && canProduceWithoutCustomerShoot(task)) return '逐镜托管方案已就绪，可以开始自动制作';
  if (task.status === 'draft' || task.status === 'needs_input') return '确认必要信息后，机器人会自动开始制作';
  if (task.status === 'plan_review') return '确认后，编导 Agent 会先完成导演方案';
  if (task.directorPlan?.status === 'blocked') return '编导方案正在自动检查与修复';
  if (!directorPlanComplete(task)) return '编导 Agent 正在准备导演方案';
  return '内容 Agent 正在按导演方案生成视频';
}

function activeAgentLabel(task: TaskListItem): string {
  if (workflowInterruption(task)) return '需要处理';
  if (task.status === 'draft' || task.status === 'needs_input' || task.status === 'plan_review') return '等待开始';
  if (task.directorPlan?.status === 'blocked') return '编导 Agent 自动修复中';
  if (!directorPlanComplete(task)) return '编导 Agent 策划中';
  if (!CONTENT_COMPLETE_STATUSES.has(task.status)) return '内容 Agent 制作中';
  if (contentReleaseBlocked(task)) return '成片需要修改';
  return socialContentStatusLabel(task.status);
}

type AgentStepState = 'pending' | 'current' | 'complete' | 'blocked' | 'unavailable';

function agentStepTone(state: AgentStepState): string {
  if (state === 'complete') return 'border-emerald-200 bg-emerald-50/70 text-emerald-800';
  if (state === 'current') return 'border-blue-200 bg-blue-50/70 text-blue-800';
  if (state === 'blocked') return 'border-amber-200 bg-amber-50/70 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function agentStepLabel(state: AgentStepState): string {
  if (state === 'complete') return '已完成';
  if (state === 'current') return '进行中';
  if (state === 'blocked') return '自动修复中';
  if (state === 'unavailable') return '未记录';
  return '等待中';
}

function directorSourceLabel(source: SocialDirectorPlanSummary['scriptSource']): string {
  if (source === 'reference_analysis') return '参考视频逐镜分析';
  if (source === 'asset_supply_plan') return '系统托管素材方案';
  if (source === 'inspiration_script') return '灵感中心参考脚本';
  if (source === 'knowledge_fallback') return '已确认的企业资料与素材';
  return '平台通用安全结构';
}

function DirectorAgentHandoff({ task }: { task: TaskListItem }) {
  const plan = task.directorPlan;
  const beforeStart = ['draft', 'needs_input', 'plan_review'].includes(task.status);
  const directorComplete = directorPlanComplete(task);
  const contentComplete = CONTENT_COMPLETE_STATUSES.has(task.status);
  const directorState: AgentStepState = !plan && contentComplete
    ? 'unavailable'
    : plan?.status === 'blocked'
      ? 'blocked'
      : directorComplete
        ? 'complete'
        : beforeStart
          ? 'pending'
          : 'current';
  const contentState: AgentStepState = contentComplete
    ? 'complete'
    : directorComplete && !beforeStart
      ? 'current'
      : 'pending';
  const summaryRows = plan?.status === 'ready' ? [
    { label: '脚本', value: plan.scriptSummary, icon: Clapperboard },
    { label: '口播', value: plan.voiceoverSummary, icon: Mic2 },
    { label: '字幕', value: plan.subtitleSummary, icon: Subtitles },
    { label: '镜头与节奏', value: plan.shotRhythmSummary, icon: Film },
  ] : [];

  return (
    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
      <p className="text-[9px] font-semibold tracking-[0.08em] text-slate-500">自动制作接力</p>
      <div className="mt-2 grid gap-2">
        <div className={`rounded-lg border px-3 py-2.5 ${agentStepTone(directorState)}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold"><Clapperboard size={14} />编导 Agent</span>
            <span className="text-[9px] font-semibold">{agentStepLabel(directorState)}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 opacity-80">定义钩子、叙事、逐镜视觉目标、事实边界和验收标准，不预选模型或供应商</p>
        </div>
        <div className={`rounded-lg border px-3 py-2.5 ${agentStepTone(contentState)}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold"><Bot size={14} />内容 Agent</span>
            <span className="text-[9px] font-semibold">{agentStepLabel(contentState)}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 opacity-80">检索候选素材与能力，比较成本、耗时、成功率和权利风险；编导审核通过后执行</p>
        </div>
      </div>

      {plan?.status === 'ready' && (
        <details className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[11px] font-semibold text-slate-800">
            <span>查看导演方案摘要</span>
            <span className="shrink-0 text-[9px] font-bold text-slate-500">{plan.sceneCount} 个镜头 · {plan.language === 'zh' ? '中文' : '英文'}</span>
          </summary>
          <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3">
            <p className="text-[10px] leading-4 text-slate-500">方案依据：{directorSourceLabel(plan.scriptSource)}。导演方案会直接交给内容 Agent，不需要你逐项填写。</p>
            {summaryRows.map(row => <div key={row.label} className="rounded-lg bg-white px-3 py-2 shadow-none"><p className="flex items-center gap-1.5 text-[9px] font-semibold text-emerald-700"><row.icon size={11} />{row.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-700">{row.value}</p></div>)}
          </div>
        </details>
      )}
      {plan?.status === 'blocked' && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">编导方案暂未通过自动检查，机器人会保留现有资料、切换素材来源并继续修复。</p>}
    </div>
  );
}

function statusTone(status: SocialContentTaskStatus): string {
  if (status === 'asset_review') return 'bg-amber-50 text-amber-800';
  if (COMPLETE_STATUSES.has(status)) return 'bg-emerald-50 text-emerald-800';
  if (status === 'attention' || status === 'paused') return 'bg-amber-50 text-amber-800';
  return 'bg-blue-50 text-blue-700';
}

function StatusGraphic({ task }: { task: SocialContentTaskDetail }) {
  const counts = taskCounts(task);
  const active = ACTIVE_STATUSES.has(task.status) || Boolean(task.runId && counts.generated === 0);
  const review = counts.pendingReview > 0 || task.status === 'asset_review';
  const complete = COMPLETE_STATUSES.has(task.status);

  if (review) return <CheckCircle2 size={19} aria-hidden />;
  if (complete) return <FileCheck2 size={19} aria-hidden />;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
      {active && <span className="absolute inset-0 animate-spin rounded-full border-2 border-emerald-100 border-t-emerald-600 motion-reduce:animate-none" />}
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Bot size={17} />
      </span>
    </span>
  );
}

export default function SocialProductionProgressPanel({
  task,
  tasks = [],
  taskTotalItems = tasks.length,
  hasMoreTasks = false,
  loadingMoreTasks = false,
  busy,
  onRefresh,
  onSelectTask,
  onLoadMoreTasks,
  onStart,
  onPlanReview,
  onEdit,
  onOpenShots,
  onOpenExceptions,
  onReview,
}: SocialProductionProgressPanelProps) {
  const [open, setOpen] = useState(false);
  const drawerTitleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousStatusRef = useRef<SocialContentTaskStatus>(task.status);
  const counts = taskCounts(task);
  const active = ACTIVE_STATUSES.has(task.status) || Boolean(task.runId && counts.generated === 0);
  const remainingTaskCount = Math.max(0, taskTotalItems - tasks.length);
  const taskItems: TaskListItem[] = [task, ...tasks.filter(item => item.taskId !== task.taskId)];
  const taskStartAllowed = task.readiness.complete
    && (!task.agentWorkflow
      || contentCreationReviewAdmissionAllowed(task.agentWorkflow.executionPlanReview));

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = task.status;
    if (previousStatus === 'plan_review' && ['producing', 'attention', 'paused'].includes(task.status)) setOpen(true);
  }, [task.status]);

  useEffect(() => {
    if (!open) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus();
    };
  }, [open]);

  const selectTask = (taskId: string) => {
    onSelectTask?.(taskId);
  };

  const currentAction = (() => {
    if (workflowInterruption(task)) {
      const action = onOpenExceptions || onEdit;
      return action ? { label: '查看异常与恢复位置', icon: <ChevronRight size={14} />, action } : null;
    }
    if (task.status === 'draft' || task.status === 'needs_input') {
      if (taskStartAllowed && onStart) {
        return { label: '开始自动制作', icon: <Bot size={14} />, action: onStart };
      }
      return onEdit ? { label: canProduceWithoutCustomerShoot(task) ? '确认任务信息' : '补充任务资料', icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'plan_review') {
      const estimate = task.agentWorkflow?.executionPlan.estimatedTotalCostCny;
      return onPlanReview ? { label: typeof estimate === 'number' ? `查看费用与效果 · 预计 ¥${estimate.toFixed(2)}` : '查看费用与效果', icon: <Bot size={14} />, action: onPlanReview } : null;
    }
    if (task.status === 'attention') {
      const action = onOpenExceptions || onEdit;
      return action ? { label: '查看需确认事项', icon: <ChevronRight size={14} />, action } : null;
    }
    if (task.status === 'paused') {
      return onStart ? { label: '继续自动处理', icon: <RotateCcw size={14} />, action: onStart } : null;
    }
    if (task.status === 'asset_review') {
      if (contentReleaseBlocked(task)) {
        return onEdit ? { label: '继续修改并补充素材', icon: <ChevronRight size={14} />, action: onEdit } : null;
      }
      return onReview ? { label: '审核生成结果', icon: <CheckCircle2 size={14} />, action: onReview } : null;
    }
    if (task.status === 'producing' && onOpenShots) {
      return { label: '查看逐镜制作进度', icon: <Film size={14} />, action: onOpenShots };
    }
    return null;
  })();

  return (
    <div className="fixed bottom-24 right-4 z-40 sm:right-6" data-social-production-progress>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-left  transition hover:border-emerald-300  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:max-w-[19rem]"
      >
        <span className={counts.pendingReview > 0 ? 'text-amber-700' : 'text-emerald-700'}>
          <StatusGraphic task={task} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold tracking-[0.08em] text-emerald-700">
            {active ? activeAgentLabel(task) : socialContentStatusLabel(task.status)}
          </span>
          <span role="status" aria-live="polite" className="mt-0.5 block truncate text-xs font-semibold leading-5 text-slate-900">
            {compactHeadline(task)}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">查看制作任务</span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80]" role="presentation">
          <button
            type="button"
            aria-label="关闭制作任务详情"
            className="absolute inset-0 bg-slate-950/35 -[1px]"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-[#f7f9f7] "
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.1em] text-emerald-700">AI 制作团队</p>
                <h2 id={drawerTitleId} className="mt-0.5 text-lg font-semibold text-slate-950">制作任务</h2>
                <p className="mt-1 text-xs text-slate-500">编导 Agent 定方案，内容 Agent 生成视频</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={busy} onClick={onRefresh} aria-label="刷新制作任务" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCcw size={16} /></button>
                <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="关闭制作任务" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
              <div className="space-y-3">
                {taskItems.map(item => {
                  const selected = item.taskId === task.taskId;
                  const itemCounts = taskCounts(item);
                  const itemActive = ACTIVE_STATUSES.has(item.status);
                  return (
                    <article key={item.taskId} className={`overflow-hidden rounded-lg border bg-white transition ${selected ? 'border-emerald-300 ' : 'border-slate-200'}`}>
                      <button
                        type="button"
                        onClick={() => selectTask(item.taskId)}
                        aria-current={selected ? 'true' : undefined}
                        className="w-full px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-950">{item.brief.title}</span>
                            <span className="mt-1 block text-[10px] font-semibold text-slate-500">更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusTone(item.status)}`}>{itemActive ? activeAgentLabel(item) : socialContentStatusLabel(item.status)}</span>
                        </span>

                        <span className="mt-4 flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-3">
                          <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-none">
                            {itemActive && <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-emerald-600 motion-reduce:animate-none" aria-hidden />}
                            <Bot size={14} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[9px] font-semibold tracking-[0.06em] text-slate-500">当前自动步骤</span>
                            <span className="mt-0.5 block text-xs font-bold leading-5 text-slate-800">{automaticStep(item)}</span>
                          </span>
                        </span>

                        <TaskMilestoneRail task={item} />

                        <span className="mt-3 grid grid-cols-2 gap-2">
                          <span className="rounded-lg border border-slate-100 px-3 py-2.5">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><Clock3 size={11} />提交时间</span>
                            <strong className="mt-1 block text-[10px] text-slate-900">{new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                          </span>
                          <span className="rounded-lg border border-slate-100 px-3 py-2.5">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><FileCheck2 size={11} />结果与预计</span>
                            <strong className={`mt-1 block text-[10px] ${itemCounts.pendingReview > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                              {isTaskDetail(item) && item.productionProgress?.estimatedRemainingSeconds != null
                                ? `剩余 ${formatContentDuration(item.productionProgress.estimatedRemainingSeconds)}`
                                : itemCounts.generated > 0 ? `${itemCounts.generated} 项成果` : '等待实时估算'}
                            </strong>
                          </span>
                        </span>
                      </button>

                      {selected && <DirectorAgentHandoff task={item} />}

                      {selected && currentAction && (
                        <div className="border-t border-slate-100 px-4 py-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setOpen(false);
                              currentAction.action();
                            }}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : currentAction.icon}
                            {currentAction.label}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {hasMoreTasks && onLoadMoreTasks && (
                <button
                  type="button"
                  disabled={busy || loadingMoreTasks}
                  onClick={onLoadMoreTasks}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {loadingMoreTasks && <Loader2 size={14} className="animate-spin" />}
                  {loadingMoreTasks ? '正在加载任务' : `加载更多任务${remainingTaskCount > 0 ? `（${remainingTaskCount}）` : ''}`}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
