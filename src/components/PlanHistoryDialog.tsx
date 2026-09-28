import { useEffect, useMemo, useState } from "react";
import { CalendarRange, History, Loader2, X } from "lucide-react";
import { digitalEmployeeApi, type DigitalEmployeeOverview, type WeeklyGoal } from "../lib/digitalEmployees";

type Period = "week" | "month";

function completion(item: DigitalEmployeeOverview) {
  const total = item.tasks.length;
  const completed = item.tasks.filter(task => ["succeeded", "completed", "skipped"].includes(task.status)).length;
  return { total, completed, rate: total ? Math.round(completed / total * 100) : item.goal?.status === "completed" ? 100 : 0 };
}

function planCost(item: DigitalEmployeeOverview) {
  const plans = item.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || item.goal?.videoPlans || [];
  const itemCost = plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0);
  return itemCost || Number(item.plan?.estimatedCost || 0);
}

function monthLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 7) : date.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
}

export default function PlanHistoryDialog({ goals, onClose }: { goals: WeeklyGoal[]; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>("week");
  const [items, setItems] = useState<DigitalEmployeeOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled(goals.slice(0, 36).map(goal => digitalEmployeeApi.overview(goal.id)))
      .then(results => {
        if (!active) return;
        const loaded = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
        setItems(loaded.sort((left, right) => String(right.goal?.startsAt || "").localeCompare(String(left.goal?.startsAt || ""))));
        if (results.some(result => result.status === "rejected")) setError("少量历史计划暂时无法读取，已展示其余计划。");
      })
      .catch(loadError => active && setError(loadError instanceof Error ? loadError.message : "历史计划读取失败"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [goals]);

  const months = useMemo(() => {
    const groups = new Map<string, DigitalEmployeeOverview[]>();
    for (const item of items) {
      const key = item.goal?.startsAt.slice(0, 7) || "未归档";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()];
  }, [items]);

  return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section role="dialog" aria-modal="true" aria-label="历史计划" className="ui-modal-frame ui-modal-frame--wide overflow-hidden bg-white">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><History size={21}/></span><div><h2 className="text-xl font-black text-slate-950">历史计划</h2><p className="mt-1 text-xs text-slate-500">按周或按月查看已生成计划与实际任务完成度。</p></div></div>
        <button type="button" aria-label="关闭历史计划" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={18}/></button>
      </header>
      <div className="ui-modal-body px-5 py-5 sm:px-7">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">{(["week", "month"] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-4 py-2 text-xs font-black ${period === value ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500"}`}>{value === "week" ? "按周查看" : "按月查看"}</button>)}</div>
        {error&&<p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{error}</p>}
        {loading ? <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400"><Loader2 size={17} className="animate-spin"/>正在读取历史计划</div> : period === "week" ? <div className="mt-5 space-y-3">{items.map(item => {
          const progress = completion(item); const cost = planCost(item); const goal = item.goal!;
          return <article key={goal.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-slate-950">{goal.title}</p><p className="mt-1 text-xs text-slate-500">{goal.startsAt} 至 {goal.endsAt} · {item.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans?.length || goal.videoPlans?.length || 0} 条内容</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600">{goal.status}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_120px] sm:items-center"><div><div className="flex justify-between text-[10px] font-bold text-slate-500"><span>完成度</span><span>{progress.rate}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width:`${progress.rate}%`}}/></div></div><p className="text-xs font-black text-slate-800">{progress.completed}/{progress.total || "—"} 项</p><p className="text-xs font-black text-slate-800">{cost > 0 ? `计划成本 ¥${cost.toFixed(2)}` : "成本待核算"}</p></div></article>;
        })}{!items.length&&<div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">还没有历史周计划</div>}</div> : <div className="mt-5 grid gap-4 md:grid-cols-2">{months.map(([month, plans]) => {
          const stats = plans.map(completion); const total = stats.reduce((sum, item) => sum + item.total, 0); const completed = stats.reduce((sum, item) => sum + item.completed, 0); const rate = total ? Math.round(completed / total * 100) : 0; const cost = plans.reduce((sum, item) => sum + planCost(item), 0);
          return <article key={month} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><CalendarRange size={17} className="text-emerald-700"/><h3 className="text-sm font-black text-slate-950">{monthLabel(`${month}-01`)}</h3></div><span className="text-[10px] font-bold text-slate-500">{plans.length} 期计划</span></div><p className="mt-5 text-3xl font-black text-slate-950">{rate}%</p><p className="mt-1 text-xs text-slate-500">完成 {completed}/{total || "—"} 项任务</p><p className="mt-4 border-t border-slate-200 pt-3 text-xs font-bold text-slate-700">{cost > 0 ? `计划成本合计 ¥${cost.toFixed(2)}` : "成本待真实核算"}</p></article>;
        })}{!months.length&&<div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400 md:col-span-2">还没有月度计划记录</div>}</div>}
      </div>
    </section>
  </div>;
}
