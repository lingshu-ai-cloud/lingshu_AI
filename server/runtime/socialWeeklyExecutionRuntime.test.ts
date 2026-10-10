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
test('missing real media blocks completion without consuming supplier retries', async () => {
  const dataStore = memoryStore();
  const value = task(); value.workflowKind = 'content'; value.schedule.stepKind = 'video_generation'; value.publicationTaskId = 'publication-a';
  await saveTask(dataStore, value);
  await dataStore.create('workflow_runs', { id: 'real-run', tenant_id: value.tenantId, status: 'succeeded' });
  await dataStore.create('starter_social_content_tasks', { tenant_id: value.tenantId, task_id: 'content', run_id: 'real-run', status: 'asset_review', create_idempotency_key: 'weekly-production:package-a:1:publication-a', brief: { programRef: { id: value.programId } } });
  await dataStore.create('starter_social_content_files', { tenant_id: value.tenantId, task_id: 'content', file_id: 'missing-file', usage: 'artifact_media', name: 'video.mp4', mime_type: 'video/mp4', byte_size: 12, content_sha256: 'a'.repeat(64), storage_kind: 'local', storage_key: 'missing-weekly-runtime-fixture/video.mp4' });
  await dataStore.create('starter_social_content_artifacts', { tenant_id: value.tenantId, task_id: 'content', artifact_id: 'artifact', version: '1', artifact_kind: 'short_video', origin: 'agent', status: 'review_required', resource_ref: 'socialfile:missing-file', content: { render: { completed: true }, mediaStorage: { video: { fileId: 'missing-file', sha256: 'a'.repeat(64), url: '/video' } } } });
  await runSocialWeeklyExecutionScan({ dataStore, adapters: { video_generation: { async execute() { return { status: 'succeeded', resultRefs: [{ type: 'starter_social_content_artifact', id: 'artifact', version: 1 }] }; } } } });
  const row = (await dataStore.list<any>(WEEKLY_EXECUTION_TASKS)).items[0].payload;
  assert.equal(row.status, 'blocked', JSON.stringify(row.lastError)); assert.equal(row.attempt, 0); assert.deepEqual(row.resultRefs, []);
  assert.equal(row.lastError.code, 'social_content_file_integrity_violation');
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
test('a continuation awaiting trusted evidence never falls back to a new paid production adapter', async () => {
  const dataStore = memoryStore();
  const value = task();
  value.workflowKind = 'content';
  value.schedule.stepKind = 'asset_generation';
  value.schedule.responsibleActor = 'content_agent';
  value.inputSnapshot.weeklyContinuationPending = { mode: 'completed_verified', sourceTaskId: 'old-task', sourceInputHash: 'unverified', snapshotId: 'snapshot' };
  await saveTask(dataStore, value);
  let starts = 0;
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters: { asset_generation: { async execute() { starts++; throw Error('must not start another production run'); } } } });
  assert.equal(starts, 0);
  assert.equal(result.blocked, 1);
  const rows = await dataStore.list<any>(WEEKLY_EXECUTION_TASKS);
  assert.equal(rows.items[0].payload.status, 'blocked');
  assert.deepEqual(rows.items[0].payload.resultRefs, []);
});
test('missing owned-reference proof blocks completion instead of spending the retry budget', async () => {
  const dataStore = memoryStore();
  const value = task(); value.workflowKind = 'directing'; value.schedule.stepKind = 'director_analysis';
  await saveTask(dataStore, value);
  const policy = { profile: 'b2b_established', ownedPercent: 40, externalPercent: 60, allocationUnit: 'mother_content' };
  const plans = await dataStore.list<any>('social_weekly_agent_planning');
  const plan: any = plans.items[0].payload;
  plan.referenceSourcePolicy = policy; plan.skeleton.slots[0].referenceSource = 'owned';
  plan.userConfirmation.confirmedAt = new Date().toISOString();
  plan.detailedSchedule.items = [{ publicationTaskId: 'pub' }];
  plan.dispatch.scheduleItems = [{ publicationTaskId: 'pub' }];
  plan.directorAnalyses = [{ slotId: 'slot', packageVersion: 1, benchmarkAccountRefs: ['account'], benchmarkVideoRefs: ['video'], benchmarkEvidenceRefs: ['evidence'], contentDirection: '采购问题' }];
  await dataStore.update('social_weekly_agent_planning', plans.items[0].id, { payload: plan });
  const weeks = await dataStore.list<any>('social_weekly_operating_packages');
  await dataStore.update('social_weekly_operating_packages', weeks.items[0].id, { payload: { ...weeks.items[0].payload, programId: value.programId, referenceSourcePolicy: policy, socialContentPackage: { publicationTasks: [{ publicationTaskId: 'pub' }] } } });
  await runSocialWeeklyExecutionScan({ dataStore, adapters: { director_analysis: { async execute() { return { status: 'succeeded', resultRefs: [{ type: 'weekly_agent_planning', id: plan.planningId, version: plan.version }] }; } } } });
  const rows = await dataStore.list<any>(WEEKLY_EXECUTION_TASKS);
  assert.equal(rows.items[0].payload.status, 'blocked');
  assert.ok(rows.items[0].payload.ownBlockingReasons.includes('weekly_owned_reference_diagnosis_unverified'), JSON.stringify(rows.items[0].payload.ownBlockingReasons));
  assert.deepEqual(rows.items[0].payload.resultRefs, []);
  assert.equal(rows.items[0].payload.attempt, 0);
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
  const adapters = { business_outline: { async execute() { attempts++; return { status: 'pending' as const, code: 'provider_result_unknown', message: '先核对已有供应商回执', progress: { contentTaskId: 'real-content', runId: 'real-run', step: '剪辑合成', activity: '等待合成回执', updatedAt: '2026-10-07T00:00:00Z' }, retryDelayMs: 30_000 }; } } };
  const result = await runSocialWeeklyExecutionScan({ dataStore, adapters });
  assert.equal(result.pending, 1); assert.equal(attempts, 1);
  const current = (await dataStore.list<any>(WEEKLY_EXECUTION_TASKS)).items[0].payload;
  assert.equal(current.productionProgress.contentTaskId, 'real-content'); assert.equal(current.productionProgress.step, '剪辑合成'); assert.equal(current.attempt, 1); assert.equal(current.status, 'queued'); assert.equal(current.resultRefs.length, 0);
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

test('partial dispatch admits only explicitly confirmed slots and cannot borrow an injected pending publication', async () => {
  const dataStore = memoryStore(), plan = planning();
  const coverage = { selectedSlotIds: ['slot'], pendingSlotIds: ['pending-slot'], referenceSourcePolicy: null };
  plan.skeleton.slots.push({ ...plan.skeleton.slots[0]!, slotId: 'pending-slot', motherContentId: 'pending-mother', publicationTaskIds: ['pending-pub'] });
  plan.detailedSchedule!.coverage = structuredClone(coverage);
  plan.dispatch!.coverage = structuredClone(coverage);
  plan.userConfirmation!.selectedSlotIds = ['slot'];
  await dataStore.create('social_weekly_operating_packages', { tenant_id: 'tenant-a', program_id: 'program-a', package_id: 'package-a', version: 1, payload: { packageId: 'package-a', version: 1, status: 'draft' } });
  const row = await dataStore.create<Record_>('social_weekly_agent_planning', { tenant_id: 'tenant-a', program_id: 'program-a', package_id: 'package-a', package_version: 1, planning_version: 4, payload: plan });
  assert(row);
  const adapter = createSocialWeeklyPlanningAdapter(dataStore);
  assert.equal((await adapter.execute(task())).status, 'succeeded');
  // A stored item alone does not expand the user's frozen selection.
  plan.dispatch!.scheduleItems = [{ publicationTaskId: 'pending-pub' }] as unknown as NonNullable<WeeklyAgentPlanningState['dispatch']>['scheduleItems'];
  await dataStore.update('social_weekly_agent_planning', row.id, { payload: plan });
  const pending = { ...task(), publicationTaskId: 'pending-pub' };
  const result = await adapter.execute(pending);
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.code, 'weekly_slot_not_dispatched');
  plan.userConfirmation!.selectedSlotIds = ['pending-slot'];
  await dataStore.update('social_weekly_agent_planning', row.id, { payload: plan });
  assert.equal((await adapter.execute(task())).status, 'blocked');
});

test('actual template service input error blocks original task with exact reason without consuming retries', async () => {
  const {fixture}=await import('../socialPrograms/weeklyContentTemplates.fixture.js');
  const f=await fixture();
  try {
    const dataStore=memoryStore(),value=task();value.workflowKind='directing';value.schedule.stepKind='template_extraction';value.schedule.responsibleActor='director_agent';
    await saveTask(dataStore,value);
    let calls=0;
    const result=await runSocialWeeklyExecutionScan({dataStore,adapters:{template_extraction:{async execute(){calls++;await f.service.candidateRead({tenantId:'t',programId:'p'},{type:'weekly_content_template',id:'missing-real-candidate',version:0});throw Error('unreachable');}}}});
    const row=(await dataStore.list<{payload:WeeklyExecutionTask}>(WEEKLY_EXECUTION_TASKS)).items[0]!.payload;
    assert.equal(calls,1);assert.equal(result.blocked,1);assert.equal(result.failed,0);
    assert.equal(row.status,'blocked');assert.equal(row.attempt,0);assert.equal(row.lastError?.code,'content_template_ref_invalid');assert.deepEqual(row.resultRefs,[]);
  }finally{await f.cleanup();}
});

test('unknown provider domain outcome is not misclassified as a permanent template input blocker',async()=>{
 const {SocialProgramError}=await import('../socialPrograms/service.js');const dataStore=memoryStore(),value=task();value.workflowKind='directing';value.schedule.stepKind='template_extraction';value.schedule.responsibleActor='director_agent';await saveTask(dataStore,value);
 const result=await runSocialWeeklyExecutionScan({dataStore,adapters:{template_extraction:{async execute(){throw new SocialProgramError('provider_outcome_unknown',409,'供应商结果未知');}}}});
 const row=(await dataStore.list<{payload:WeeklyExecutionTask}>(WEEKLY_EXECUTION_TASKS)).items[0]!.payload;assert.equal(result.blocked,0);assert.equal(result.failed,1);assert.equal(row.attempt,1);assert.equal(row.lastError?.code,'weekly_execution_adapter_failed');
});
