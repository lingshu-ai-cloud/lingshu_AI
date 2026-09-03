import { AlertTriangle, CheckCircle2, FileCheck2, Target, TrendingUp } from 'lucide-react';
import type { WeeklyGoal, WeeklyReview, WorkflowRun } from '../../lib/digitalEmployees';
import { selectBusinessOutcome } from './selectors';

function percent(value: number | undefined): string { return value === undefined ? '待回写' : `${Math.round(value)}%`; }

export function WeeklyReviewSummary({
  review,
  goal,
  run,
  onCreateNextGoal,
}: {
  review: WeeklyReview | null;
  goal: WeeklyGoal;
  run: WorkflowRun;
  onCreateNextGoal: (suggestion?: string) => void;
}) {
  const outcome = selectBusinessOutcome(review, goal);
  const summary = review?.summary;
  const workflow = summary?.workflow;
  const workflowRate = workflow?.completionRate ?? summary?.workflowCompletionRate ?? summary?.completionRate;
  const totalTasks = workflow?.totalTasks ?? summary?.totalTasks ?? 0;
  const completedTasks = workflow?.completedTasks ?? summary?.completedTasks ?? 0;
  const approvalCount = workflow?.approvalCount ?? 0;
  const handoffCount = workflow?.handoffCount ?? 0;
  const automationRate = summary?.automationRate ?? (totalTasks ? Math.max(0, Math.round(((completedTasks - approvalCount) / totalTasks) * 100)) : undefined);
  const approvalRate = summary?.approvalRate ?? (totalTasks ? Math.round((approvalCount / totalTasks) * 100) : undefined);
  const handoffRate = summary?.handoffRate ?? (totalTasks ? Math.round((handoffCount / totalTasks) * 100) : undefined);
  const highlights = summary?.highlights || [];
  const insights = summary?.insights || [];
  const nextSuggestions = summary?.nextWeekRecommendations?.length ? summary.nextWeekRecommendations : summary?.nextGoalSuggestion ? [summary.nextGoalSuggestion] : [];
  return <section id="digital-stage-6" className="scroll-mt-5 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 shadow-sm">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2 text-emerald-800"><FileCheck2 size={21} /><h2 className="text-lg font-black">周复盘</h2></div><p className="mt-2 text-sm text-slate-600">工作流完成和经营目标达成分别核算；没有真实发布回执或指标时明确显示缺失。</p></div><button type="button" disabled={!nextSuggestions.length} onClick={() => onCreateNextGoal(nextSuggestions[0])} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Target size={14} />采用建议生成下周目标（需确认）</button></div>

    {!review && <div role="alert" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><p className="flex items-center gap-2 font-bold"><AlertTriangle size={15} />复盘记录缺失</p><p className="mt-1 leading-relaxed">运行状态为 {run.status}，但服务端尚未生成可解释复盘。当前不展示推测值，请检查复盘 Worker 与数据源。</p></div>}

    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs text-slate-500">工作流完成率</p><p className="mt-1 text-2xl font-black text-slate-950">{percent(workflowRate)}</p><p className="mt-1 text-[10px] text-slate-400">任务执行口径</p></div>
      <div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs text-slate-500">经营目标达成率</p><p className="mt-1 text-2xl font-black text-slate-950">{outcome.progressRate === null ? '不可计算' : `${outcome.progressRate}%`}</p><p className="mt-1 text-[10px] text-slate-400">{outcome.label} · {outcome.source || '数据源缺失'}</p></div>
      <div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs text-slate-500">自动完成率</p><p className="mt-1 text-2xl font-black text-slate-950">{percent(automationRate)}</p><p className="mt-1 text-[10px] text-slate-400">审批 {percent(approvalRate)} · 接管 {percent(handoffRate)}</p></div>
      <div className="rounded-2xl border border-white bg-white/80 p-4"><p className="text-xs text-slate-500">实际成本</p><p className="mt-1 text-2xl font-black text-slate-950">{summary?.costs?.missing || (summary?.costs?.actual === undefined && workflow?.actualCost === undefined) ? '待回写' : `${summary?.costs?.currency || '¥'}${Number(summary?.costs?.actual ?? workflow?.actualCost).toFixed(2)}`}</p><p className="mt-1 text-[10px] text-slate-400">预算 ¥{summary?.costs?.budget ?? goal.budgetLimit} · {summary?.costs?.source || '任务实际费用账本'}</p></div>
    </div>

    {outcome.progressRate === null && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-amber-900"><TrendingUp size={15} />经营指标缺失态</div><p className="mt-2 text-xs leading-relaxed text-amber-800">{outcome.missingReason}</p><dl className="mt-2 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-3"><div><dt className="text-slate-400">指标口径</dt><dd>{outcome.metric}{outcome.definition ? ` · ${outcome.definition}` : ''}</dd></div><div><dt className="text-slate-400">基线 / 目标</dt><dd>{outcome.baseline ?? '—'} → {outcome.target ?? '—'} {outcome.unit}</dd></div><div><dt className="text-slate-400">观察窗口</dt><dd>{outcome.windowLabel}</dd></div></dl></div>}

    {(summary?.operatingResults?.length || 0) > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{summary!.operatingResults!.map((item, index) => <div key={`${item.label}:${index}`} className="rounded-2xl bg-white/80 p-4"><p className="text-[11px] text-slate-500">{item.label}</p><p className="mt-1 text-base font-black text-slate-900">{item.missing ? '数据缺失' : `${item.value ?? '—'}${item.unit || ''}`}</p><p className="mt-1 text-[10px] text-slate-400">{item.source || '未标明来源'}</p></div>)}</div>}

    {summary?.publishing && <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-2xl bg-white/80 p-4"><p className="text-[11px] text-slate-500">安全登记排期</p><p className="mt-1 text-lg font-black text-slate-900">{summary.publishing.scheduled}</p></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-[11px] text-slate-500">真实发布回执</p><p className="mt-1 text-lg font-black text-slate-900">{summary.publishing.published}</p></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-[11px] text-slate-500">Dry-run 未发布</p><p className="mt-1 text-lg font-black text-slate-900">{summary.publishing.dryRuns}</p></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-[11px] text-slate-500">外部动作失败</p><p className="mt-1 text-lg font-black text-slate-900">{summary.publishing.failed}</p></div></div>}

    <div className="mt-4 grid gap-4 md:grid-cols-3"><div className="rounded-2xl bg-white/80 p-4"><p className="text-xs font-bold text-slate-700">本周洞察与成果</p><ul className="mt-2 space-y-1.5 text-xs text-slate-600">{[...highlights, ...insights].length === 0 && <li className="text-slate-400">暂无可验证洞察</li>}{[...highlights, ...insights].map((item, index) => <li key={`${item}:${index}`} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />{item}</li>)}</ul></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-xs font-bold text-slate-700">问题热点</p><ul className="mt-2 space-y-1.5 text-xs text-slate-600">{!summary?.issueHotspots?.length && <li className="text-slate-400">暂无已归因问题</li>}{summary?.issueHotspots?.map(item => <li key={item}>• {item}</li>)}</ul></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-xs font-bold text-slate-700">下周建议</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">{nextSuggestions.length === 0 && <li className="text-slate-400">暂无建议；不能自动生成下一周目标</li>}{nextSuggestions.map(item => <li key={item}>• {item}</li>)}</ul></div></div>

    {(summary?.trend?.length || 0) > 0 && <div className="mt-4 overflow-x-auto rounded-2xl bg-white/80 p-4"><p className="text-xs font-bold text-slate-700">多周趋势</p><table className="mt-3 w-full min-w-[560px] text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">周</th><th className="pb-2">工作流完成</th><th className="pb-2">经营进展</th><th className="pb-2">实际成本</th></tr></thead><tbody>{summary!.trend!.map(item => <tr key={item.week} className="border-t border-slate-100"><td className="py-2 font-semibold">{item.week}</td><td>{percent(item.workflowCompletionRate)}</td><td>{percent(item.businessProgressRate)}</td><td>{item.actualCost === undefined ? '待回写' : `¥${item.actualCost.toFixed(2)}`}</td></tr>)}</tbody></table></div>}

    {(summary?.planComparison?.length || 0) > 0 && <div className="mt-4 rounded-2xl bg-white/80 p-4"><p className="text-xs font-bold text-slate-700">计划版本比较</p><div className="mt-2 space-y-2">{summary!.planComparison!.map(item => <div key={item.version} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2 text-xs"><span className="font-bold">v{item.version} {item.label || ''}</span><span className="text-slate-500">{item.result || (item.adopted ? '已采用' : '未采用')}</span></div>)}</div></div>}
  </section>;
}
