import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from './durableLease.js';
import { WEEKLY_EXECUTION_TASKS } from '../socialPrograms/executionTasks.js';
import type { WeeklyAgentPlanningState, WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { createSocialWeeklyPlanningAdapter, runSocialWeeklyExecutionScan, initSocialWeeklyExecutionRuntime } from './socialWeeklyExecutionRuntime.js';
function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  const matches = (row: Record_, where: ListQuery['where']) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION
        && list.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
      if (collection === WEEKLY_EXECUTION_TASKS
        && list.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)) return null;
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...list, row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const next = list.filter(row => row.id !== id);
      rows.set(collection, next);
      return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let list = (rows.get(collection) ?? []).filter(row => matches(row, query.where));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        list = [...list].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      return {
        items: structuredClone(list.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: list.length,
        totalPages: Math.max(1, Math.ceil(list.length / perPage)),
        page,
        perPage,
      };
    },
  };
}

function task(tenantId = 'tenant-a'): WeeklyExecutionTask {
  return { taskId: 'task-a', tenantId, programId: 'program-a', packageId: 'package-a', packageVersion: 1,
    workflowKind: 'readiness', scope: 'package', subjectId: 'package-a', accountId: null, publicationTaskId: null,
    dependsOnTaskIds: [], upstreamVersionRefs: [], inputSnapshot: {}, idempotencyKey: `key-${tenantId}`,
    budget: { category: 'none', limitCny: null }, schedule: { stepKind: 'business_outline', responsibleActor: 'business_agent', estimatedDurationMinutes: 15, estimatedStartAt: '', estimatedFinishAt: '', actualStartedAt: null, actualFinishedAt: null },
    status: 'queued', ownBlockingReasons: [], inheritedBlockingTaskIds: [], attempt: 0, maxAttempts: 3,
    nextAttemptAt: null, lease: null, resultRefs: [], lastError: null, recoveredFromDeadLetterAt: null, cancelReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
async function saveTask(dataStore: DataStore, value: WeeklyExecutionTask) {
  await dataStore.create('social_weekly_operating_packages', { tenant_id: value.tenantId, program_id: value.programId, package_id: value.packageId, version: value.packageVersion, payload: { packageId: value.packageId, version: value.packageVersion, status: 'draft' } });
  await dataStore.create('social_weekly_agent_planning', { tenant_id: value.tenantId, program_id: value.programId, package_id: value.packageId, package_version: value.packageVersion, planning_version: 4, payload: planning() });
  await dataStore.create(WEEKLY_EXECUTION_TASKS, { tenant_id: value.tenantId, task_id: value.taskId, program_id: value.programId, package_id: value.packageId, package_version: value.packageVersion, status: value.status, idempotency_key: value.idempotencyKey, payload: value });
}
function planning(): WeeklyAgentPlanningState {
  return { planningId: 'planning-a', version: 4, programId: 'program-a', packageId: 'package-a', packageVersion: 1, status: 'dispatched',
    skeleton: { skeletonId: 'skeleton', packageId: 'package-a', packageVersion: 1, generatedBy: 'business_agent', tokenCost: 0, slots: [{ slotId: 'slot', motherContentId: 'mother', publicationTaskIds: ['pub'], accountIds: ['account'], platforms: ['tiktok'], plannedPublishWindows: [], objective: 'goal', quantity: 1 }], createdAt: '' },
    directorAnalyses: [], detailedSchedule: { ref: { type: 'detailed_schedule', id: 'schedule', version: 1 }, mergedBy: 'business_agent', items: [], createdAt: '' },
    userConfirmation: { confirmedBy: 'user', confirmedAt: '' }, dispatch: { dispatchId: 'dispatch', packageId: 'package-a', packageVersion: 1, issuedBy: 'business_agent', assignedTo: 'content_agent', detailedScheduleRef: { type: 'detailed_schedule', id: 'schedule', version: 1 }, scheduleItemIds: [], scheduleItems: [], issuedAt: '' }, createdAt: '', updatedAt: '' };
}
test('planning reconciliation requires formal dispatch and matching immutable schedule', async () => {
  const dataStore = memoryStore();
  const adapter = createSocialWeeklyPlanningAdapter(dataStore);
  assert.equal((await adapter.execute(task())).status, 'blocked');
  await dataStore.create('social_weekly_operating_packages', { tenant_id: 'tenant-a', program_id: 'program-a', package_id: 'package-a', version: 1, payload: { packageId: 'package-a', version: 1, status: 'draft' } });
  const plan = planning();
  await dataStore.create('social_weekly_agent_planning', { tenant_id: 'tenant-a', program_id: 'program-a', package_id: 'package-a', package_version: 1, planning_version: 4, payload: plan });
  assert.deepEqual(await adapter.execute(task()), { status: 'succeeded', resultRefs: [{ type: 'weekly_agent_planning', id: 'planning-a', version: 4 }] });
  assert.equal((await adapter.execute(task('tenant-b'))).status, 'blocked');
  const discovery = task(); discovery.schedule.stepKind = 'benchmark_collection';
  assert.equal((await adapter.execute(discovery)).status, 'blocked');
});
test('scan blocks unsupported work while preserving user approval and tenant isolation', async () => {
  const dataStore = memoryStore();
  await saveTask(dataStore, task());
  const user = task('tenant-b'); user.schedule.responsibleActor = 'user'; await saveTask(dataStore, user);
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters: {} });
  assert.equal(result.blocked, 1);
  const rows = await dataStore.list<any>(WEEKLY_EXECUTION_TASKS);
  assert.equal(rows.items.find(row => row.tenant_id === 'tenant-a').payload.status, 'blocked');
  assert.equal(rows.items.find(row => row.tenant_id === 'tenant-b').payload.status, 'queued');
});
test('pending reconciliation does not exhaust retries or immediately reexecute', async () => {
  const dataStore = memoryStore(); await saveTask(dataStore, task());
  let calls = 0;
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters: { business_outline: { async execute() { calls++; return { status: 'pending', code: 'provider_result_unknown', message: '等待对账', retryDelayMs: 30_000 }; } } } });
  assert.equal(result.pending, 1); assert.equal(calls, 1);
  const row = (await dataStore.list<any>(WEEKLY_EXECUTION_TASKS)).items[0];
  assert.equal(row.payload.attempt, 0); assert.equal(row.payload.status, 'queued');
  assert.ok(Date.parse(row.payload.nextAttemptAt) > Date.now());
});
test('expired worker lease is reconciled on restart and never treated as completion', async () => {
  const dataStore = memoryStore(); const value = task();
  value.status = 'leased'; value.attempt = 1;
  value.lease = { leaseId: 'expired', token: 'old', workerId: 'old', acquiredAt: '2020-01-01T00:00:00Z', expiresAt: '2020-01-01T00:01:00Z' };
  await saveTask(dataStore, value);
  let attempts = 0;
  const adapters = { business_outline: { async execute() { attempts++; return { status: 'pending' as const, code: 'provider_result_unknown', message: '先核对已有供应商回执', retryDelayMs: 30_000 }; } } };
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters });
  assert.equal(result.pending, 1); assert.equal(attempts, 1);
  const current = (await dataStore.list<any>(WEEKLY_EXECUTION_TASKS)).items[0].payload;
  assert.equal(current.attempt, 1); assert.equal(current.status, 'queued'); assert.equal(current.resultRefs.length, 0);
});
test('concurrent scans execute a claimed task once while the lease is renewed', async () => {
  const dataStore = memoryStore(); await saveTask(dataStore, task()); let calls = 0;
  const adapters = { business_outline: { async execute() {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 650));
    return { status: 'pending' as const, code: 'production_running', message: '真实运行尚未完成', retryDelayMs: 30_000 };
  } } };
  const first = runSocialWeeklyExecutionScan({ dataStore, adapters, workerId: 'first', leaseDurationMs: 450 });
  await new Promise(resolve => setTimeout(resolve, 520));
  const second = await runSocialWeeklyExecutionScan({ dataStore, adapters, workerId: 'second', leaseDurationMs: 450 });
  const result = await first;
  assert.equal(result.pending, 1); assert.equal(second.claimed, 0); assert.equal(calls, 1);
});
test('adapter execution requires actual formally dispatched planning', async () => {
  const dataStore = memoryStore(); const value = task();
  await dataStore.create(WEEKLY_EXECUTION_TASKS, { tenant_id: value.tenantId, task_id: value.taskId, program_id: value.programId, package_id: value.packageId, package_version: 1, status: 'queued', idempotency_key: value.idempotencyKey, payload: value });
  let called = false;
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters: { business_outline: { async execute() { called = true; return { status: 'succeeded', resultRefs: [] }; } } } });
  assert.equal(called, false); assert.equal(result.blocked, 1);
});

test('retired package blocks production despite a dispatched plan', async () => {
  const dataStore = memoryStore(); await saveTask(dataStore, task());
  const pkg = (await dataStore.list<any>('social_weekly_operating_packages')).items[0];
  await dataStore.update('social_weekly_operating_packages', pkg.id, { payload: { ...pkg.payload, status: 'retired' } });
  let called = false;
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters: { business_outline: { async execute() { called = true; return { status: 'succeeded', resultRefs: [] }; } } } });
  assert.equal(called, false); assert.equal(result.blocked, 1);
});
test('background consumer requires explicit enablement', () => {
  const old = process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED;
  try {
    delete process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED;
    initSocialWeeklyExecutionRuntime({ business_outline: { async execute() { throw new Error('must not run'); } } });
    process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED = 'false';
    initSocialWeeklyExecutionRuntime({});
  } finally {
    if (old === undefined) delete process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED;
    else process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED = old;
  }
});
