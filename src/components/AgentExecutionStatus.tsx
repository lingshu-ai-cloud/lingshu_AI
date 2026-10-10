import { useMemo, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  DigitalEmployeeAgentRole,
  DigitalEmployeeOverview,
  RunEvent,
  WorkflowTask,
} from '../lib/digitalEmployees';
import { agentExecutionSummary } from '../lib/agentExecutionSummary';
import { taskNeedsAttention, type TaskWaitState } from '../lib/taskExecutionState';
import { useModalFocus } from '../hooks/useModalFocus';

type VisibleAgentRole = Exclude<DigitalEmployeeAgentRole, 'orchestrator'>;
type AgentState = 'idle' | 'queued' | 'running' | 'attention' | 'failed' | 'completed' | 'paused';

const statusLabel: Record<string, string> = {
  pending: '待执行', planning: '规划中', running: '运行中', waiting_external: '等待条件',
  waiting_approval: '待审批', waiting_human: '待人工', handed_off: '人工接管',
  succeeded: '已完成', completed: '已完成', failed: '异常', paused: '已暂停', cancelled: '已取消',
};

const stateLabel: Record<AgentState, string> = {
  idle: '本轮无任务', queued: '等待执行', running: '正在工作', attention: '等待确认',
  failed: '出现异常', completed: '本轮完成', paused: '已暂停',
};

const agentMeta: Array<{
  role: VisibleAgentRole;
  label: string;
  accent: string;
  border: string;
  background: string;
  text: string;
  icon: typeof BarChart3;
}> = [
  { role: 'business', label: '经营 Agent', accent: '#7c3aed', border: 'border-violet-200', background: 'bg-violet-50/55', text: 'text-violet-700', icon: BarChart3 },
  { role: 'director', label: '编导 Agent', accent: '#2563eb', border: 'border-blue-200', background: 'bg-blue-50/55', text: 'text-blue-700', icon: Search },
  { role: 'content', label: '内容 Agent', accent: '#0f9f82', border: 'border-emerald-200', background: 'bg-emerald-50/55', text: 'text-emerald-700', icon: Sparkles },
  { role: 'customer', label: '客服 Agent', accent: '#d97706', border: 'border-amber-200', background: 'bg-amber-50/55', text: 'text-amber-700', icon: MessageSquare },
];

function latest<T>(items: T[], dateOf: (item: T) => string): T | undefined {
  return [...items].sort((left, right) => new Date(dateOf(right)).getTime() - new Date(dateOf(left)).getTime())[0];
}

function taskMessage(task?: WorkflowTask): string {
  if (!task) return '本轮没有分配任务';
  const wait = task.output?.waitState as TaskWaitState | undefined;
  return wait?.message || task.blocked_reason || task.title;
}

function resolveAgentState(tasks: WorkflowTask[], runStatus?: string): AgentState {
  if (!tasks.length) return 'idle';
  if (runStatus === 'paused') return 'paused';
  if (tasks.some(task => task.status === 'failed')) return 'failed';
  if (tasks.some(task => taskNeedsAttention(task) || ['waiting_approval', 'waiting_human', 'handed_off'].includes(task.status))) return 'attention';
  if (tasks.some(task => task.status === 'running' || task.status === 'planning'
    || (task.status === 'waiting_external' && (task.output?.waitState as TaskWaitState | undefined)?.kind === 'processing'))) return 'running';
  if (tasks.every(task => ['succeeded', 'completed', 'cancelled'].includes(task.status))) return 'completed';
  return 'queued';
}

function currentTaskFor(tasks: WorkflowTask[], state: AgentState): WorkflowTask | undefined {
  const preferred = state === 'failed'
    ? tasks.find(task => task.status === 'failed')
    : state === 'attention'
      ? tasks.find(task => taskNeedsAttention(task) || ['waiting_approval', 'waiting_human', 'handed_off'].includes(task.status))
      : state === 'running'
        ? tasks.find(task => ['running', 'planning'].includes(task.status)
          || (task.status === 'waiting_external' && (task.output?.waitState as TaskWaitState | undefined)?.kind === 'processing'))
        : tasks.find(task => task.status === 'pending');
  return preferred || latest(tasks, task => task.updated_at);
}

