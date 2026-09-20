import { useEffect, useId, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
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

function automaticStep(task: TaskListItem): string {
  if (task.status === 'draft' || task.status === 'needs_input') return '等待必要资料确认';
  if (task.status === 'plan_review') return '爆款公式与参考脚本已确定，等待确认任务';
  if (task.status === 'producing') return '根据已上传素材适配既有脚本，并自动生成口播、字幕和画面';
  if (task.status === 'attention') return '机器人正在自动重试，已有脚本、素材和生成结果均已保留';
  if (task.status === 'paused') return '机器人已保留现有脚本、素材和生成结果';
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
  if (task.status === 'plan_review') return '确认任务后，机器人会自动完成制作';
  return '我们的机器人正在后台全力帮你生成内容';
}

function statusTone(status: SocialContentTaskStatus): string {
  if (status === 'asset_review') return 'bg-amber-50 text-amber-800';
  if (COMPLETE_STATUSES.has(status)) return 'bg-emerald-50 text-emerald-800';
  if (status === 'attention' || status === 'paused') return 'bg-rose-50 text-rose-700';
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
    if (task.status === 'attention' || task.status === 'paused') {
      return onStart ? { label: '重试自动生成', icon: <RotateCcw size={14} />, action: onStart } : null;
    }
    if (task.status === 'asset_review') {
      return onReview ? { label: '审核生成结果', icon: <CheckCircle2 size={14} />, action: onReview } : null;
    }
    return null;
  })();

  return (
    <div className="flex justify-stretch sm:justify-end" data-social-production-progress>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(16,185,129,0.10)] transition hover:border-emerald-300 hover:shadow-[0_12px_30px_rgba(16,185,129,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:w-auto sm:max-w-xl"
      >
        <span className={counts.pendingReview > 0 ? 'text-amber-700' : 'text-emerald-700'}>
          <StatusGraphic task={task} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black tracking-[0.08em] text-emerald-700">
            {active ? '后台生成中' : socialContentStatusLabel(task.status)}
          </span>
          <span role="status" aria-live="polite" className="mt-0.5 block text-xs font-black leading-5 text-slate-900 sm:text-sm">
            {compactHeadline(task)}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">点击查看全部制作任务</span>
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
                <p className="text-[10px] font-black tracking-[0.1em] text-emerald-700">内容机器人</p>
                <h2 id={drawerTitleId} className="mt-0.5 text-lg font-black text-slate-950">制作任务</h2>
                <p className="mt-1 text-xs text-slate-500">脚本、口播、字幕和剪辑由机器人自动完成</p>
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
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${statusTone(item.status)}`}>{itemActive ? '机器人制作中' : socialContentStatusLabel(item.status)}</span>
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
