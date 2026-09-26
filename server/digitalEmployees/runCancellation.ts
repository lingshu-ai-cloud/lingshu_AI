import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { withDigitalEmployeeRunLock } from './runControl.js';

type Row = { id: string } & Record<string, unknown>;

export class DigitalEmployeeRunCancellationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'DigitalEmployeeRunCancellationError';
  }
}

const text = (value: unknown): string => String(value ?? '').trim();
const object = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
};

export function digitalEmployeeRunVersion(run: Row): string {
  return text(run.version)
    || text(run.updated_at)
    || text(run.updated)
    || [text(run.status), text(run.started_at), text(run.completed_at)].join(':');
}

async function requiredUpdate(
  dataStore: DataStore,
  collection: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!await dataStore.update(collection, id, patch)) {
    throw new DigitalEmployeeRunCancellationError('workflow_cancellation_storage_unavailable', 503);
  }
}

async function requiredCreate(
  dataStore: DataStore,
  collection: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!await dataStore.create(collection, data)) {
    throw new DigitalEmployeeRunCancellationError('workflow_cancellation_storage_unavailable', 503);
  }
}

export async function cancelDigitalEmployeeRun(input: {
  tenantId: string;
  userId: string;
  runId: string;
  reason?: string;
  expectedVersion?: string;
  dataStore?: DataStore;
  now?: Date;
  stopScheduledTasks?: (taskIds: string[]) => void;
}): Promise<{ alreadyCancelled: boolean }> {
  const dataStore = input.dataStore ?? store;
  return withDigitalEmployeeRunLock(input.tenantId, input.runId, async () => {
    const run = await dataStore.getById<Row>('workflow_runs', input.runId);
    if (!run || text(run.tenant_id) !== input.tenantId) {
      throw new DigitalEmployeeRunCancellationError('run_not_found', 404);
    }
    if (input.expectedVersion && digitalEmployeeRunVersion(run) !== input.expectedVersion) {
      throw new DigitalEmployeeRunCancellationError('starter_198_version_conflict', 409);
    }
    if (run.status === 'cancelled') return { alreadyCancelled: true };
    if (['succeeded', 'failed', 'completed'].includes(text(run.status))) {
      throw new DigitalEmployeeRunCancellationError('workflow_run_not_cancellable', 409);
    }
    const now = (input.now ?? new Date()).toISOString();
    if (run.status !== 'cancelling') {
      await requiredUpdate(dataStore, 'workflow_runs', run.id, {
        status: 'cancelling',
        current_controller: 'human',
        pause_reason: text(input.reason).slice(0, 500) || '用户通过灵小枢取消',
      });
    }
    const tasks = await dataStore.list<Row>('workflow_tasks', {
      where: { tenant_id: input.tenantId, run_id: run.id }, perPage: 500,
    });
    const approvals = await dataStore.list<Row>('approval_requests', {
      where: { tenant_id: input.tenantId, run_id: run.id, status: 'pending' }, perPage: 500,
    });
    if (tasks.totalItems > tasks.items.length || approvals.totalItems > approvals.items.length) {
      throw new DigitalEmployeeRunCancellationError('workflow_cancellation_projection_incomplete', 503);
    }
    for (const task of tasks.items) {
      if (['succeeded', 'failed', 'cancelled'].includes(text(task.status))) continue;
      await requiredUpdate(dataStore, 'workflow_tasks', task.id, { status: 'cancelled', updated_at: now });
    }
    for (const approval of approvals.items) {
      await requiredUpdate(dataStore, 'approval_requests', approval.id, {
        status: 'superseded', decision_note: '运行已取消，审批失效', decided_at: now,
      });
    }
    // Workflow-owned resources must stop with the run. Preserve the drafts and
    // their lineage for audit, but fence their automation from later workers.
    let disabledSchedules = 0;
    let cancelledDrafts = 0;
    const stoppedTaskIds: string[] = [];
    for (const collection of ['scheduled_tasks', 'studio_projects'] as const) {
      let page = 1;
      let totalPages = 1;
      do {
        const result = await dataStore.list<Row>(collection, {
          where: { tenant_id: input.tenantId }, page, perPage: 500,
        });
        totalPages = result.totalPages;
        for (const record of result.items) {
          if (collection === 'scheduled_tasks') {
            const config = object(record.config);
            if (config?.workflowRunId !== run.id || config?.managedBy !== 'digital_employee' || record.enabled === false) continue;
            await requiredUpdate(dataStore, collection, record.id, { enabled: false });
            disabledSchedules += 1;
            if (text(record.task_id)) stoppedTaskIds.push(text(record.task_id));
          } else {
            const spec = object(record.spec);
            const automation = object(spec.automation);
            if (text(record.workflow_run_id || spec.workflowRunId) !== run.id || automation.managedBy !== 'digital_employee' || automation.status === 'cancelled') continue;
            await requiredUpdate(dataStore, collection, record.id, {
              spec: { ...spec, automation: { ...automation, status: 'cancelled', stage: 'cancelled', cancelledAt: now, cancelledReason: '所属经营运行已取消' } },
              updated_at: now,
            });
            cancelledDrafts += 1;
          }
        }
        page += 1;
      } while (page <= totalPages);
    }
    input.stopScheduledTasks?.(stoppedTaskIds);
    if (text(run.goal_id)) {
      await requiredUpdate(dataStore, 'weekly_goals', text(run.goal_id), { status: 'cancelled', updated_at: now });
    }
    const events = await dataStore.list<Row>('run_events', {
      where: { tenant_id: input.tenantId, run_id: run.id }, sort: '-sequence', perPage: 1,
    });
    const sequence = Number(events.items[0]?.sequence || 0) + 1;
    await requiredCreate(dataStore, 'run_events', {
      tenant_id: input.tenantId,
      run_id: run.id,
      task_id: '',
      sequence,
      type: 'workflow.cancelled',
      level: 'warning',
      summary: '运行已通过灵小枢取消',
      payload: { disabledSchedules, cancelledDrafts },
      occurred_at: now,
    });
    await requiredCreate(dataStore, 'audit_logs', {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorEmail: '',
      action: 'workflow.cancelled',
      targetType: 'workflow_run',
      targetId: run.id,
      metadata: { source: 'starter_198_orchestrator', disabledSchedules, cancelledDrafts },
      createdAt: now,
    });
    await requiredUpdate(dataStore, 'workflow_runs', run.id, {
      status: 'cancelled',
      current_controller: 'human',
      pause_reason: text(input.reason).slice(0, 500) || '用户通过灵小枢取消',
      completed_at: now,
    });
    return { alreadyCancelled: false };
  });
}