function eventTime(value?: string): string {
  if (!value) return '尚无动态';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '尚无动态';
  return time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function AgentExecutionStatus({ data, onOpen, collapsed = false, detailId }: {
  data: DigitalEmployeeOverview;
  onOpen: (taskId?: string) => void;
  collapsed?: boolean;
  detailId?: string;
}) {
  const [selectedRole, setSelectedRole] = useState<VisibleAgentRole | null>(null);
  const summary = agentExecutionSummary(data);
  const runTasks = useMemo(
    () => data.tasks.filter(task => task.run_id === data.run?.id).sort((left, right) => left.sequence - right.sequence),
    [data.run?.id, data.tasks],
  );
  const runEvents = useMemo(
    () => data.events.filter(event => event.run_id === data.run?.id).sort((left, right) => left.sequence - right.sequence),
    [data.events, data.run?.id],
  );
  const cards = useMemo(() => agentMeta.map(meta => {
    const tasks = runTasks.filter(task => task.agent_role === meta.role);
    const state = resolveAgentState(tasks, data.run?.status);
    const currentTask = currentTaskFor(tasks, state);
    const taskIds = new Set(tasks.map(task => task.id));
    const events = runEvents.filter(event => taskIds.has(event.task_id));
    const recentEvent = events.at(-1);
    const completed = tasks.filter(task => ['succeeded', 'completed'].includes(task.status)).length;
    return { ...meta, tasks, state, currentTask, events, recentEvent, completed };
  }), [data.run?.status, runEvents, runTasks]);
  const selected = cards.find(card => card.role === selectedRole);
  const dialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(selected),
    onClose: () => setSelectedRole(null),
  });

  return <>
    <section aria-label="四 Agent 实时工作状态" className="mt-4 rounded-2xl border border-border bg-white p-3 shadow-[0_10px_30px_rgba(20,54,43,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold text-text-primary">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${summary.running ? 'bg-accent motion-safe:animate-pulse' : 'bg-text-muted'}`} />
            Agent 实时工作台
            <span className="font-normal text-text-muted">{summary.completed}/{summary.total} 项已完成</span>
          </p>
          {!collapsed && <p id={detailId} className="mt-1 truncate text-[11px] text-text-muted">{summary.detail}</p>}
        </div>
        <button type="button" onClick={() => onOpen(summary.taskId)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-accent hover:text-accent-dim">查看完整生产现场 <ArrowRight size={12} /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon;
          const isRunning = card.state === 'running';
          const isAttention = card.state === 'attention' || card.state === 'failed';
          const lastSignal = card.recentEvent?.occurred_at || card.currentTask?.updated_at;
          return <button
            key={card.role}
            type="button"
            onClick={() => setSelectedRole(card.role)}
            style={{ '--agent-accent': card.accent } as CSSProperties}
            className={`agent-live-card ${isRunning ? 'agent-live-card--running' : ''} group min-w-0 rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${card.border} ${card.background}`}
            aria-label={`查看${card.label}工作详情`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ${card.text}`}>
                {isRunning ? <Loader2 size={15} className="motion-safe:animate-spin" /> : isAttention ? <AlertTriangle size={15} /> : card.state === 'completed' ? <CheckCircle2 size={15} /> : <Icon size={15} />}
              </span>
              <span className={`rounded-full bg-white/80 px-2 py-1 text-[9px] font-black ${isAttention ? card.state === 'failed' ? 'text-red-600' : 'text-amber-700' : card.text}`}>{stateLabel[card.state]}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs font-black text-slate-900">{card.label}</p>
              <span className="text-[9px] font-bold text-slate-400">{card.completed}/{card.tasks.length}</span>
            </div>
            {!collapsed && <>
              <p className="mt-1 text-[9px] font-bold text-slate-400">当前动作</p>
              <p className="mt-0.5 truncate text-[10px] leading-4 text-slate-600">{card.recentEvent?.summary || taskMessage(card.currentTask)}</p>
              <p className="mt-2 flex items-center justify-between gap-2 text-[9px] text-slate-400"><span className="flex items-center gap-1"><Clock3 size={9} />{eventTime(lastSignal)}更新</span><span className={`font-bold ${card.text}`}>查看详情</span></p>
            </>}
          </button>;
        })}
      </div>
    </section>

    {selected && <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agent-live-dialog-title" className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedRole(null); }}>
      <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/30 bg-white shadow-2xl">
        <header style={{ '--agent-accent': selected.accent } as CSSProperties} className={`agent-live-dialog-header relative flex items-start justify-between gap-4 border-b px-5 py-5 ${selected.border} ${selected.background}`}>
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ${selected.text}`}><selected.icon size={18} /></span>
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-[.18em] ${selected.text}`}>Agent live details</p>
              <h2 id="agent-live-dialog-title" className="mt-1 text-lg font-black text-slate-950">{selected.label} · {stateLabel[selected.state]}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">{selected.recentEvent?.summary || taskMessage(selected.currentTask)}</p>
            </div>
          </div>
          <button data-modal-initial-focus type="button" aria-label="关闭 Agent 工作详情" onClick={() => setSelectedRole(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/80 text-slate-500 hover:bg-white"><X size={16} /></button>
        </header>
        <div className="grid max-h-[calc(88vh-104px)] gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900">本轮任务</h3>
              <span className="text-[10px] font-bold text-slate-400">已完成 {selected.completed}/{selected.tasks.length}</span>
            </div>
            <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {selected.tasks.length ? selected.tasks.map(task => <article key={task.id} className="bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs font-bold text-slate-900">{task.title}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{taskMessage(task)}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${task.status === 'failed' ? 'bg-red-50 text-red-600' : taskNeedsAttention(task) || ['waiting_approval', 'waiting_human'].includes(task.status) ? 'bg-amber-50 text-amber-700' : ['succeeded', 'completed'].includes(task.status) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{statusLabel[task.status] || task.status}</span>
                </div>
              </article>) : <p className="px-4 py-10 text-center text-xs text-slate-400">这个 Agent 本轮没有分配任务。</p>}
            </div>
            {selected.currentTask && <button type="button" onClick={() => { const taskId = selected.currentTask?.id; setSelectedRole(null); onOpen(taskId); }} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white">打开任务现场 <ArrowRight size={13} /></button>}
          </section>
          <aside>
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-900">最近动态</h3><span className="text-[10px] text-slate-400">{selected.events.length} 条</span></div>
            <div className="mt-3 space-y-2">
              {selected.events.length ? [...selected.events].reverse().slice(0, 12).map((event: RunEvent) => <div key={event.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className={`text-[10px] font-semibold leading-4 ${event.level === 'error' ? 'text-red-600' : 'text-slate-700'}`}>{event.summary}</p>
                <time className="mt-1 block text-[9px] text-slate-400">{new Date(event.occurred_at).toLocaleString('zh-CN')}</time>
              </div>) : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-[10px] text-slate-400">尚无实时事件</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>}
  </>;
}
