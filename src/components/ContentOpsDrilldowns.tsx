import { useState } from 'react';
import { BarChart3, ChevronRight, Database, ShieldCheck, TrendingUp, X } from 'lucide-react';
import { openScriptLibrary } from '../lib/contentActionNavigation';
import { useModalFocus } from '../hooks/useModalFocus';

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
  const dialogRef = useModalFocus<HTMLElement>({ open: true, onClose });
  return <div role="presentation" className="fixed inset-0 z-[110] bg-slate-950/45" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="content-ops-drawer-title" className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-border bg-white shadow-xl" onMouseDown={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">{eyebrow}</p><h2 id="content-ops-drawer-title" className="mt-1 text-base font-bold text-text-primary">{title}</h2></div>
        <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭" className="rounded-md p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
    </aside>
  </div>;
}

function EvidenceList({ items, empty, linkToLibrary = false }: { items?: OpsEvidence[]; empty: string; linkToLibrary?: boolean }) {
  if (!items?.length) return <div className="rounded-md border border-dashed border-border p-4 text-xs leading-5 text-text-muted">{empty}</div>;
  return <div className="divide-y divide-border border-y border-border">{items.map((item, index) => <div key={item.id || `${item.title}-${index}`} className="py-3">
    <div className="flex items-start justify-between gap-3"><p className="text-xs font-bold text-text-primary">{item.title}</p>{item.platform && <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 text-[9px] font-bold text-text-muted">{item.platform}</span>}</div>
    {(item.metric || item.value) && <p className="mt-2 text-xs text-text-secondary">{[item.metric, item.value].filter(Boolean).join('：')}</p>}
    {item.comparison && <p className="mt-1 text-[10px] leading-4 text-accent">{item.comparison}</p>}
    {linkToLibrary && <button type="button" onClick={() => openScriptLibrary({ tab: 'inspiration', contentId: item.contentId, query: item.title, openDetail: Boolean(item.contentId) })} className="mt-2 flex items-center gap-1 text-[10px] font-bold text-accent hover:text-accent-dim">在脚本库查看相关内容<ChevronRight size={12} /></button>}
  </div>)}</div>;
}

export function HighConfidenceInsights({ conclusions }: { conclusions: OpsConclusion[] }) {
  const [selected, setSelected] = useState<OpsConclusion | null>(null);
  return <>
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2"><TrendingUp size={15} className="text-accent" /><h3 className="text-xs font-bold text-text-primary">高置信运营结论</h3></div>
      {conclusions.length ? <div className="mt-3 divide-y divide-border border-y border-border">{conclusions.map(item => <button type="button" key={item.id} onClick={() => setSelected(item)} className="group block w-full py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row"><p className="text-xs font-bold text-text-primary">{item.title}</p><span className="shrink-0 border-l-2 border-accent bg-accent-glow px-2 py-1 text-[9px] font-bold text-accent">高置信 · {item.evidenceCount} 条证据</span></div>
        <p className="mt-1.5 text-xs leading-5 text-text-secondary">{item.detail}</p>
        <span className="mt-2 flex items-center gap-1 text-[10px] font-bold text-accent">查看证据与口径<ChevronRight size={12} /></span>
      </button>)}</div> : <p className="mt-4 text-xs leading-5 text-text-muted">当前还没有达到展示门槛的高置信结论。需要更多已同步的真实内容表现数据。</p>}
    </section>
    {selected && <Drawer title={selected.title} eyebrow="运营结论证据" onClose={() => setSelected(null)}>
      <section className="border-l-2 border-accent bg-accent-glow p-4"><p className="text-xs leading-6 text-text-secondary">{selected.detail}</p><p className="mt-2 text-[10px] font-bold text-accent">共关联 {selected.evidenceCount} 条已同步记录</p></section>
      <section className="mt-4"><div className="mb-3 flex items-center gap-2"><Database size={14} className="text-accent" /><h3 className="text-xs font-bold text-text-primary">相关内容与指标</h3></div><EvidenceList items={selected.evidence} linkToLibrary empty="当前接口只返回聚合结论和证据数量，尚未返回可逐条展示的内容明细；这里不会用演示内容替代真实证据。" /></section>
      <section className="mt-4 rounded-md border border-border p-4"><h3 className="text-xs font-bold text-text-primary">统计口径</h3><p className="mt-2 text-xs leading-6 text-text-secondary">{selected.methodology || '基于当前租户已授权账号、已成功同步的指标快照进行同期比较；未同步日期和平台不可参与推断。'}</p></section>
      <section className="mt-4 border-l-2 border-insight bg-insight-soft p-4"><div className="flex items-center gap-2"><ShieldCheck size={14} className="text-insight-action" /><h3 className="text-xs font-bold text-insight-action">数据边界</h3></div><p className="mt-2 text-xs leading-6 text-insight-action">{selected.dataBoundary || '结论只描述平台实际返回的指标变化，不等同于因果判断；缺少留存、完播或归因数据时，不推断用户流失原因。'}</p></section>
    </Drawer>}
  </>;
}

export function PlatformTrends({ trends }: { trends: OpsTrend[] }) {
  const [selected, setSelected] = useState<{ trend: OpsTrend; point: OpsTrendPoint; previous?: OpsTrendPoint } | null>(null);
  return <>
    <section className="rounded-lg border border-border p-4"><div className="flex items-center gap-2"><BarChart3 size={15} className="text-accent" /><h3 className="text-xs font-bold text-text-primary">平台趋势</h3></div><p className="mt-1 text-[10px] text-text-muted">点击数据点查看当日口径与贡献内容</p>
      <div className="mt-4 space-y-5">{trends.map((trend, index) => { const max = Math.max(...trend.points.map(point => point.value), 1); return <div key={`${trend.platform}-${trend.metric}-${index}`}><div className="mb-2 flex justify-between text-[10px] font-bold text-text-muted"><span>{trend.platform} · {trend.metric}</span><span>{trend.points.length} 个同步点</span></div><div className="flex h-20 items-end gap-1">{trend.points.map((point, pointIndex) => <button type="button" key={`${point.label}-${pointIndex}`} aria-label={`${point.label}，${readableNumber(point.value)}`} onClick={() => setSelected({ trend, point, previous: trend.points[pointIndex - 1] })} title={`${point.label}：${readableNumber(point.value)}`} className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" ><span className="block w-full rounded-t bg-accent/70 transition group-hover:bg-accent" style={{ height: `${Math.max(8, point.value / max * 100)}%` }} /></button>)}</div><div className="mt-1 flex justify-between text-[9px] text-text-muted"><span>{trend.points[0]?.label}</span><span>{trend.points.at(-1)?.label}</span></div></div>; })}</div>
    </section>
    {selected && (() => { const delta = selected.previous ? selected.point.value - selected.previous.value : null; const rate = selected.previous?.value ? delta! / selected.previous.value * 100 : null; return <Drawer title={`${selected.trend.platform} · ${selected.point.label}`} eyebrow="趋势数据下钻" onClose={() => setSelected(null)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><section className="rounded-md border border-border p-4"><p className="text-[10px] font-bold text-text-muted">{selected.trend.metric}</p><p className="mt-2 text-xl font-bold text-text-primary">{readableNumber(selected.point.value)}</p></section><section className="rounded-md border border-border p-4"><p className="text-[10px] font-bold text-text-muted">较上个同步点</p><p className={`mt-2 text-xl font-bold ${delta == null ? 'text-text-muted' : delta >= 0 ? 'text-accent' : 'text-red'}`}>{delta == null ? '无对比点' : `${delta >= 0 ? '+' : ''}${readableNumber(delta)}${rate == null ? '' : `（${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%）`}`}</p></section></div>
      <section className="mt-4"><h3 className="mb-3 text-xs font-bold text-text-primary">当日贡献内容</h3><EvidenceList items={selected.point.contributors} empty="当前同步接口没有返回内容级贡献明细，因此只能确认该日期的平台指标值，不能把增长归因到某条内容。" /></section>
      <section className="mt-4 border-l-2 border-insight bg-insight-soft p-4"><h3 className="text-xs font-bold text-insight-action">可用数据边界</h3><p className="mt-2 text-xs leading-6 text-insight-action">{selected.point.dataBoundary || `${selected.trend.platform} 当前仅展示已同步的“${selected.trend.metric}”时间序列。累计值、增量值和缺失日期按服务端返回口径呈现，不补齐或推测未取得的数据。`}</p></section>
    </Drawer>; })()}
  </>;
}
