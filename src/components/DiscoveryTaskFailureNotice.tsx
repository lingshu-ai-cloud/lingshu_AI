import type { WorkflowTask } from '../lib/digitalEmployees';
import { discoveryFailurePresentation } from '../lib/discoveryFailurePresentation';

/** Explain a failed collection without replacing the persisted provider reason. */
export default function DiscoveryTaskFailureNotice({ task }: { task: WorkflowTask }) {
  if (task.task_key !== 'scheduled_source_collection' || !['failed', 'waiting_human', 'waiting_external'].includes(task.status)) return null;
  const reason = task.blocked_reason?.trim();
  if (!reason) return null;
  const diagnosis = discoveryFailurePresentation(reason);
  const tone = task.status === 'failed' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950';
  return <section role="alert" aria-label="素材采集阻塞说明" className={`rounded-lg border px-4 py-3 text-xs leading-5 ${tone}`}>
    <h4 className="font-semibold">{diagnosis?.label || '素材采集需要处理'}</h4>
    {diagnosis?.action && <p className="mt-1">建议：{diagnosis.action}</p>}
    <p className="mt-1 break-words">原始原因：{reason}</p>
  </section>;
}
