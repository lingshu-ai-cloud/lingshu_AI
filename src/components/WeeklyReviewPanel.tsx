import ReviewTodoFloat, { type ReviewTodoApi } from './ReviewTodoFloat';
import type { ReviewTodoBoard } from '../lib/reviewTodos';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, FileText, Lightbulb, Play, Search, Sparkles, Target, Users, X } from 'lucide-react';
import type { BusinessDestination, DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { buildReviewInsights, reviewCategories, type ReviewCategory, type ReviewInsight } from '../lib/reviewInsights';

const icons = { channel: BarChart3, content: Play, knowledge: BookOpen, blocker: CircleHelp, opportunity: Users, product: Lightbulb, strategy: Target };
const tones = { channel: 'bg-blue-50 text-blue-700', content: 'bg-violet-50 text-violet-700', knowledge: 'bg-teal-50 text-teal-700', blocker: 'bg-amber-50 text-amber-700', opportunity: 'bg-emerald-50 text-emerald-700', product: 'bg-rose-50 text-rose-700', strategy: 'bg-indigo-50 text-indigo-700' };
const categoryOf = (id: ReviewCategory) => reviewCategories.find(c => c.id === id)!;
const dateText = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '待确认';

interface Props {
  data: DigitalEmployeeOverview;
  onGoLive: (taskId?: string, deliveryId?: string) => void;
  onOpen: (page: BusinessDestination, view?: 'create' | 'publish') => void;
  onHistory: () => void;
  period: "week" | "lastWeek" | "month" | "lastMonth";
  onPeriodChange: (period: Props["period"]) => void;
  rangeBusy?: boolean;
  todoApi?: ReviewTodoApi;
  onGoal: (goalId: string) => void;
}

function Evidence({ insight }: { insight: ReviewInsight }) {
  const max = Math.max(1, ...insight.evidence.map(e => e.amount || 0));
  return <div className="space-y-3">{insight.evidence.map((item, i) => <div key={`${item.label}-${i}`} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium text-slate-600">{item.label}</span><span className="font-semibold text-slate-900">{item.value}</span></div>
    {item.amount !== undefined && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${item.amount / max * 100}%` }}/></div>}
    {item.note && <p className="mt-2 text-xs leading-5 text-slate-500">{item.note}</p>}
  </div>)}</div>;
}

function InsightDrawer({ insight, onClose, onAction }: { insight: ReviewInsight; onClose: () => void; onAction: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const Icon = icons[insight.category];
  return createPortal(<div className="fixed inset-0 z-[100] flex justify-end">
    <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm" onClick={onClose} aria-hidden="true"/>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl outline-none">
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon size={17}/>{categoryOf(insight.category).label}</span><button type="button" onClick={onClose} aria-label="关闭洞察详情" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20}/></button></header>
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${insight.confidence === 'observed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{insight.confidence === 'observed' ? '已有数据支持' : '待核实候选'}</span>
        <h2 id={titleId} className="mt-4 text-2xl font-bold leading-relaxed text-slate-950">{insight.title}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">{insight.summary}</p>
        <h3 className="mb-3 mt-8 text-sm font-semibold text-slate-900">判断依据</h3><Evidence insight={insight}/>
        <p className="mt-4 rounded-xl bg-amber-50/70 p-4 text-xs leading-6 text-amber-800">{insight.caveat}</p>
        <h3 className="mb-3 mt-8 text-sm font-semibold text-slate-900">建议下一步</h3><p className="text-sm leading-7 text-slate-600">{insight.suggestion}</p>
      </div>
      <footer className="flex items-center justify-between gap-4 border-t border-slate-100 bg-white px-6 py-5"><span className="text-xs text-slate-500">进入对应页面继续处理</span><button type="button" onClick={onAction} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700">{insight.action.label}<ArrowUpRight size={16}/></button></footer>
    </div>
  </div>, document.body);
}

export default function WeeklyReviewPanel({ data, onGoLive, onOpen, onHistory, period, onPeriodChange, rangeBusy, todoApi, onGoal }: Props) {
  const [todoIncoming, setTodoIncoming] = useState<ReviewInsight | null>(null);
  const [todoBoard, setTodoBoard] = useState<ReviewTodoBoard | null>(null);
  const [filter, setFilter] = useState<ReviewCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const insights = useMemo(() => buildReviewInsights(data), [data]);
  const selected = insights.find(i => i.id === selectedId);
  const close = useMemo(() => () => setSelectedId(null), []);
  const snapshot = data.businessSnapshot || data.liveReview?.businessSnapshot;
  const visible = insights.filter(i => filter === 'all' || i.category === filter);
  const featured = insights.filter(i => i.confidence === 'observed').filter((item, index, list) => list.findIndex(other => other.category === item.category) === index).slice(0, 3);
  const delivered = (data.deliveries || []).filter(d => d.column === 'done');
  const openAction = (insight: ReviewInsight) => { setSelectedId(null); if (insight.action.taskId) onGoLive(insight.action.taskId); else if (insight.action.page) onOpen(insight.action.page, insight.action.page === 'smartAssets' ? 'publish' : undefined); };
  return <div className="space-y-7 pb-8" aria-busy={rangeBusy}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-700"><Sparkles size={15}/>经营洞察</div><h1 className="text-2xl font-bold tracking-tight text-slate-950">每一轮，都找到下一步</h1><p className="mt-2 text-sm text-slate-500">渠道往哪投，内容怎么拍，客户怎么推进。</p></div>
      <div className="text-right"><div className="flex items-center justify-end gap-3"><button type="button" onClick={onHistory} className="text-xs text-slate-500 hover:text-emerald-700">历史目标</button><select aria-label="复盘周期" value={period} disabled={rangeBusy} onChange={e => onPeriodChange(e.target.value as Props['period'])} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"><option value="week">本周</option><option value="lastWeek">上周</option><option value="month">本月</option><option value="lastMonth">上月</option></select></div><p className="mt-2 text-xs text-slate-500">{dateText(snapshot?.range.startsAt || data.goal?.startsAt)} — {dateText(snapshot?.range.endsAt || data.goal?.endsAt)} · 全部已接入账号</p><p role="status" className="mt-1 text-xs text-slate-400">{rangeBusy ? '正在更新复盘数据…' : snapshot?.generatedAt ? `更新于 ${dateText(snapshot.generatedAt)} ${new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待数据回收'}</p></div>
    </header>

    <p className="text-xs leading-6 text-slate-500">{data.run && !['succeeded', 'completed', 'failed', 'cancelled'].includes(data.run.status) ? '本轮仍在运行，以下为阶段性发现。' : ''}平台数据按所选周期统计；执行卡点与知识候选属于当前目标。</p>
    <section aria-label="本期值得行动" className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 via-white to-white p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><span className="h-2 w-2 rounded-full bg-emerald-500"/>本期值得行动</h2><span className="text-xs text-slate-500">优先看这几件事</span></div>
      {featured.length ? <div className={`grid gap-4 ${featured.length === 2 ? 'md:grid-cols-2' : featured.length >= 3 ? 'md:grid-cols-3' : ''}`}>{featured.map((item, index) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="group flex flex-col rounded-xl border border-slate-200/80 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm"><span className="flex w-full items-center justify-between text-xs font-medium text-slate-500">{categoryOf(item.category).label}<span className="font-mono text-slate-300">0{index + 1}</span></span><h3 className="mb-2 mt-3 text-base font-bold leading-7 text-slate-900">{item.title}</h3><p className="line-clamp-2 text-sm leading-6 text-slate-500">{item.summary}</p><span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">查看判断与行动<ArrowRight size={14}/></span></button>)}</div> : <div className="flex items-start gap-3 rounded-xl bg-white/80 p-5"><Search size={20} className="mt-1 shrink-0 text-emerald-600"/><div><p className="text-sm font-semibold text-slate-800">本期还没有足够证据支持优先行动</p><p className="mt-2 text-sm leading-6 text-slate-500">完成发布与客户沟通后，复盘会基于实际回收的数据更新。下方可查看各类洞察还需要哪些信息。</p></div></div>}
    </section>

    <section aria-label="全部洞察">
      <div className="mb-4 flex items-center gap-2"><h2 className="text-base font-bold text-slate-900">全部洞察</h2><span className="rounded-full bg-slate-200/60 px-2 py-0.5 text-xs text-slate-600">{insights.length}</span></div>
      <div aria-label="洞察分类" className="mb-5 flex flex-wrap gap-2">{[{ id: 'all' as const, short: '全部' }, ...reviewCategories].map(c => <button key={c.id} type="button" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)} className={`rounded-lg px-3.5 py-2 text-sm transition ${filter === c.id ? 'bg-slate-950 font-semibold text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{c.short}</button>)}</div>
      <div aria-live="polite" className="space-y-4">{visible.map(item => { const Icon = icons[item.category]; return <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${tones[item.category]}`}><Icon size={13}/>{categoryOf(item.category).label}</span><span className="text-xs text-slate-400">{item.confidence === 'observed' ? '已有数据支持' : '待核实候选'}</span></div>
        <button type="button" onClick={() => setSelectedId(item.id)} className="mt-4 text-left text-lg font-bold leading-7 text-slate-900 hover:text-emerald-700">{item.title}</button><p className="mt-2 max-w-4xl text-sm leading-7 text-slate-500">{item.summary}</p>
        {item.category === 'channel' && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{item.evidence.map(e => <div key={e.label} className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs text-slate-500">{e.label}</p><p className="mt-1 text-base font-bold text-slate-900">{e.value}</p></div>)}</div>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setSelectedId(item.id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"><FileText size={14}/>查看依据<ArrowRight size={13}/></button><span className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => setTodoIncoming(item)} className="text-xs font-semibold text-emerald-700">{todoBoard?.items.some(t => t.sourceIds.includes(item.id)) ? '已加入下周待办 · 查看' : '加入下周待办'}</button><button type="button" onClick={() => openAction(item)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">{item.action.label}<ArrowUpRight size={14}/></button></span></div>
      </article>; })}
      {!visible.length && <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center"><Search size={25} className="mx-auto text-slate-300"/><h3 className="mt-4 text-sm font-semibold text-slate-800">{filter === 'all' ? '本期暂无可展示的洞察' : `暂无${categoryOf(filter).label}洞察`}</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-slate-500">{filter === 'all' ? '选择分类查看所需信息；有真实证据后再形成判断。' : categoryOf(filter).missing}</p>{filter !== 'all' && <button type="button" onClick={() => setFilter('all')} className="mt-5 text-sm font-medium text-emerald-700">查看全部洞察</button>}</div>}
      </div>
    </section>

    <details className="rounded-xl border border-slate-200 bg-white px-5 py-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">洞察覆盖与数据缺口<span className="ml-2 text-xs font-normal text-slate-400">{reviewCategories.filter(c => insights.some(i => i.category === c.id)).length} / 7 类已有发现</span></summary><div className="mt-5 grid gap-4 sm:grid-cols-2">{reviewCategories.map(c => <div key={c.id} className="rounded-xl bg-slate-50 p-4"><p className="flex items-center gap-2 text-xs font-semibold text-slate-700">{insights.some(i => i.category === c.id) ? <Check size={14} className="text-emerald-600"/> : <CircleHelp size={14} className="text-slate-400"/>}{c.label}</p><p className="mt-2 text-xs leading-6 text-slate-500">{insights.some(i => i.category === c.id) ? '已有发现，具体证据与适用范围见洞察详情。' : c.missing}</p></div>)}</div>{snapshot?.dataGaps?.length ? <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">{snapshot.dataGaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul> : null}</details>
    <details className="rounded-xl border border-slate-200 bg-white px-5 py-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">执行与交付记录<span className="ml-2 text-xs font-normal text-slate-400">{delivered.length} 项已交付</span></summary><p className="mt-3 text-xs leading-5 text-slate-400">执行记录属于当前所选目标，经营指标范围以上方日期为准。</p><div className="mt-3 divide-y divide-slate-100">{delivered.map(card => <button key={card.id} type="button" onClick={() => onGoLive(card.taskId, card.id)} className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm text-slate-700 hover:text-emerald-700"><span>{card.title}<span className="mt-1 block text-xs text-slate-400">{card.subject}</span></span><ArrowRight size={15}/></button>)}</div>{!delivered.length && <p className="mt-3 text-sm text-slate-500">当前目标暂无已交付记录。</p>}<button type="button" onClick={() => onGoLive()} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">查看任务执行<ArrowRight size={13}/></button></details>
    <ReviewTodoFloat data={data} incoming={todoIncoming} onConsumed={() => setTodoIncoming(null)} onBoard={setTodoBoard} onGoal={onGoal} api={todoApi}/>
    {selected && <InsightDrawer insight={selected} onClose={close} onAction={() => openAction(selected)}/>}
  </div>;
}
