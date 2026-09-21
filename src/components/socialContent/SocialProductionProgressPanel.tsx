import { useEffect, useId, useRef, useState } from 'react';
import {
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
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskStatus,
  SocialContentTaskSummary,
  SocialDirectorPlanSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import { socialContentMaterialPolicy } from '../../../shared/socialContentMaterialPolicy';
import {
  socialContentCurrentArtifacts,
  socialContentStatusLabel,
} from '../../lib/socialContentModel';

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
  onEdit?: () => void;
  onReview?: () => void;
}

type TaskListItem = SocialContentTaskSummary | SocialContentTaskDetail;

const ACTIVE_STATUSES = new Set<SocialContentTaskStatus>(['producing', 'attention', 'paused', 'packaging']);
const COMPLETE_STATUSES = new Set<SocialContentTaskStatus>(['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed']);
const CONTENT_COMPLETE_STATUSES = new Set<SocialContentTaskStatus>(['asset_review', 'packaging', ...COMPLETE_STATUSES]);

function isTaskDetail(task: TaskListItem): task is SocialContentTaskDetail {
  return 'artifacts' in task;
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
  return task.directorPlan?.status === 'ready' || CONTENT_COMPLETE_STATUSES.has(task.status);
}

function automaticStep(task: TaskListItem): string {
  if (task.status === 'draft' || task.status === 'needs_input') return '等待必要资料确认';
  if (task.status === 'plan_review') return '确认任务后，编导 Agent 会先完成导演方案';
  if (task.status === 'producing' && !directorPlanComplete(task)) return '编导 Agent 正在整理脚本、口播、字幕与镜头节奏';
  if (task.status === 'producing') return '内容 Agent 正按编导方案生成配音、字幕并剪辑视频';
  if (task.status === 'attention') return `现有素材未达到可发布标准；已保留任务，${socialContentMaterialPolicy(task.theme?.themeId ?? null).insufficientMessage}后继续`;
  if (task.status === 'paused') return '自动处理暂时中断，现有导演方案、素材和生成结果均已保留';
  if (task.status === 'asset_review') return '视频、口播和字幕已经生成，等待你审核';
  if (task.status === 'packaging') return '正在整理视频、封面、文案和发布包';
  if (task.status === 'delivered' || task.status === 'awaiting_publish') return '成品与发布包已经准备完成';
  if (task.status === 'awaiting_metrics') return '等待发布数据回收';
  return '本轮内容任务已经完成';
}

function compactHeadline(task: SocialContentTaskDetail): string {
  const counts = taskCounts(task);
  if (counts.pendingReview > 0 || task.status === 'asset_review') return '内容已经生成，等待你审核';
  if (COMPLETE_STATUSES.has(task.status)) return '本轮内容已经制作完成';
  if (task.status === 'draft' || task.status === 'needs_input') return '补充资料后，机器人会自动开始制作';
  if (task.status === 'plan_review') return '确认后，编导 Agent 会先完成导演方案';
  if (task.directorPlan?.status === 'blocked') return '编导方案正在自动检查与修复';
  if (!directorPlanComplete(task)) return '编导 Agent 正在准备导演方案';
  return '内容 Agent 正在按导演方案生成视频';
}

