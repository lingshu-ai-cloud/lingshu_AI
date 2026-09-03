import { Activity, Bot, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import type { WeeklyGoal, WeeklyReview, WorkflowRun, WorkflowTask } from '../../lib/digitalEmployees';
import { selectBusinessOutcome, selectWorkflowProgress } from './selectors';
import { statusLabel } from './presentation';
import { StatusBadge } from './StatusBadge';

export function OverviewCards({ goal, run, tasks, review }: { goal: WeeklyGoal; run: WorkflowRun | null; tasks: WorkflowTask[]; review: WeeklyReview | null }) {
  const workflow = selectWorkflowProgress(tasks);
  const outcome = selectBusinessOutcome(review, goal);
  return <section aria-label="本周运行概览" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">本周目标</span><Target size={17} className="text-blue-600" /></div><p className="mt-3 line-clamp-2 text-sm font-bold text-slate-900">{goal.title}</p><div className="mt-3"><StatusBadge status={goal.status} /></div></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">工作流完成率</span><Activity size={17} className="text-emerald-600" /></div><p className="mt-2 text-2xl font-black text-slate-950">{workflow.rate}%</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${workflow.rate}%` }} /></div><p className="mt-2 text-[11px] text-slate-400">{workflow.completed} / {workflow.total || '待生成'} 个任务；不代表经营目标达成</p></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">经营目标达成</span><TrendingUp size={17} className="text-cyan-600" /></div>{outcome.progressRate === null ? <><p className="mt-3 text-sm font-black text-slate-900">{outcome.label}</p><p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-amber-700">{outcome.missingReason}</p></> : <><p className="mt-2 text-2xl font-black text-slate-950">{outcome.progressRate}%</p><p className="mt-2 text-[11px] text-slate-400">观测值 {outcome.current} / 目标 {outcome.target} {outcome.unit}</p></>}</div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">运行状态</span><Bot size={17} className="text-violet-600" /></div><p className="mt-3 text-sm font-bold text-slate-900">{run ? statusLabel[run.status] || run.status : '等待批准目标'}</p><p className="mt-2 text-[11px] text-slate-400">控制者：{run?.current_controller === 'agent' ? '数字员工' : run?.current_controller || '尚未启动'}</p></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">预算边界</span><ShieldCheck size={17} className="text-amber-600" /></div><p className="mt-2 text-2xl font-black text-slate-950">¥{goal.budgetLimit}</p><p className="mt-2 text-[11px] text-slate-400">实际 ¥{Number(run?.actual_cost ?? run?.budget_spent ?? 0).toFixed(2)}；超限必须重新审批</p></div>
  </section>;
}
