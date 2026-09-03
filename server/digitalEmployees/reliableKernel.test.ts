import assert from 'node:assert/strict';
import type { AtomicCompareResult, DataStore, ListQuery, ListResult, Record_, Where } from '../storage/datastore.js';
import {
  WorkerAdmissionController,
  canRetryTask,
  compareAndSetRecord,
  createRecordIfAbsent,
  eventPageForCursor,
  errorInfo,
  evaluateExecutionGates,
  isNextEventSequence,
  liveAiGovernanceAllowsExecution,
  normalizeEventCursor,
  repairRecordSet,
  retryDelayMs,
  runWithHeartbeat,
  taskExecutionTimeoutMs,
  validateApprovalPrecondition,
  validateLiveGovernanceSnapshot,
} from './reliableKernel.js';

class MemoryAtomicStore implements DataStore {
  records = new Map<string, Map<string, Record_>>();
  sequence = 0;

  bucket(collection: string): Map<string, Record_> {
    const existing = this.records.get(collection);
    if (existing) return existing;
    const created = new Map<string, Record_>();
    this.records.set(collection, created);
    return created;
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.bucket(collection).get(id) as T | undefined) || null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const record = { id: String(data.id || `r${++this.sequence}`), ...data } as Record_;
    this.bucket(collection).set(record.id, record);
    return record as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const current = this.bucket(collection).get(id);
    if (!current) return false;
    this.bucket(collection).set(id, { ...current, ...data });
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> { return this.bucket(collection).delete(id); }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const where = query.where || {};
    const items = [...this.bucket(collection).values()].filter(record => Object.entries(where).every(([key, value]) => String(record[key] ?? '') === String(value)));
    return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage || 20 };
  }

  async compareAndSet<T = Record_>(collection: string, id: string, expected: Where, data: Record<string, unknown>): Promise<AtomicCompareResult<T>> {
    const current = this.bucket(collection).get(id);
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (!Object.entries(expected).every(([key, value]) => String(current[key] ?? '') === String(value))) {
      return { ok: false as const, reason: 'conflict' as const, current: current as T };
    }
    const record = { ...current, ...data } as Record_;
    this.bucket(collection).set(id, record);
    return { ok: true as const, record: record as T };
  }

  async createIfAbsent<T = Record_>(collection: string, uniqueWhere: Where, data: Record<string, unknown>) {
    const existing = [...this.bucket(collection).values()].find(record => Object.entries(uniqueWhere).every(([key, value]) => String(record[key] ?? '') === String(value)));
    if (existing) return { created: false, record: existing as T };
    const record = await this.create<T>(collection, data);
    if (!record) throw new Error('create_failed');
    return { created: true, record };
  }
}

const store = new MemoryAtomicStore();
await store.create('workflow_runs', { id: 'run1', status: 'running', lease_owner: '', revision: 0 });
const leaseAttempts = await Promise.all([
  compareAndSetRecord<Record_>({ store, collection: 'workflow_runs', id: 'run1', expected: { status: 'running', lease_owner: '', revision: 0 }, patch: { lease_owner: 'worker-a', revision: 1 } }),
  compareAndSetRecord<Record_>({ store, collection: 'workflow_runs', id: 'run1', expected: { status: 'running', lease_owner: '', revision: 0 }, patch: { lease_owner: 'worker-b', revision: 1 } }),
]);
assert.equal(leaseAttempts.filter(item => item.ok).length, 1, 'only one worker may win the same durable lease');

await store.create('approval_requests', { id: 'approval1', status: 'pending', action_version: 1, payload_hash: 'hash-1', revision: 0 });
const decisions = await Promise.all([
  compareAndSetRecord<Record_>({ store, collection: 'approval_requests', id: 'approval1', expected: { status: 'pending', action_version: 1, payload_hash: 'hash-1', revision: 0 }, patch: { status: 'approved', revision: 1 } }),
  compareAndSetRecord<Record_>({ store, collection: 'approval_requests', id: 'approval1', expected: { status: 'pending', action_version: 1, payload_hash: 'hash-1', revision: 0 }, patch: { status: 'rejected', revision: 1 } }),
]);
assert.equal(decisions.filter(item => item.ok).length, 1, 'concurrent approval submissions must have one winner');

assert.deepEqual(validateApprovalPrecondition({ status: 'pending', actionVersion: 2, payloadHash: 'h2', expectedActionVersion: 2, expectedPayloadHash: 'h2', expiresAt: new Date(Date.now() + 1_000).toISOString() }), { ok: true });
const staleApproval = validateApprovalPrecondition({ status: 'pending', actionVersion: 2, payloadHash: 'h2', expectedActionVersion: 2, expectedPayloadHash: 'changed' });
assert.equal(staleApproval.ok ? '' : staleApproval.code, 'approval_stale');
const expiredApproval = validateApprovalPrecondition({ status: 'pending', actionVersion: 2, payloadHash: 'h2', expectedActionVersion: 2, expectedPayloadHash: 'h2', expiresAt: new Date(Date.now() - 1).toISOString() });
assert.equal(expiredApproval.ok ? '' : expiredApproval.code, 'approval_expired');

