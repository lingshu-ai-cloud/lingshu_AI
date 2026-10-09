import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, X } from 'lucide-react';

export type AgentCalendarTask = {
  id: string;
  date: string;
  time: string;
  agent: 'business' | 'director' | 'content' | 'customer' | 'human';
  title: string;
  output: string;
  context: string;
  minutes: number;
  status: 'planned' | 'active' | 'completed' | 'blocked' | 'cancelled' | 'failed';
  reason?: string;
  chain?: string;
  dependsOn?: string[];
  assignee?: string;
  dueAt?: string;
  submission?: "missing" | "pending" | "accepted" | "rejected";
  humanAction?: 'upload' | 'approval';
  availableForHuman?: boolean;
  productionTaskId?: string;
};
const agents = {
  human: { label: "人工任务", tone: "bg-rose-50 text-rose-800", stripe: "border-t-rose-500" },
  business: { label: '经营 Agent', tone: 'bg-emerald-50 text-emerald-800', stripe: 'border-t-emerald-500' },
  director: { label: '编导 Agent', tone: 'bg-violet-50 text-violet-800', stripe: 'border-t-violet-500' },
  content: { label: '内容 Agent', tone: 'bg-sky-50 text-sky-800', stripe: 'border-t-sky-500' },
  customer: { label: '客服 Agent', tone: 'bg-orange-50 text-orange-800', stripe: 'border-t-orange-400' },
};
const statuses = { planned: '待执行', active: '进行中', completed: '已完成', blocked: '需处理', cancelled: '已取消', failed: '执行失败' };
export function isHumanTaskOverdue(task: AgentCalendarTask, now = Date.now()): boolean {
  return task.agent === 'human' && task.availableForHuman !== false && !['completed','cancelled'].includes(task.status)
    && Boolean(task.dueAt && now > Date.parse(task.dueAt) && ['missing','rejected'].includes(task.submission || ''));
}
function key(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function shift(date: Date, count: number) { const result = new Date(date); result.setDate(result.getDate() + count); return result; }

export default function AgentWeeklyCalendar({ startsAt, tasks, demo = false, onOpenProduction }: { startsAt?: string; tasks: AgentCalendarTask[]; demo?: boolean; onOpenProduction?: (task: AgentCalendarTask) => void }) {
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks.find(task => task.id === selectedId) ?? null;
  const parsed = startsAt ? new Date(`${startsAt.slice(0, 10)}T00:00:00`) : new Date();
  const anchor = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const monday = shift(anchor, -((anchor.getDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => shift(monday, i));
  const weekTasks = tasks.filter(task => task.date >= key(days[0]) && task.date <= key(days[6]));
  return <div id="agent-weekly-calendar" className="scroll-mt-4 p-5 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div><h3 className="text-lg font-black text-slate-950">{demo ? "B2B 零基础 · 首周任务日历" : "Agent 周任务日历"}</h3><p className="mt-1 text-xs text-slate-500">{demo ? "外部参考 100% · 3 条母版 / 6 个平台版本 · 主链路与按需触发的副链路" : "按每日交付展示已生成的任务、主负责 Agent 和上游依赖"}</p></div>
      <div className="flex items-center gap-2"><button type="button" aria-label="上一周" onClick={() => setOffset(offset - 1)} className="rounded-lg border border-slate-200 p-2"><ArrowLeft size={14}/></button><span className="text-xs font-bold text-slate-700">{days[0].toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} — {days[6].toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span><button type="button" aria-label="下一周" onClick={() => setOffset(offset + 1)} className="rounded-lg border border-slate-200 p-2"><ArrowRight size={14}/></button><button type="button" onClick={() => setOffset(0)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">本周</button></div>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-3 text-[10px] font-bold">{Object.values(agents).map(agent => <span key={agent.label} className={`rounded-full px-2.5 py-1 ${agent.tone}`}>{agent.label}</span>)}<span className="ml-auto text-slate-400">{weekTasks.length} 项交付{demo ? ' · 示例排期' : ''}</span></div>
    {!demo && tasks.length === 0 && <p className="mb-4 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">尚无可展示的 Agent 执行排期。发布计划不会自动视为制作任务；生成执行排期后将在此显示。</p>}
    {demo && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">效果验收示例：任务、工时与执行状态为演示数据；异常副链路展示触发示例，不代表所有任务都必然发生。点击卡片查看任务详情。</p>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200"><div className="grid min-w-[1260px] grid-cols-7">
      {days.map((day, index) => {
        const items = weekTasks.filter(task => task.date === key(day)).sort((a, b) => a.time.localeCompare(b.time));
        const today = key(day) === key(new Date());
        return <section key={key(day)} aria-label={`${['周一','周二','周三','周四','周五','周六','周日'][index]}任务`} className="min-w-0 border-r border-slate-200 last:border-r-0">
          <header className={`border-b border-slate-200 p-4 ${today ? 'bg-emerald-50' : 'bg-slate-50'}`}><div className="flex justify-between text-xs font-black text-slate-700"><span>{['周一','周二','周三','周四','周五','周六','周日'][index]}</span>{today && <span className="text-emerald-700">今天</span>}</div><p className="mt-1 text-xl font-black text-slate-950">{day.getMonth() + 1}/{day.getDate()}</p><p className="mt-2 text-[10px] text-slate-500">{items.length} 项交付 · 预计 {Math.round(items.reduce((sum, item) => sum + item.minutes, 0) / 60 * 10) / 10} 小时</p></header>
          <div className="min-h-[420px] space-y-3 bg-slate-50/40 p-2.5">{items.map(task => {
            const agent = agents[task.agent];
            const overdue = isHumanTaskOverdue(task);
            return <button type="button" key={task.id} onClick={() => setSelectedId(task.id)} className={`w-full rounded-xl border border-slate-200 border-t-[3px] bg-white p-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md focus-visible:outline-emerald-600 ${overdue ? "border-red-400 border-t-red-500 bg-red-50" : agent.stripe}`}>
              <div className="flex items-center justify-between gap-1 text-[9px]"><span className="font-bold text-slate-500">{task.time} 前完成</span><span className={task.status === 'blocked' ? 'text-amber-700' : task.status === 'active' ? 'text-sky-700' : 'text-slate-500'}>{overdue ? (task.humanAction === "approval" ? "验收已逾期" : "上传已逾期") : task.submission === "pending" ? "已提交待核验" : statuses[task.status]}</span></div>
              <p className="mt-2 text-[9px] font-bold text-slate-400">{task.chain} · {task.chain?.includes("-S") ? "副链路" : "主链路"}</p><h4 className="mt-2 text-xs font-black leading-5 text-slate-950">{task.title}</h4><span className={`mt-2 inline-block rounded-full px-2 py-1 text-[9px] font-bold ${agent.tone}`}>主负责 · {task.assignee || agent.label}</span>
              <p className="mt-2 text-[10px] leading-4 text-slate-500">{task.context}</p><p className="mt-3 border-t border-slate-100 pt-2 text-[10px] leading-4 text-slate-700"><span className="font-bold">交付：</span>{task.output}</p>
              <p className="mt-2 flex items-center gap-1 text-[9px] text-slate-400">{task.status === 'completed' ? <CheckCircle2 size={11}/> : <Clock3 size={11}/>}预计 {task.minutes} 分钟</p>{task.dependsOn?.length ? <p className="mt-2 text-[9px] text-slate-500">等待 {task.dependsOn.length} 项上游交付</p> : null}{task.reason && <p className={`mt-2 rounded-lg p-2 text-[9px] leading-4 ${overdue ? "bg-red-100 text-red-800" : "bg-amber-50 text-amber-800"}`}>{task.reason}</p>}
            </button>;
          })}{!items.length && <p className="py-12 text-center text-xs text-slate-400">暂无已排期任务</p>}</div>
        </section>;
      })}
    </div></div>
    {selected && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 p-4" onClick={() => setSelectedId(null)}><section role="dialog" aria-modal="true" aria-label="任务详情" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-xs font-bold ${agents[selected.agent].tone}`}>主负责 · {agents[selected.agent].label}</span><button type="button" autoFocus onClick={() => setSelectedId(null)} aria-label="关闭任务详情" className="rounded-full bg-slate-100 p-2"><X size={16}/></button></div><h3 className="mt-4 text-xl font-black text-slate-950">{selected.title}</h3><p className="mt-2 text-sm text-slate-500">{selected.context}</p><p className="mt-3 text-xs text-slate-500">{selected.chain} · {selected.assignee ? `人工负责人：${selected.assignee}` : "Agent 执行任务"}</p><dl className="mt-5 space-y-3 text-sm"><div><dt className="text-slate-400">计划完成</dt><dd>{selected.date} {selected.time}</dd></div><div><dt className="text-slate-400">当天交付</dt><dd>{selected.output}</dd></div><div><dt className="text-slate-400">执行状态</dt><dd>{statuses[selected.status]} · 预计 {selected.minutes} 分钟</dd></div></dl>{selected.dependsOn?.length ? <div className="mt-4"><p className="text-xs font-bold text-slate-500">上游交付</p>{selected.dependsOn.map(id => <p key={id} className="mt-1 text-xs text-slate-700">{tasks.find(task => task.id === id)?.title || id}</p>)}</div> : null}{selected.reason && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{selected.reason}</p>}{!demo && selected.productionTaskId && onOpenProduction ? <button type="button" className="mt-5 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white" onClick={() => onOpenProduction(selected)}>进入这条任务的生产实况</button> : <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{demo ? "示例任务仅用于验收日历与详情。" : "此任务尚无可打开的内容生产对象；执行状态以后台记录为准。"}</p>}</section></div>}
  </div>;
}
