import { store } from '../storage/index.js';
import { type ActiveWorkflowHandoff } from './workflowHandoffPolicy.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, type HandoffRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createWorkflowRepository(deps: Pick<DigitalEmployeeApplicationPorts, never>) {

  async function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    const result = await store.list<T>(collection, { where, sort, page: 1, perPage: 1 });
    return result.items[0] ?? null;
  }

  function handoffPolicyIdentity(handoff: HandoffRecord): ActiveWorkflowHandoff {
    return {
      id: handoff.id,
      taskId: handoff.task_id,
      takenBy: handoff.taken_by,
      startedAt: handoff.started_at,
    };
  }

  async function activeWorkflowHandoffsForRun(tenantId: string, runId: string): Promise<HandoffRecord[]> {
    const items: HandoffRecord[] = [];
    let page = 1;
    while (true) {
      const result = await store.list<HandoffRecord>(COLLECTION.handoffs, {
        where: { tenant_id: tenantId, run_id: runId, status: 'active' },
        sort: 'started_at',
        page,
        perPage: 500,
      });
      items.push(...result.items);
      if (page >= result.totalPages) return items;
      page += 1;
    }
  }

  async function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    const record = await store.getById<T>(collection, id);
    return record?.tenant_id === tenantId ? record : null;
  }

  async function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    const record = await store.create<T>(collection, payload);
    if (!record) throw new Error(`${collection}_storage_unavailable`);
    return record;
  }

  async function appendAudit(input: {
    tenantId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await store.create('audit_logs', {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorEmail: '',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata || {},
      createdAt: new Date().toISOString(),
    });
  }

  async function listAllRecords<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    while (true) {
      const result = await store.list<T>(collection, { where, ...(sort ? { sort } : {}), page, perPage: 500 });
      items.push(...result.items);
      if (page >= result.totalPages) return items;
      page += 1;
    }
  }

  return { first, handoffPolicyIdentity, activeWorkflowHandoffsForRun, tenantRecord, requiredCreate, appendAudit, listAllRecords };
}
