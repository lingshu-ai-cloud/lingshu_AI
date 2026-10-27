import { useEffect, useRef } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  XCircle,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskStatus,
  SocialContentTaskSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  socialContentCurrentArtifacts,
  socialContentStatusLabel,
} from '../../lib/socialContentModel';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';

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

function StatusGraphic({ task }: { task: SocialContentTaskDetail }) {
  const counts = taskCounts(task);
  if (task.status === 'cancelling' || task.status === 'cancelled') return <XCircle size={19} aria-hidden />;
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
}: SocialProductionProgressPanelProps) {
  const previousStatusRef = useRef<SocialContentTaskStatus>(task.status);
  const counts = taskCounts(task);
  const active = ACTIVE_STATUSES.has(task.status) || Boolean(task.runId && counts.generated === 0);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = task.status;
    if (previousStatus === 'plan_review' && ['producing', 'attention', 'paused'].includes(task.status)) {
      openContentGenerationQueue({ view: 'tasks', taskId: task.taskId });
    }
  }, [task.status, task.taskId]);

  return (
    <div className="fixed bottom-24 right-4 z-40 sm:right-6" data-social-production-progress>
      <button
        type="button"
        onClick={() => openContentGenerationQueue({ view: 'tasks', taskId: task.taskId })}
        aria-haspopup="dialog"
        className="group flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:max-w-[19rem]"
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
          <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">打开内容生成队列</span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
      </button>
    </div>
  );
}
