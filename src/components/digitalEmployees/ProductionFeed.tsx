import { Activity, ChevronDown, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RunEvent, StreamConnectionStatus } from '../../lib/digitalEmployees';
import { connectionPresentation, formatDateTime, presentEvent } from './presentation';
import { selectProductionEvents, type ProductionFilter } from './selectors';

const FILTERS: Array<[ProductionFilter, string]> = [['all', '全部'], ['running', '执行中'], ['attention', '待处理'], ['exception', '异常'], ['completed', '已完成']];

export function ProductionFeed({
  events,
  connection,
  onRefresh,
  onSelectEvent,
}: {
  events: RunEvent[];
  connection: StreamConnectionStatus;
  onRefresh: () => void;
  onSelectEvent: (event: RunEvent) => void;
}) {
  const [filter, setFilter] = useState<ProductionFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const allMatches = useMemo(() => selectProductionEvents(events, filter, Number.MAX_SAFE_INTEGER), [events, filter]);
  const visible = expanded ? allMatches : allMatches.slice(0, 5);
  const stream = connectionPresentation(connection.phase);
  return <section id="digital-stage-4" className="scroll-mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Activity size={19} className="text-emerald-600" /><div><h2 className="font-bold text-slate-950">实时生产现场</h2><p className="text-[11px] text-slate-400">业务事件默认显示最近 5 条；断线后按游标补齐</p></div></div><div className="flex items-center gap-2"><span aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${stream.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${stream.dot}`} />{stream.label}{connection.retryInMs ? ` · ${Math.ceil(connection.retryInMs / 1000)} 秒后重试` : ''}</span><button type="button" aria-label="刷新生产现场" onClick={onRefresh} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><RefreshCcw size={15} /></button></div></div>
    <div className="mb-4 flex flex-wrap gap-2">{FILTERS.map(([value, label]) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => { setFilter(value); setExpanded(false); }} className={`rounded-full px-3 py-1 text-xs ${filter === value ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>)}</div>
    <div className="space-y-2">
      {visible.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">当前筛选下暂无生产事件。</p>}
      {visible.map(event => <button type="button" key={event.id} onClick={() => onSelectEvent(event)} className="flex w-full gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-100">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.level === 'success' ? 'bg-emerald-500' : event.level === 'warning' ? 'bg-amber-500' : event.level === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} />
        <span className="min-w-0 flex-1 border-b border-slate-100 pb-3"><span className="flex items-start justify-between gap-3"><span className="text-sm font-semibold text-slate-800">{presentEvent(event.type, event.summary)}</span><span className="shrink-0 text-[10px] text-slate-400">{formatDateTime(event.occurred_at)}</span></span>{event.summary && presentEvent(event.type, event.summary) !== event.summary && <span className="mt-1 block text-[11px] text-slate-500">{event.summary}</span>}</span>
      </button>)}
    </div>
    {allMatches.length > 5 && <button type="button" onClick={() => setExpanded(value => !value)} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-slate-600">{expanded ? '收起到 5 条' : `查看全部 ${allMatches.length} 条`}<ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button>}
  </section>;
}
