import { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  ListTodo,
  Loader2,
  RefreshCcw,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskStatus,
  SocialContentTaskSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import { socialContentStatusLabel } from '../../lib/socialContentModel';

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
  onReview?: () => void;
}

type TaskListItem = SocialContentTaskSummary | SocialContentTaskDetail;

const COMPLETE_STATUSES = new Set<SocialContentTaskStatus>(['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed']);

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
  if (stage === 'needs_facts') return '还需要补充产品或企业资料';
  if (stage === 'needs_rights') return '还需要确认素材使用范围';
  if (stage === 'needs_budget') return '当前方案超出预算';
  if (stage === 'goal_degraded') return '当前素材无法达到预期效果';
  if (stage === 'failed_recoverable') return '本次制作未完成，可以直接重新尝试';
  return null;
}

function canProduceWithoutCustomerShoot(task: TaskListItem): boolean {
  const feasibility = task.assetSupplyPlan?.overallFeasibility;
  return feasibility === 'full_fidelity' || feasibility === 'functional_equivalent';
}

function taskContext(task: TaskListItem): string {
  return task.brief.productRef?.trim()
    || task.brief.objective?.trim()
    || '内容任务';
}

function statusTone(status: SocialContentTaskStatus): string {
  if (status === 'asset_review') return 'bg-amber-50 text-amber-800';
  if (COMPLETE_STATUSES.has(status)) return 'bg-emerald-50 text-emerald-800';
  if (status === 'attention' || status === 'paused') return 'bg-amber-50 text-amber-800';
  return 'bg-blue-50 text-blue-700';
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
  onReview,
}: SocialProductionProgressPanelProps) {
  const [open, setOpen] = useState(false);
  const drawerTitleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
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
    setOpen(false);
  };

  const currentAction = (() => {
    if (task.status === 'paused' && task.agentWorkflow?.stage === 'failed_recoverable') {
      return onStart ? { label: '重新尝试', icon: <RotateCcw size={14} />, action: onStart } : null;
    }
    if (workflowInterruption(task)) {
      return onEdit ? { label: '查看并补充', icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'draft' || task.status === 'needs_input') {
      return onEdit ? { label: canProduceWithoutCustomerShoot(task) ? '确认任务信息' : '补充任务资料', icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'plan_review') {
      return onPlanReview ? { label: '查看方案与费用', icon: <ChevronRight size={14} />, action: onPlanReview } : null;
    }
    if (task.status === 'attention') {
      return onEdit ? { label: '查看需确认事项', icon: <ChevronRight size={14} />, action: onEdit } : null;
    }
    if (task.status === 'paused') {
      return onStart ? { label: '继续处理', icon: <RotateCcw size={14} />, action: onStart } : null;
    }
    if (task.status === 'asset_review') {
      if (contentReleaseBlocked(task)) {
        return onEdit ? { label: '继续修改', icon: <ChevronRight size={14} />, action: onEdit } : null;
      }
      return onReview ? { label: '审核成片', icon: <CheckCircle2 size={14} />, action: onReview } : null;
    }
    return null;
  })();

  return (
    <div className="fixed bottom-24 right-4 z-40 sm:right-6" data-social-task-list>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.14)] transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700" aria-hidden><ListTodo size={18} /></span>
        <span>
          <span className="block text-xs font-black text-slate-900">全部任务</span>
          <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">共 {taskTotalItems} 个</span>
        </span>
        <ChevronRight size={16} className="text-slate-400 transition group-hover:translate-x-0.5" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80]" role="presentation">
          <button type="button" aria-label="关闭任务列表" className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-[#f7f9f7] shadow-[-20px_0_60px_rgba(15,23,42,0.18)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-black tracking-[0.1em] text-emerald-700">内容制作</p>
                <h2 id={drawerTitleId} className="mt-0.5 text-lg font-black text-slate-950">任务列表</h2>
                <p className="mt-1 text-xs text-slate-500">选择任务，查看或继续处理</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={busy} onClick={onRefresh} aria-label="刷新任务列表" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCcw size={16} /></button>
                <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="关闭任务列表" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"><X size={18} /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="space-y-3">
                {taskItems.map(item => {
                  const selected = item.taskId === task.taskId;
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
                            <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-600">{taskContext(item)}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${statusTone(item.status)}`}>{socialContentStatusLabel(item.status)}</span>
                        </span>
                        <span className="mt-2 block text-[10px] font-semibold text-slate-400">{selected ? '当前查看 · ' : ''}更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </button>

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