function activeAgentLabel(task: TaskListItem): string {
  if (task.status === 'draft' || task.status === 'needs_input' || task.status === 'plan_review') return '等待开始';
  if (task.directorPlan?.status === 'blocked') return '编导 Agent 自动修复中';
  if (!directorPlanComplete(task)) return '编导 Agent 策划中';
  if (!CONTENT_COMPLETE_STATUSES.has(task.status)) return '内容 Agent 制作中';
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
  if (source === 'formula') return '管理员配置的导演模板';
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
      <p className="text-[9px] font-black tracking-[0.08em] text-slate-500">自动制作接力</p>
      <div className="mt-2 grid gap-2">
        <div className={`rounded-xl border px-3 py-2.5 ${agentStepTone(directorState)}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-black"><Clapperboard size={14} />编导 Agent</span>
            <span className="text-[9px] font-black">{agentStepLabel(directorState)}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 opacity-80">整理脚本、口播、字幕与镜头节奏，形成完整导演方案</p>
        </div>
        <div className={`rounded-xl border px-3 py-2.5 ${agentStepTone(contentState)}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-black"><Bot size={14} />内容 Agent</span>
            <span className="text-[9px] font-black">{agentStepLabel(contentState)}</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 opacity-80">接收已匹配素材的导演方案，完成配音、配乐、字幕和剪辑</p>
        </div>
      </div>

      {plan?.status === 'ready' && (
        <details className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[11px] font-black text-slate-800">
            <span>查看导演方案摘要</span>
            <span className="shrink-0 text-[9px] font-bold text-slate-500">{plan.sceneCount} 个镜头 · {plan.language === 'zh' ? '中文' : '英文'}</span>
          </summary>
          <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3">
            <p className="text-[10px] leading-4 text-slate-500">方案依据：{directorSourceLabel(plan.scriptSource)}。导演方案会直接交给内容 Agent，不需要你逐项填写。</p>
            {summaryRows.map(row => <div key={row.label} className="rounded-lg bg-white px-3 py-2 shadow-sm"><p className="flex items-center gap-1.5 text-[9px] font-black text-emerald-700"><row.icon size={11} />{row.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-700">{row.value}</p></div>)}
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
  onEdit,
  onReview,
}: SocialProductionProgressPanelProps) {
  const [open, setOpen] = useState(false);
  const drawerTitleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const counts = taskCounts(task);
  const active = ACTIVE_STATUSES.has(task.status) || Boolean(task.runId && counts.generated === 0);
  const remainingTaskCount = Math.max(0, taskTotalItems - tasks.length);
  const taskItems: TaskListItem[] = [task, ...tasks.filter(item => item.taskId !== task.taskId)];

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
    if (taskId !== task.taskId) onSelectTask?.(taskId);
  };

  const currentAction = (() => {
    if (task.status === 'draft' || task.status === 'needs_input') {
      return onEdit ? { label: '补充任务资料', icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'plan_review') {
      return onStart ? { label: '确认并开始自动制作', icon: <Bot size={14} />, action: onStart } : null;
    }
    if (task.status === 'attention') {
      return onEdit ? { label: `补充${socialContentMaterialPolicy(task.theme?.themeId ?? null).subjectLabel}`, icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'paused') {
      return onStart ? { label: '继续自动处理', icon: <RotateCcw size={14} />, action: onStart } : null;
    }
    if (task.status === 'asset_review') {
      return onReview ? { label: '审核生成结果', icon: <CheckCircle2 size={14} />, action: onReview } : null;
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
        className="group flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-2xl border border-emerald-200 bg-white px-3 py-2.5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.16)] transition hover:border-emerald-300 hover:shadow-[0_14px_34px_rgba(16,185,129,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:max-w-[19rem]"
      >
        <span className={counts.pendingReview > 0 ? 'text-amber-700' : 'text-emerald-700'}>
          <StatusGraphic task={task} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black tracking-[0.08em] text-emerald-700">
            {active ? activeAgentLabel(task) : socialContentStatusLabel(task.status)}
          </span>
          <span role="status" aria-live="polite" className="mt-0.5 block truncate text-xs font-black leading-5 text-slate-900">
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
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-[#f7f9f7] shadow-[-20px_0_60px_rgba(15,23,42,0.18)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-black tracking-[0.1em] text-emerald-700">AI 制作团队</p>
                <h2 id={drawerTitleId} className="mt-0.5 text-lg font-black text-slate-950">制作任务</h2>
                <p className="mt-1 text-xs text-slate-500">编导 Agent 定方案，内容 Agent 生成视频</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={busy} onClick={onRefresh} aria-label="刷新制作任务" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCcw size={16} /></button>
                <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="关闭制作任务" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"><X size={18} /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
              <div className="space-y-3">
                {taskItems.map(item => {
                  const selected = item.taskId === task.taskId;
                  const itemCounts = taskCounts(item);
                  const itemActive = ACTIVE_STATUSES.has(item.status);
                  return (
                    <article key={item.taskId} className={`overflow-hidden rounded-2xl border bg-white transition ${selected ? 'border-emerald-300 shadow-[0_8px_24px_rgba(16,185,129,0.10)]' : 'border-slate-200'}`}>
                      <button
                        type="button"
                        onClick={() => selectTask(item.taskId)}
                        aria-current={selected ? 'true' : undefined}
                        className="w-full px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-slate-950">{item.brief.title}</span>
                            <span className="mt-1 block text-[10px] font-semibold text-slate-500">更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${statusTone(item.status)}`}>{itemActive ? activeAgentLabel(item) : socialContentStatusLabel(item.status)}</span>
                        </span>

                        <span className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-3">
                          <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm">
                            {itemActive && <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-emerald-600 motion-reduce:animate-none" aria-hidden />}
                            <Bot size={14} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[9px] font-black tracking-[0.06em] text-slate-500">当前自动步骤</span>
                            <span className="mt-0.5 block text-xs font-bold leading-5 text-slate-800">{automaticStep(item)}</span>
                          </span>
                        </span>

                        <span className="mt-3 grid grid-cols-2 gap-2">
                          <span className="rounded-xl border border-slate-100 px-3 py-2.5">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><FileCheck2 size={11} />已完成产物</span>
                            <strong className="mt-1 block text-xs text-slate-900">{itemCounts.generated > 0 ? `${itemCounts.generated} 项` : '生成中'}</strong>
                          </span>
                          <span className="rounded-xl border border-slate-100 px-3 py-2.5">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><Clock3 size={11} />待用户审核</span>
                            <strong className={`mt-1 block text-xs ${itemCounts.pendingReview > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{itemCounts.pendingReview > 0 ? `${itemCounts.pendingReview} 项` : '暂无'}</strong>
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
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
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
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
