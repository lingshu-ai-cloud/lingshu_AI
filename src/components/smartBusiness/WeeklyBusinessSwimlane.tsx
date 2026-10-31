import { useState } from 'react';
import { Checkbox, Tag } from 'antd';
import { AlertCircle, ChevronRight } from 'lucide-react';
import type { WeeklyBusinessLane, WeeklyBusinessProjection, WeeklyLaneNode } from '../../lib/weeklyBusinessSwimlane';

const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('zh-CN', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' });
const updated = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未取得';
const tone: Record<WeeklyLaneNode['status'], string> = {
  planned: 'border-border bg-surface text-text-secondary',
  working: 'border-accent/40 bg-blue-50 text-accent',
  attention: 'border-error bg-red-50 text-error',
  done: 'border-success/40 bg-emerald-50 text-emerald-800',
};
const dot: Record<WeeklyLaneNode['status'], string> = {
  planned: 'bg-text-muted', working: 'bg-accent', attention: 'bg-error', done: 'bg-success',
};

function NodePill({ node, lane, onOpenLane, onOpenContent }: {
  node: WeeklyLaneNode; lane: WeeklyBusinessLane;
  onOpenLane: (lane: WeeklyBusinessLane) => void; onOpenContent: (taskId?: string) => void;
}) {
  return <button type="button" title={node.detail} aria-label={node.detail}
    onClick={() => node.taskId ? onOpenContent(node.taskId) : onOpenLane(lane)}
    className={`inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone[node.status]}`}>
    <span className={`size-2 shrink-0 rounded-full ${dot[node.status]}`} aria-hidden="true"/>
    <span className="truncate">{node.label}</span>
    {node.status === 'attention' && <AlertCircle size={13} className="shrink-0" aria-hidden="true"/>}
  </button>;
}

export default function WeeklyBusinessSwimlane({ projection, onOpenLane, onOpenContent }: {
  projection: WeeklyBusinessProjection;
  onOpenLane: (lane: WeeklyBusinessLane) => void;
  onOpenContent: (taskId?: string) => void;
}) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const lanes = attentionOnly ? projection.lanes.filter(lane => lane.needsAttention) : projection.lanes;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return <section aria-label="本周业务泳道" className="overflow-hidden rounded-xl border border-border bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
      <div className="min-w-0"><h2 className="text-lg font-semibold text-text-primary">{projection.title}</h2>
        <p className="mt-1 text-sm text-text-secondary">{projection.originalCount === null ? '独立制作数尚未取得' : `${projection.originalCount} 条独立内容`} / {projection.publicationCount === null ? '发布位数尚未取得' : `${projection.publicationCount} 个发布位`} · 最近更新 {updated(projection.updatedAt)}</p>
      </div>
      {projection.attentionCount > 0 && <Tag color="error" icon={<AlertCircle size={13} aria-hidden="true"/>}>{projection.attentionCount} 项需处理</Tag>}
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-text-secondary">
      <span>业务泳道 · {projection.weekDays[0] || '日期待定'} — {projection.weekDays.at(-1) || '日期待定'}</span>
      <label className="inline-flex min-h-11 items-center gap-2"><Checkbox checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)}/>只看待处理</label>
    </div>
    <div className="overflow-x-auto" role="region" aria-label="按经营周日期查看业务泳道" tabIndex={0}>
      <div className="min-w-[1110px]">
        <div className="grid grid-cols-[192px_repeat(7,minmax(0,1fr))] border-b border-border bg-surface-2 text-xs text-text-secondary">
          <span className="sticky left-0 z-20 border-r border-border bg-surface-2 px-4 py-3 font-semibold">业务 / 本周日期</span>
          {projection.weekDays.map(date => <time key={date} dateTime={date} className={`border-r border-border px-2 py-3 text-center last:border-r-0 ${date === today ? 'bg-blue-50 font-semibold text-accent' : ''}`}>{dayLabel(date)}{date === today ? ' · 今天' : ''}</time>)}
        </div>
        {lanes.map(lane => <div key={lane.key} className="grid min-h-[86px] grid-cols-[192px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0">
          <button type="button" onClick={() => onOpenLane(lane)} className="sticky left-0 z-10 flex min-w-0 items-center justify-between gap-2 border-r border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`查看${lane.label}详情`}>
            <span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{lane.label}</strong><small className={`mt-1 block truncate ${lane.needsAttention ? 'text-error' : 'text-text-secondary'}`}>{lane.status}</small></span><ChevronRight size={15} className="shrink-0 text-text-muted" aria-hidden="true"/>
          </button>
          {lane.nodes.length === 0 && <div className="col-span-7 flex min-w-0 items-center px-4 py-2 text-xs text-text-secondary"><span className="truncate" title={lane.current}>{lane.current}</span></div>}
          {lane.nodes.length > 0 && projection.weekDays.map(date => <div key={date} className={`flex min-w-0 flex-col items-start justify-center gap-1 border-r border-border px-1.5 py-2 last:border-r-0 ${date === today ? 'bg-blue-50/30' : ''}`}>
            {lane.nodes.filter(node => node.date === date).map(node => <NodePill key={node.id} node={node} lane={lane} onOpenLane={onOpenLane} onOpenContent={onOpenContent}/>)}
          </div>)}
        </div>)}
        {lanes.length === 0 && <div className="px-4 py-6 text-center text-sm text-text-secondary">目前没有需要处理的业务节点。</div>}
      </div>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-text-muted">
      <span className="inline-flex flex-wrap gap-3"><span>● 已排期</span><span className="text-accent">● 进行中</span><span className="text-error">● 需处理</span><span className="text-success">● 已完成</span></span>
    </footer>
  </section>;
}
