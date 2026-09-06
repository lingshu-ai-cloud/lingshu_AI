import { ArrowRight } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { agentExecutionSummary } from '../lib/agentExecutionSummary';

export default function AgentExecutionStatus({ data, onOpen, collapsed = false, detailId }: { data: DigitalEmployeeOverview; onOpen: (taskId?: string) => void; collapsed?: boolean; detailId?: string }) {
  const state = agentExecutionSummary(data);
  return <div aria-label="智能体执行状态" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border bg-surface-2/60 px-3 py-3">
    <div className="min-w-0 flex-1" role="status">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-text-primary"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${state.running ? 'bg-accent motion-safe:animate-pulse' : 'bg-text-muted'}`}/>{state.label}<span className="font-normal text-text-secondary">执行步骤已完成 {state.completed} / {state.total}</span></p>
      <p id={detailId} hidden={collapsed} className="mt-1 break-words text-xs leading-5 text-text-muted">{state.detail}</p>
    </div>
    <button type="button" onClick={() => onOpen(state.taskId)} className="inline-flex shrink-0 items-center gap-1 border-b border-accent/30 pb-0.5 text-xs font-semibold text-accent transition-colors hover:border-accent hover:text-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25">查看执行详情<ArrowRight size={14}/></button>
  </div>;
}
