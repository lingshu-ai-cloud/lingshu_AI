import { ExternalLink, FileText, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RunEvent, WorkflowTask } from '../../lib/digitalEmployees';
import { eventTechnicalDetail, extractArtifactReferences, formatDateTime, outputSummary, presentEvent } from './presentation';
import { StatusBadge } from './StatusBadge';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TaskDetailDrawer({
  task,
  selectedEvent = null,
  events,
  onClose,
}: {
  task: WorkflowTask | null;
  selectedEvent?: RunEvent | null;
  events: RunEvent[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = Boolean(task || selectedEvent);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const elements = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const trace = task ? events.filter(event => event.task_id === task.id).sort((a, b) => a.sequence - b.sequence) : selectedEvent ? [selectedEvent] : [];
  const artifacts = task ? extractArtifactReferences(task.output) : [];
  const title = task?.title || (selectedEvent ? presentEvent(selectedEvent.type, selectedEvent.summary) : '运行详情');
  const drawerId = 'digital-employee-task-drawer-title';
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={drawerId} className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-emerald-700">{task ? '任务详情' : '事件详情'}</p><h2 id={drawerId} className="mt-1 text-xl font-black text-slate-950">{title}</h2>{task && <div className="mt-2"><StatusBadge status={task.status} /></div>}</div><button ref={closeRef} type="button" aria-label="关闭详情" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-200"><X size={20} /></button></div>

      <section className="mt-6" aria-labelledby="task-summary-heading"><h3 id="task-summary-heading" className="text-sm font-bold">任务摘要</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{task?.description || selectedEvent?.summary || '暂无摘要'}</p>{task && outputSummary(task) && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{outputSummary(task)}</p>}{task?.blocked_reason && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">阻塞原因：{task.blocked_reason}</p>}</section>

      <section className="mt-6" aria-labelledby="task-trace-heading"><h3 id="task-trace-heading" className="text-sm font-bold">执行轨迹</h3><div className="mt-2 space-y-2">{trace.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">暂无关联事件</p>}{trace.map(event => <div key={event.id} className={`rounded-xl border p-3 text-xs ${selectedEvent?.id === event.id ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-slate-800">{presentEvent(event.type, event.summary)}</p><time className="shrink-0 text-[10px] text-slate-400">{formatDateTime(event.occurred_at)}</time></div>{event.summary && presentEvent(event.type, event.summary) !== event.summary && <p className="mt-1 text-slate-500">{event.summary}</p>}</div>)}</div></section>

      <section className="mt-6" aria-labelledby="task-artifact-heading"><h3 id="task-artifact-heading" className="text-sm font-bold">产出物与引用</h3><div className="mt-2 space-y-2">{artifacts.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400">未返回正式记录引用；产出正文不会复制到数字员工任务中。</p>}{artifacts.map(item => <div key={item.key} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText size={16} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{item.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.type}{item.version ? ` · v${item.version}` : ''}</p></div>{item.href && <a href={item.href} aria-label={`打开${item.label}`} className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"><ExternalLink size={15} /></a>}</div>)}</div></section>

      <section className="mt-6" aria-labelledby="task-operations-heading"><h3 id="task-operations-heading" className="text-sm font-bold">操作记录</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-400">开始时间</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(task?.started_at)}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-400">完成时间</dt><dd className="mt-1 font-semibold text-slate-700">{formatDateTime(task?.completed_at)}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-400">尝试次数</dt><dd className="mt-1 font-semibold text-slate-700">{task?.attempt ?? '—'} / {task?.max_attempts ?? '—'}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-400">实际费用</dt><dd className="mt-1 font-semibold text-slate-700">{task?.actual_cost === undefined ? '待回写' : `¥${Number(task.actual_cost).toFixed(2)}`}</dd></div></dl></section>

      <details className="mt-6 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold">技术详情</summary><pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify({ task: task ? { id: task.id, key: task.task_key, sequence: task.sequence, status: task.status, runId: task.run_id, idempotencyKey: task.idempotency_key, errorCode: task.error_code, errorDetail: task.error_detail, output: task.output } : null, event: selectedEvent ? eventTechnicalDetail(selectedEvent) : null }, null, 2)}</pre></details>
    </aside>
  </div>;
}