const baseSnapshot = {
  config: { team: ['planner'], autonomyMode: 'managed' },
  executionContract: { readiness: 'ready', dataGovernance: { aiAccessEnabled: true }, policy: { autonomyMode: 'managed', budgetLimit: 10 } },
  policy: { autonomyMode: 'managed', budgetLimit: 10, aiAccessEnabled: true },
  plan: { estimatedCost: 6, tasks: [{ key: 'prepare' }, { key: 'execute' }] },
};
const tasks = [
  { id: 't1', task_key: 'prepare', agent_role: 'planner', kind: 'planning', status: 'succeeded', depends_on: [] },
  { id: 't2', task_key: 'execute', agent_role: 'planner', kind: 'analysis', status: 'pending', depends_on: ['prepare'] },
];
assert.equal(evaluateExecutionGates({ run: { status: 'running', budget_limit: 10, budget_spent: 0, execution_snapshot: baseSnapshot }, task: tasks[1], tasks }).allowed, true);
assert.equal(evaluateExecutionGates({ run: { status: 'running', budget_limit: 2, budget_spent: 0, execution_snapshot: baseSnapshot }, task: tasks[1], tasks }).code, 'budget_exceeded');
assert.equal(evaluateExecutionGates({ run: { status: 'running', budget_limit: 10, budget_spent: 0, execution_snapshot: baseSnapshot }, task: tasks[1], tasks: [{ ...tasks[0], status: 'pending' }, tasks[1]] }).code, 'dependency_pending');
assert.equal(evaluateExecutionGates({ run: { status: 'running', budget_limit: 10, budget_spent: 0, execution_snapshot: { ...baseSnapshot, executionContract: { ...baseSnapshot.executionContract, dataGovernance: { aiAccessEnabled: false } } } }, task: tasks[1], tasks }).code, 'ai_data_access_disabled');
let liveGovernanceReads = 0;
assert.equal(await liveAiGovernanceAllowsExecution(async () => { liveGovernanceReads += 1; return { aiAccessEnabled: false }; }), false);
assert.equal(liveGovernanceReads, 1, 'the worker must consult live governance instead of trusting only its snapshot');
assert.deepEqual(validateLiveGovernanceSnapshot(
  { aiAccessEnabled: true, sourceVersion: 'enterprise-v1' },
  { aiAccessEnabled: true, sourceVersion: 'enterprise-v1' },
), { ok: true });
assert.deepEqual(validateLiveGovernanceSnapshot(
  { aiAccessEnabled: true, sourceVersion: 'enterprise-v1' },
  { aiAccessEnabled: true, sourceVersion: 'enterprise-v2' },
), { ok: false, code: 'execution_contract_source_changed' }, 'changed enterprise facts must invalidate the confirmed contract before another lease');
assert.deepEqual(validateLiveGovernanceSnapshot(
  { aiAccessEnabled: true, sourceVersion: 'enterprise-v1' },
  { aiAccessEnabled: false, sourceVersion: 'enterprise-v1' },
), { ok: false, code: 'ai_data_access_disabled' }, 'live revocation must override the durable snapshot immediately');

assert.equal(normalizeEventCursor('not-a-number'), 0);
assert.equal(eventPageForCursor(0), 1);
assert.equal(eventPageForCursor(499), 1);
assert.equal(eventPageForCursor(500), 2, 'durable polling must advance beyond the first event page');
assert.equal(isNextEventSequence(500, 501), true);
assert.equal(isNextEventSequence(500, 502), false, 'local broadcasts must not jump over durable events');
assert.deepEqual(errorInfo(new Error('execution_contract_source_changed')), {
  code: 'execution_contract_source_changed',
  detail: 'execution_contract_source_changed',
  retryable: false,
});

assert.equal(retryDelayMs(1, 100, 10_000), 100);
assert.equal(retryDelayMs(4, 100, 10_000), 800);
assert.equal(canRetryTask(2, 3, true), true);
assert.equal(canRetryTask(3, 3, true), false);
assert.equal(canRetryTask(1, 3, false), false);
assert.equal(taskExecutionTimeoutMs('analysis', 120_000, 900_000), 120_000);
assert.equal(taskExecutionTimeoutMs('content_execution_pack', 120_000, 1_000), 600_000, 'rendering must never inherit the short generic timeout');

await assert.rejects(
  runWithHeartbeat({
    heartbeatMs: 5,
    timeoutMs: 2_000,
    heartbeat: async () => false,
    work: async () => new Promise<never>(() => undefined),
  }),
  (error: unknown) => (error as { code?: string }).code === 'task_lease_lost',
);
await assert.rejects(
  runWithHeartbeat({ heartbeatMs: 1_000, timeoutMs: 20, heartbeat: async () => true, work: async () => new Promise<never>(() => undefined) }),
  (error: unknown) => (error as { code?: string }).code === 'task_timeout',
);

const repairStore = new MemoryAtomicStore();
let interrupted = true;
const ensure = async (key: string) => {
  if (key === 'task-b' && interrupted) { interrupted = false; throw new Error('simulated_start_interruption'); }
  await createRecordIfAbsent({ store: repairStore, collection: 'workflow_tasks', uniqueWhere: { run_id: 'run-repair', task_key: key }, data: { run_id: 'run-repair', task_key: key } });
};
await assert.rejects(repairRecordSet(['task-a', 'task-b', 'task-c'], ensure), /simulated_start_interruption/);
await repairRecordSet(['task-a', 'task-b', 'task-c'], ensure);
const repaired = await repairStore.list('workflow_tasks', { where: { run_id: 'run-repair' } });
assert.equal(repaired.totalItems, 3, 'replaying startup repair must fill missing tasks without duplicates');

const admission = new WorkerAdmissionController();
assert.equal(admission.accepting(), true);
admission.stop();
assert.equal(admission.accepting(), false, 'graceful shutdown must stop admission of new leases');
admission.start();
assert.equal(admission.accepting(), true);

console.log('reliable digital employee kernel tests passed');
