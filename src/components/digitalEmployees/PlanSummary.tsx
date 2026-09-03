import { BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, Circle, Hand, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WeeklyPlan, WorkflowTask } from '../../lib/digitalEmployees';
import { agentLabel, outputSummary } from './presentation';
import { selectPriorityTasks } from './selectors';
import { StatusBadge } from './StatusBadge';

function TaskIcon({ status }: { status: string }) {
  if (status === 'succeeded') return <CheckCircle2 size={18} className="text-emerald-600" />;
  if (status === 'running') return <Loader2 size={18} className="animate-spin text-blue-600" />;
  if (status === 'waiting_approval') return <ShieldCheck size={18} className="text-amber-600" />;
  if (status === 'handed_off' || status === 'waiting_human') return <Hand size={18} className="text-violet-600" />;
  if (status === 'failed') return <XCircle size={18} className="text-red-600" />;
  return <Circle size={18} className="text-slate-300" />;
}

function TaskRow({ task, onSelect }: { task: WorkflowTask; onSelect: (task: WorkflowTask) => void }) {
  const attentionTone = task.status === 'waiting_approval'
    ? 'border-amber-200 bg-amber-50/50'
    : task.status === 'handed_off' || task.status === 'waiting_human'
      ? 'border-violet-200 bg-violet-50/50'
      : task.status === 'failed'
        ? 'border-red-200 bg-red-50/50'
        : task.status === 'running'
          ? 'border-blue-200 bg-blue-50/40'
          : 'border-slate-200 bg-white';
  const summary = outputSummary(task);
  return <button type="button" onClick={() => onSelect(task)} className={`w-full rounded-2xl border p-4 text-left transition hover:border-slate-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 ${attentionTone}`}>
    <div className="flex items-start gap-3"><TaskIcon status={task.status} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-slate-900">{task.sequence}. {task.title}</p><StatusBadge status={task.status} /><span className="text-[10px] font-semibold text-slate-400">{agentLabel[task.agent_role] || task.agent_role}</span></div><p className="mt-1 text-xs leading-relaxed text-slate-500">{task.description}</p>{summary && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">结果摘要：{summary}</p>}</div></div>
  </button>;
}

export function PlanSummary({ plan, tasks, onSelectTask }: { plan: WeeklyPlan; tasks: WorkflowTask[]; onSelectTask: (task: WorkflowTask) => void }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const ordered = useMemo(() => selectPriorityTasks(tasks), [tasks]);
  const active = ordered.filter(task => task.status !== 'succeeded');
  const completed = ordered.filter(task => task.status === 'succeeded');
  return <section id="digital-stage-3" className="scroll-mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BrainCircuit size={19} className="text-violet-600" /><h2 className="font-bold text-slate-950">Agent 自动计划</h2></div><p className="mt-2 text-sm leading-relaxed text-slate-600">{plan.strategy}</p></div><div className="text-right text-xs text-slate-400"><p>预计 {plan.estimatedMinutes} 分钟</p><p className="mt-1">预计成本 ¥{plan.estimatedCost}</p>{plan.version && <p className="mt-1">计划版本 v{plan.version}</p>}</div></div>
    <div className="mt-5 space-y-2">
      {active.length === 0 && completed.length > 0 && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">所有工作流任务已完成；经营结果仍以真实指标观测为准。</p>}
      {active.map(task => <TaskRow key={task.id} task={task} onSelect={onSelectTask} />)}
      {completed.length > 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50/60">
        <button type="button" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-bold text-slate-600">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" />已完成任务 {completed.length} 项</span>{showCompleted ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {showCompleted && <div className="space-y-2 border-t border-slate-200 p-2">{completed.map(task => <TaskRow key={task.id} task={task} onSelect={onSelectTask} />)}</div>}
      </div>}
    </div>
  </section>;
}
