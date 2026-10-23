import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';
import { createDigitalEmployeeRunCoordinator } from './runCoordinator.js';
import { createGoalActivationApplication } from './goalActivationApplication.js';
import { createWorkflowEvents } from './workflowEvents.js';
import { store } from '../storage/index.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, type EventRecord, type GoalRecord, type StoredRecord } from './records.js';

const unexpected = (..._args: unknown[]): never => { throw new Error('Unexpected work beyond the tested boundary'); };

function coordinator(overrides: Partial<Parameters<typeof createDigitalEmployeeRunCoordinator>[0]> = {}) {
  return createDigitalEmployeeRunCoordinator({
    appendEvent: unexpected, appendAudit: unexpected, tenantRecord: unexpected, configForTenant: unexpected,
    restoreExecutionOnlyInvalidatedAuthorization: unexpected, executionConfigForPlan: unexpected,
    getWhatsAppCustomers: unexpected, dependenciesReady: unexpected, supersedeAffectedBusinessState: unexpected,
    bindWeeklyViralLibraryToPackage: unexpected, buildBusinessSnapshot: unexpected, observeTaskProof: unexpected,
    approvalPreflight: unexpected, first: unexpected, applyPackageGrant: unexpected, createApproval: unexpected,
    prepareObserveBusinessResource: unexpected, prepareContentBatchPlan: unexpected, ensureContentBatchPlan: unexpected,
    executeInTaskBrowser: unexpected, sourceCollectionFailureReason: unexpected, completeReview: unexpected,
    ...overrides,
  });
}

test('run coordinator checks the requested tenant/run before reading context or preparing resources', async () => {
  const reads: string[][] = [];
  const app = coordinator({ tenantRecord: async (collection: string, id: string, tenantId: string) => {
    reads.push([collection, id, tenantId]);
    return null;
  } });
  await app.reconcileDigitalEmployeeRun('tenant-one', 'foreign-run');
  assert.deepEqual(reads, [[COLLECTION.runs, 'foreign-run', 'tenant-one']]);
});

for (const status of ['paused', 'cancelled', 'failed']) {
  test(`${status} runs cannot re-enter preparation, approval or provider work`, async () => {
    const app = coordinator({
      tenantRecord: async <T extends StoredRecord & { tenant_id: string }>(): Promise<T | null> => ({ id: 'run', tenant_id: 'tenant', status }) as unknown as T,
    });
    await app.advanceRun('tenant', 'run');
  });
}

function activation(overrides: Partial<Parameters<typeof createGoalActivationApplication>[0]> = {}) {
  return createGoalActivationApplication({
    requiredCreate: unexpected, goalApprovalQueues: new Map(), tenantRecord: unexpected,
    weeklyGoalFactRebuildTargetCommitted: unexpected, first: unexpected, advanceRun: unexpected,
    buildOverview: unexpected, configForTenant: unexpected, resolveCurrentConfiguration: unexpected,
    weeklyGoalFactRebuildRecovery: unexpected, frozenEnterpriseProfileForPlan: unexpected,
    executionConfigForPlan: unexpected, appendEvent: unexpected, appendAudit: unexpected,
    ...overrides,
  });
}

function rejectAtomicWrites(t: TestContext) {
  assert.ok(store.compareAndSwap, 'the isolated activation fixture requires an atomic store');
  const atomicStore = store as typeof store & { compareAndSwap: NonNullable<typeof store.compareAndSwap> };
  t.mock.method(atomicStore, 'compareAndSwap', unexpected);
}

test('goal activation cannot write a plan or run for an unowned goal', async t => {
  rejectAtomicWrites(t);
  const app = activation({ tenantRecord: async () => null });
  assert.deepEqual(await app.approveGoalForReview('tenant', 'user', 'foreign-goal', 1, []), { status: 404, body: { error: 'goal_not_found' } });
});

test('uncommitted fact rebuild targets cannot activate or re-enter a prior run', async t => {
  rejectAtomicWrites(t);
  const goal = { id: 'goal', tenant_id: 'tenant', metric: 'leads', scope: {} } as GoalRecord;
  const app = activation({
    tenantRecord: async <T extends StoredRecord & { tenant_id: string }>(): Promise<T | null> => goal as unknown as T,
    weeklyGoalFactRebuildTargetCommitted: async () => false,
  });
  const result = await app.approveGoalForReview('tenant', 'user', 'goal', 1, []);
  assert.equal(result.status, 409);
  assert.equal((result.body as { error: string }).error, 'goal_fact_rebuild_not_committed');
});

test('social content lineage records cannot use the operating-goal activation entry', async t => {
  rejectAtomicWrites(t);
  const goal = { id: 'goal', tenant_id: 'tenant', metric: 'approved_social_content_artifacts', scope: { socialTaskId: 'social-task' } } as GoalRecord;
  const app = activation({ tenantRecord: async <T extends StoredRecord & { tenant_id: string }>(): Promise<T | null> => goal as unknown as T });
  const result = await app.approveGoalForReview('tenant', 'user', 'goal', 1, []);
  assert.equal(result.status, 409);
  assert.equal((result.body as { error: string }).error, 'operating_goal_required');
});

test('concurrent event appends persist ordered sequence numbers before broadcasting', async t => {
  const saved: EventRecord[] = [];
  const writes: string[] = [];
  t.mock.method(store, 'list', async () => ({ items: saved.slice(-1), totalItems: saved.length, totalPages: 1, page: 1, perPage: 1 }));
  const requiredCreate: DigitalEmployeeApplicationPorts['requiredCreate'] = async <T extends StoredRecord>(_collection: string, payload: Record<string, unknown>) => {
    await Promise.resolve();
    const record = { id: `event-${saved.length + 1}`, ...payload } as EventRecord;
    saved.push(record);
    writes.push(`persist:${record.sequence}`);
    return record as unknown as T;
  };
  const app = createWorkflowEvents({ requiredCreate, appendAudit: unexpected });
  const client = { write: (value: string) => { if (value.startsWith('id:')) writes.push(`broadcast:${value.trim().slice(4)}`); } };
  app.streamClients.set('run', new Set([client as unknown as import('express').Response]));
  const results = await Promise.all([
    app.appendEvent({ tenantId: 'tenant', runId: 'run', type: 'one', summary: 'one' }),
    app.appendEvent({ tenantId: 'tenant', runId: 'run', type: 'two', summary: 'two' }),
  ]);
  assert.deepEqual(results.map(item => item.sequence), [1, 2]);
  assert.deepEqual(writes, ['persist:1', 'broadcast:1', 'persist:2', 'broadcast:2']);
});

test('a failed append releases its queue so the next persisted event can succeed', async t => {
  t.mock.method(store, 'list', async () => ({ items: [], totalItems: 0, totalPages: 1, page: 1, perPage: 1 }));
  let calls = 0;
  const requiredCreate: DigitalEmployeeApplicationPorts['requiredCreate'] = async <T extends StoredRecord>(_collection: string, payload: Record<string, unknown>) => {
    if (++calls === 1) throw new Error('storage unavailable');
    return { id: 'event', ...payload } as unknown as T;
  };
  const app = createWorkflowEvents({ requiredCreate, appendAudit: unexpected });
  await assert.rejects(app.appendEvent({ tenantId: 'tenant', runId: 'run', type: 'failed', summary: 'failed' }), /storage unavailable/);
  assert.equal((await app.appendEvent({ tenantId: 'tenant', runId: 'run', type: 'next', summary: 'next' })).sequence, 1);
  assert.equal(calls, 2);
});
