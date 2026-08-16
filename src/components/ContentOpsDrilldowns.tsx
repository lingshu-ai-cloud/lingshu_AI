import { useState } from 'react';
import { BarChart3, ChevronRight, Database, ShieldCheck, TrendingUp, X } from 'lucide-react';
import { openScriptLibrary } from '../lib/contentActionNavigation';

export type OpsEvidence = {
  id?: string;
  contentId?: string;
  title: string;
  platform?: string;
  metric?: string;
  value?: string;
  comparison?: string;
};

export type OpsConclusion = {
  id: string;
  title: string;
  detail: string;
  evidenceCount: number;
  evidence?: OpsEvidence[];
  methodology?: string;
  dataBoundary?: string;
};

export type OpsTrendPoint = {
  label: string;
  value: number;
  contributors?: OpsEvidence[];
  dataBoundary?: string;
};

export type OpsTrend = { platform: string; metric: string; points: OpsTrendPoint[] };

const readableNumber = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);

function Drawer({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[110] bg-slate-950/45 backdrop-blur-sm" onClick={onClose}>
    <aside className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div><p className="text-[10px] font-black text-emerald-700">{eyebrow}</p><h2 className="mt-1 text-base font-black text-text-primary">{title}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  </div>;
}

function EvidenceList({ items, empty, linkToLibrary = false }: { items?: OpsEvidence[]; empty: string; linkToLibrary?: boolean }) {
  if (!items?.length) return <div className="rounded-xl border border-dashed border-border p-4 text-xs leading-5 text-text-muted">{empty}</div>;
  return <div className="space-y-2">{items.map((item, index) => <div key={item.id || `${item.title}-${index}`} className="rounded-xl border border-border p-3">
    <div className="flex items-start justify-between gap-3"><p className="text-xs font-black text-text-primary">{item.title}</p>{item.platform && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-1 text-[9px] font-black text-text-muted">{item.platform}</span>}</div>
    {(item.metric || item.value) && <p className="mt-2 text-xs text-text-secondary">{[item.metric, item.value].filter(Boolean).join('：')}</p>}
    {item.comparison && <p className="mt-1 text-[10px] leading-4 text-emerald-700">{item.comparison}</p>}
    {linkToLibrary && <button type="button" onClick={() => openScriptLibrary({ tab: 'inspiration', contentId: item.contentId, query: item.title, openDetail: Boolean(item.contentId) })} className="mt-2 flex items-center gap-1 text-[10px] font-black text-emerald-700 hover:text-emerald-800">在脚本库查看相关内容<ChevronRight size={12} /></button>}
  </div>)}</div>;
}

export function HighConfidenceInsights({ conclusions }: { conclusions: OpsConclusion[] }) {
  const [selected, setSelected] = useState<OpsConclusion | null>(null);
  return <>
    <section className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2"><TrendingUp size={15} className="text-emerald-600" /><h3 className="text-xs font-black text-text-primary">高置信运营结论</h3></div>
      {conclusions.length ? <div className="mt-3 space-y-3">{conclusions.map(item => <button type="button" key={item.id} onClick={() => setSelected(item)} className="group block w-full rounded-xl bg-emerald-50/60 p-3 text-left transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
        <div className="flex items-start justify-between gap-3"><p className="text-xs font-black text-emerald-900">{item.title}</p><span className="shrink-0 rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700">高置信 · {item.evidenceCount} 条证据</span></div>
        <p className="mt-1.5 text-xs leading-5 text-emerald-900/80">{item.detail}</p>
        <span className="mt-2 flex items-center gap-1 text-[10px] font-black text-emerald-700">查看证据与口径<ChevronRight size={12} className="transition group-hover:translate-x-0.5" /></span>
      </button>)}</div> : <p className="mt-4 text-xs leading-5 text-text-muted">当前还没有达到展示门槛的高置信结论。需要更多已同步的真实内容表现数据。</p>}
    </section>
    {selected && <Drawer title={selected.title} eyebrow="运营结论证据" onClose={() => setSelected(null)}>
      <section className="rounded-xl bg-emerald-50/70 p-4"><p className="text-xs leading-6 text-emerald-900">{selected.detail}</p><p className="mt-2 text-[10px] font-black text-emerald-700">共关联 {selected.evidenceCount} 条已同步记录</p></section>
      <section className="mt-4"><div className="mb-3 flex items-center gap-2"><Database size={14} className="text-emerald-600" /><h3 className="text-xs font-black text-text-primary">相关内容与指标</h3></div><EvidenceList items={selected.evidence} linkToLibrary empty="当前接口只返回聚合结论和证据数量，尚未返回可逐条展示的内容明细；这里不会用演示内容替代真实证据。" /></section>
      <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">统计口径</h3><p className="mt-2 text-xs leading-6 text-text-secondary">{selected.methodology || '基于当前租户已授权账号、已成功同步的指标快照进行同期比较；未同步日期和平台不可参与推断。'}</p></section>
      <section className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4"><div className="flex items-center gap-2"><ShieldCheck size={14} className="text-amber-700" /><h3 className="text-xs font-black text-amber-900">数据边界</h3></div><p className="mt-2 text-xs leading-6 text-amber-800">{selected.dataBoundary || '结论只描述平台实际返回的指标变化，不等同于因果判断；缺少留存、完播或归因数据时，不推断用户流失原因。'}</p></section>
    </Drawer>}
  </>;
}

export function PlatformTrends({ trends }: { trends: OpsTrend[] }) {
  const [selected, setSelected] = useState<{ trend: OpsTrend; point: OpsTrendPoint; previous?: OpsTrendPoint } | null>(null);
  return <>
    <section className="rounded-xl border border-border p-4"><div className="flex items-center gap-2"><BarChart3 size={15} className="text-emerald-600" /><h3 className="text-xs font-black text-text-primary">平台趋势</h3></div><p className="mt-1 text-[10px] text-text-muted">点击数据点查看当日口径与贡献内容</p>
      <div className="mt-4 space-y-5">{trends.map((trend, index) => { const max = Math.max(...trend.points.map(point => point.value), 1); return <div key={`${trend.platform}-${trend.metric}-${index}`}><div className="mb-2 flex justify-between text-[10px] font-bold text-text-muted"><span>{trend.platform} · {trend.metric}</span><span>{trend.points.length} 个同步点</span></div><div className="flex h-20 items-end gap-1">{trend.points.map((point, pointIndex) => <button type="button" key={`${point.label}-${pointIndex}`} aria-label={`${point.label}，${readableNumber(point.value)}`} onClick={() => setSelected({ trend, point, previous: trend.points[pointIndex - 1] })} title={`${point.label}：${readableNumber(point.value)}`} className="group flex h-full min-w-0 flex-1 items-end focus:outline-none" ><span className="block w-full rounded-t bg-emerald-400/80 transition group-hover:bg-emerald-500 group-focus:ring-2 group-focus:ring-emerald-500/30" style={{ height: `${Math.max(8, point.value / max * 100)}%` }} /></button>)}</div><div className="mt-1 flex justify-between text-[9px] text-text-muted"><span>{trend.points[0]?.label}</span><span>{trend.points.at(-1)?.label}</span></div></div>; })}</div>
    </section>
    {selected && (() => { const delta = selected.previous ? selected.point.value - selected.previous.value : null; const rate = selected.previous?.value ? delta! / selected.previous.value * 100 : null; return <Drawer title={`${selected.trend.platform} · ${selected.point.label}`} eyebrow="趋势数据下钻" onClose={() => setSelected(null)}>
      <div className="grid grid-cols-2 gap-3"><section className="rounded-xl border border-border p-4"><p className="text-[10px] font-bold text-text-muted">{selected.trend.metric}</p><p className="mt-2 text-xl font-black text-text-primary">{readableNumber(selected.point.value)}</p></section><section className="rounded-xl border border-border p-4"><p className="text-[10px] font-bold text-text-muted">较上个同步点</p><p className={`mt-2 text-xl font-black ${delta == null ? 'text-text-muted' : delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta == null ? '无对比点' : `${delta >= 0 ? '+' : ''}${readableNumber(delta)}${rate == null ? '' : `（${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%）`}`}</p></section></div>
      <section className="mt-4"><h3 className="mb-3 text-xs font-black text-text-primary">当日贡献内容</h3><EvidenceList items={selected.point.contributors} empty="当前同步接口没有返回内容级贡献明细，因此只能确认该日期的平台指标值，不能把增长归因到某条内容。" /></section>
      <section className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4"><h3 className="text-xs font-black text-amber-900">可用数据边界</h3><p className="mt-2 text-xs leading-6 text-amber-800">{selected.point.dataBoundary || `${selected.trend.platform} 当前仅展示已同步的“${selected.trend.metric}”时间序列。累计值、增量值和缺失日期按服务端返回口径呈现，不补齐或推测未取得的数据。`}</p></section>
    </Drawer>; })()}
  </>;
}
