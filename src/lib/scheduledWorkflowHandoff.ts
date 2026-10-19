export type ScheduledTaskExecutionState =
  'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'worker_offline' | 'no_data' | 'collected' | 'partial';

export type ScheduledWorkflowHandoff = {
  runId: string;
  taskId: string;
  taskKey: 'scheduled_source_collection';
  preview?: boolean;
  entityId?: string;
};

const SCHEDULED_WORKFLOW_HANDOFF_TTL = 15 * 60 * 1000;

export function parseScheduledWorkflowHandoff(raw: string, now = Date.now()): ScheduledWorkflowHandoff | null {
  try {
    const parsed = JSON.parse(raw) as {
      page?: string;
      runId?: string;
      taskId?: string;
      issuedAt?: number;
      businessRef?: { taskKey?: string; preview?: boolean; entityId?: string };
    };
    const issuedAt = Number(parsed.issuedAt);
    const age = now - issuedAt;
    const runId = String(parsed.runId || '').trim();
    const taskId = String(parsed.taskId || '').trim();
    const preview = parsed.businessRef?.preview === true;
    if (parsed.page !== 'scheduled'
      || parsed.businessRef?.taskKey !== 'scheduled_source_collection'
      || (!preview && (!runId || !taskId))
      || !Number.isFinite(issuedAt)
      || age < 0
      || age > SCHEDULED_WORKFLOW_HANDOFF_TTL) return null;
    return {
      runId,
      taskId,
      taskKey: 'scheduled_source_collection',
      ...(parsed.businessRef?.entityId ? { entityId: parsed.businessRef.entityId } : {}),
      ...(preview ? { preview: true } : {}),
    };
  } catch { return null; }
}

export function peekScheduledWorkflowHandoff(): ScheduledWorkflowHandoff | null {
  try {
    const raw = window.sessionStorage.getItem('digitalEmployee.businessDeepLink');
    return raw ? parseScheduledWorkflowHandoff(raw) : null;
  } catch { return null; }
}

export function consumeScheduledWorkflowHandoff(): ScheduledWorkflowHandoff | null {
  try {
    const raw = window.sessionStorage.getItem('digitalEmployee.businessDeepLink');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { page?: string };
    if (parsed.page !== 'scheduled') return null;
    window.sessionStorage.removeItem('digitalEmployee.businessDeepLink');
    return parseScheduledWorkflowHandoff(raw);
  } catch { return null; }
}
