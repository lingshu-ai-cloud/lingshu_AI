import type { ReactNode } from 'react';
import { Check, MessageSquareText, Send, ShieldCheck, Tag } from 'lucide-react';

export type AgentDecisionKind = 'content_approval' | 'publish_confirmation' | 'customer_outreach' | 'quote_confirmation';

const kindMeta: Record<AgentDecisionKind, { label: string; icon: typeof Check; tone: string }> = {
  content_approval: { label: '内容审批', icon: ShieldCheck, tone: 'bg-amber-50 text-amber-800' },
  publish_confirmation: { label: '发布确认', icon: Send, tone: 'bg-blue-50 text-blue-800' },
  customer_outreach: { label: '客户触达', icon: MessageSquareText, tone: 'bg-violet-50 text-violet-800' },
  quote_confirmation: { label: '报价确认', icon: Tag, tone: 'bg-emerald-50 text-emerald-800' },
};

type DecisionAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export default function AgentDecisionCard({
  kind,
  title,
  summary,
  cost,
  outputs,
  facts = [],
  note,
  onNoteChange,
  primary,
  secondary,
  tertiary,
  children,
}: {
  kind: AgentDecisionKind;
  title: string;
  summary: string;
  cost?: string;
  outputs?: { count?: number; format?: string; duration?: string };
  facts?: Array<{ label: string; value: ReactNode }>;
  note?: string;
  onNoteChange?: (value: string) => void;
  primary: DecisionAction;
  secondary?: DecisionAction;
  tertiary?: DecisionAction;
  children?: ReactNode;
}) {
  const meta = kindMeta[kind];
  const Icon = meta.icon;
  const outputFacts = outputs ? [
    outputs.count !== undefined ? { label: '数量', value: `${outputs.count} 项` } : null,
    outputs.format ? { label: '形式', value: outputs.format } : null,
    outputs.duration ? { label: '时长', value: outputs.duration } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item)) : [];
  const allFacts: Array<{ label: string; value: ReactNode }> = [
    ...(cost ? [{ label: '成本 / 预算', value: cost }] : []),
    ...outputFacts,
    ...facts,
  ];

  return <div data-agent-decision-card={kind} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}><Icon size={17}/></span><div className="min-w-0 flex-1"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black ${meta.tone}`}>{meta.label}</span><h3 className="mt-2 text-sm font-black text-slate-950">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{summary}</p></div></div>
      {allFacts.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{allFacts.map((item,index)=><div key={`${item.label}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2.5"><dt className="text-[9px] font-bold text-slate-400">{item.label}</dt><dd className="mt-1 truncate text-[11px] font-black text-slate-800">{item.value}</dd></div>)}</dl>}
      {children && <div className="mt-4">{children}</div>}
      {onNoteChange && <textarea value={note || ''} onChange={event => onNoteChange(event.target.value)} className="mt-4 min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-400" placeholder="决策意见（可选）"/>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
      {tertiary&&<button type="button" disabled={tertiary.disabled} onClick={tertiary.onClick} className="mr-auto rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px] font-bold text-violet-700 disabled:opacity-40">{tertiary.label}</button>}
      {secondary&&<button type="button" disabled={secondary.disabled} onClick={secondary.onClick} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-40">{secondary.label}</button>}
      <button type="button" disabled={primary.disabled} onClick={primary.onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-black text-white disabled:opacity-40"><Check size={12}/>{primary.label}</button>
    </div>
  </div>;
}
