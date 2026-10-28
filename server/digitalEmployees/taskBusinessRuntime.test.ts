import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as C, type EventRecord, type GoalRecord, type PlanRecord, type RunRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import { normalizeDigitalEmployeeConfig } from './domain.js';
import { contentProjectLineageFields } from './contentProjectLineage.js';
import type { BusinessSnapshot } from './businessSnapshot.js';
import { createTaskBusinessObservation, type TaskBusinessObservationDependencies } from './taskBusinessObservation.js';
import { createTaskBusinessPreparation, type TaskBusinessPreparationDependencies } from './taskBusinessPreparation.js';

function fixture(key: string) {
  const tables = new Map<string, Record_[]>();
  const writes: string[] = [], clicks: string[] = [];
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const task = { id: 'task', tenant_id: 'a', run_id: 'run', goal_id: 'goal', plan_id: 'plan', task_key: key, status: 'pending', depends_on: [], output: {}, business_refs: [] } as unknown as TaskRecord;
  const run = { id: 'run', tenant_id: 'a', goal_id: 'goal', plan_id: 'plan', started_at: '2026-10-19T01:00:00Z' } as RunRecord;
  const goal = { id: 'goal', tenant_id: 'a', owner_id: 'actor', starts_at: '2026-10-19', ends_at: '2026-10-25', scope: 'Market', objective: 'Product demand' } as GoalRecord;
  const snapshot = { content: { exactAnalyses: { value: 99 }, completedWorks: { value: 99 }, contentProjects: { value: 99 }, scheduledPosts: { value: 99 }, publishedPosts: { value: 99 } }, customer: { total: { value: 0 }, attributed: { value: 99 }, segmentSnapshots: { value: 99, status: 'available' }, followupDrafts: { value: 99, status: 'available' }, outreachSent: { value: 99, status: 'available' } } } as unknown as BusinessSnapshot;
  const config = normalizeDigitalEmployeeConfig({ focusProducts: 'Product', socialCadence: 'YouTube；每天 09:00；每次最多 20 条' });
  tables.set(C.tasks, [task]); tables.set(C.plans, [{ id: 'plan', tenant_id: 'a', plan: {} }]);
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(tables.get(collection)?.find(row => row.id === id) || null) as T | null; },
    async list<T>(collection: string, query: ListQuery = {}) {
      const rows = (tables.get(collection) || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      return { items: structuredClone(rows) as T[], totalItems: rows.length, totalPages: 1, page: 1, perPage: 500 };
    },
    async update(collection, id, data) {
      const row = tables.get(collection)?.find(row => row.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data)); writes.push(collection); return true;
    },
    async create() { throw Error('unexpected_create'); }, async delete() { throw Error('unexpected_delete'); },
  };
  const tenantRecord: TaskBusinessObservationDependencies['tenantRecord'] = async (collection, id, tenantId) => {
    const row = await store.getById(collection, id); return row?.tenant_id === tenantId ? row as never : null;
  };
  const observation: TaskBusinessObservationDependencies = {
    store, tenantRecord, async getWhatsAppCustomers() { return []; }, async getFollowupBatchItems() { return []; },
    async recoverStaleFollowupSending() { throw Error('unexpected_recovery'); }, async preflightFollowupBatchDispatch() { throw Error('unexpected_preflight'); },
  };
  const preparation: TaskBusinessPreparationDependencies = {
    store, tenantRecord,
    async first(collection, where) { return (await store.list(collection, { where })).items[0] as never || null; },
    currentExecutionAdapters: () => undefined, browserExecutionEnabled: () => false,
    collectionLimitForInventoryGap: (_task, fallback) => fallback,
    async executeInTaskBrowser(_input, label, action) { clicks.push(label); return action(); },
    async ensureFrozenEnterpriseProfileForRun() { throw Error('unexpected_facts_read'); },
    async ensureDigitalEmployeeSocialCollectionTask() { throw Error('unexpected_scheduler'); },
    scheduledExecutionState: () => 'idle',
    async runScheduledTaskNow() { throw Error('unexpected_collection_run'); },
    async advanceAutomatedContentProduction() { throw Error('unexpected_production'); },
    async createCustomerSegmentSnapshot() { throw Error('unexpected_segmentation'); },
    async createFollowupBatch() { throw Error('unexpected_followup'); },
    async getTenantFollowupDispatchStatus() { throw Error('unexpected_worker_read'); },
    async appendEvent(event) { events.push(event); return { id: 'event' } as EventRecord; }, async appendAudit() {},
  };
  const input = { tenantId: 'a', goal, run, task, config, snapshot };
  return { tables, store, task, run, goal, snapshot, input, writes, clicks, events,
    observe: (overrides: Partial<TaskBusinessObservationDependencies> = {}) => createTaskBusinessObservation({ ...observation, ...overrides }).observeTaskProof('a', run, task, snapshot, [task]),
    prepare: (overrides: Partial<TaskBusinessPreparationDependencies> = {}) => createTaskBusinessPreparation({ ...preparation, ...overrides }).prepareObserveBusinessResource(input) };
}

test('tenant totals cannot complete a collection belonging to another workflow task', async () => {
  const f = fixture('scheduled_source_collection');
  f.tables.set('scheduled_tasks', [{ id: 'foreign-task', tenant_id: 'a', task_type: 'social_discovery_collection', config: { workflowRefs: JSON.stringify([{ workflowTaskId: 'other-task' }]) } }]);
  const result = await f.observe();
  assert.equal(result.ready, false); assert.deepEqual(result.businessRefs, []); assert.equal(result.proof.value, 0);
});

test('managed content needs current run lineage and real render proof', async () => {
  const f = fixture('content_production');
  const automation = { managedBy: 'digital_employee', stage: 'completed', quality: { passed: true } };
  const spec = { workflowRunId: 'run', workflowTaskId: 'task', workflowTaskKey: 'content_production', automation };
  const project = { id: 'project', tenant_id: 'a', status: 'ready_for_approval', spec, ...contentProjectLineageFields({ tenantId: 'a', spec }) };
  const otherSpec = { ...spec, workflowRunId: 'other-run', automation: { ...automation, renderOutputPath: '/other/render.mp4' } };
  const foreign = { id: 'other', tenant_id: 'a', status: 'ready_for_approval', spec: otherSpec, ...contentProjectLineageFields({ tenantId: 'a', spec: otherSpec }) };
  f.tables.set('studio_projects', [project, foreign]);
  assert.equal((await f.observe()).ready, false);
  Object.assign(automation, { renderOutputPath: '/isolated/render.mp4' });
  const result = await f.observe();
  assert.equal(result.ready, true); assert.equal(result.proof.value, 1);
  assert.deepEqual(result.businessRefs.map(ref => ref.id), ['project']);
});

test('publication completion requires every scoped account receipt', async () => {
  const f = fixture('platform_publish');
  const post = { id: 'post', tenant_id: 'a', metadata: { workflowRunId: 'run', workflowTaskId: 'task' }, stats: { targetAccountIds: ['one', 'two'], publishResults: { one: { status: 'published', platformPostId: 'receipt' } } } };
  f.tables.set('posts', [post]); assert.equal((await f.observe()).ready, false);
  Object.assign(post.stats.publishResults, { two: { status: 'published', platformPostId: 'receipt-2' } });
  assert.equal((await f.observe()).ready, true);
});

test('customer attribution only uses posts scoped to the current run', async () => {
  const f = fixture('customer_attribution');
  f.tables.set('posts', [{ id: 'post', tenant_id: 'a', metadata: { workflowRunId: 'run', workflowTaskId: 'task' } }]);
  const result = await f.observe({ async getWhatsAppCustomers() { return [{ id: 'current', sourcePostId: 'post' }, { id: 'other', sourcePostId: 'other-post' }] as never; } });
  assert.equal(result.proof.value, 1); assert.deepEqual(result.businessRefs.map(ref => ref.id), ['current']);
});

test('customer segments cannot borrow another task or tenant snapshot', async () => {
  const f = fixture('customer_segmentation');
  f.tables.set(C.segments, [{ id: 'wrong-task', tenant_id: 'a', run_id: 'run', task_id: 'other', status: 'generated' }, { id: 'foreign', tenant_id: 'b', run_id: 'run', task_id: 'task', status: 'generated' }]);
  assert.equal((await f.observe()).ready, false);
  f.tables.get(C.segments)!.push({ id: 'current', tenant_id: 'a', run_id: 'run', task_id: 'task', status: 'generated' });
  const result = await f.observe(); assert.equal(result.ready, true); assert.equal(result.proof.value, 1);
});

test('follow-up observation recovers only the latest active batch and reports its durable receipts', async () => {
  const f = fixture('followup_dispatch'); const recovered: string[] = [], read: string[] = [];
  f.tables.set(C.followupBatches, [{ id: 'old', tenant_id: 'a', run_id: 'run', status: 'active', version: 1 }, { id: 'current', tenant_id: 'a', run_id: 'run', status: 'active', version: 2 }, { id: 'superseded', tenant_id: 'a', run_id: 'run', status: 'superseded', version: 3 }]);
  const result = await f.observe({
    async recoverStaleFollowupSending(batch) { recovered.push(batch.id); return undefined as never; },
    async getFollowupBatchItems(_tenantId, id) { read.push(id); return [{ id: 'item', status: 'sent', provider_message_id: 'receipt' }] as never; },
    async preflightFollowupBatchDispatch() { return null as never; },
  });
  assert.deepEqual(recovered, ['current']); assert.deepEqual(read, ['current']);
  assert.equal(result.proof.value, 1); assert.equal(result.businessRefs[0]!.type, 'followup_receipt');
});

test('scoped simulation adapters retain precedence and cannot fall through to providers', async () => {
  const f = fixture('content_production');
  assert.equal(await f.prepare({ currentExecutionAdapters: () => ({ prepare: async input => { assert.equal(input.task.id, 'task'); return false; } }) }), false);
  assert.deepEqual(f.clicks, []); assert.deepEqual(f.writes, []);
});

test('unapproved browser collection stops before a click or execution', async () => {
  const f = fixture('scheduled_source_collection');
  assert.equal(await f.prepare({ browserExecutionEnabled: () => true, async ensureDigitalEmployeeSocialCollectionTask() { return null; } }), false);
  assert.deepEqual(f.clicks, []); assert.match(f.task.blocked_reason, /待编导确认/);
});

test('library-only weekly plans cannot create or run a collector, including through adapters', async () => {
  const f = fixture('scheduled_source_collection');
  f.tables.set(C.plans, [{ id: 'plan', tenant_id: 'a', plan: { businessPackage: { referenceSourcePolicy: 'existing_library_only' } } }]);
  let calls = 0;
  assert.equal(await f.prepare({ currentExecutionAdapters: () => ({ prepare: async () => { calls++; return true; } }), browserExecutionEnabled: () => true,
    async ensureDigitalEmployeeSocialCollectionTask() { calls++; throw Error('must_not_collect'); }, async runScheduledTaskNow() { calls++; throw Error('must_not_run'); } }), false);
  assert.equal(calls, 0); assert.deepEqual(f.clicks, []); assert.match(f.task.blocked_reason, /现有爆款库/);
});

const schedule = { id: 'schedule', taskType: 'social_discovery_collection', enabled: true, cronExpr: '0 9 * * *', cronLabel: 'Daily', lastRun: '' };

test('browser collection persists its boundary before the click and executes only inside it', async () => {
  const f = fixture('scheduled_source_collection'); const order: string[] = []; let clicked = false;
  assert.equal(await f.prepare({
    browserExecutionEnabled: () => true,
    async ensureDigitalEmployeeSocialCollectionTask(input) { const boundary = input.confirmedWeeklyBoundary; assert.ok(boundary); assert.equal(boundary.workflowTaskId, 'task'); order.push('ensure'); return { task: schedule, created: true, updated: false } as never; },
    async executeInTaskBrowser(_input, _label, action) { assert.deepEqual(f.task.business_refs, [{ type: 'scheduled_task', id: 'schedule', taskType: 'social_discovery_collection', cronExpr: '0 9 * * *' }]); clicked = true; order.push('click'); return action(); },
    async runScheduledTaskNow(input) { assert.equal(clicked, true); assert.deepEqual(input, { tenantId: 'a', taskId: 'schedule' }); order.push('run'); return { state: 'collected', result: 'isolated receipt', lastRun: '2026-10-23T03:00:00Z' } as never; },
  }), true);
  assert.deepEqual(order, ['ensure', 'click', 'ensure', 'run']);
  assert.equal(f.events.some(event => event.type === 'business.resource.first_run'), true);
});

test('a previously executed collection does not submit again without an explicit retry', async () => {
  const f = fixture('scheduled_source_collection');
  assert.equal(await f.prepare({ async ensureDigitalEmployeeSocialCollectionTask() { return { task: { ...schedule, lastRun: '2026-10-23T03:00:00Z' }, created: false, updated: false } as never; }, scheduledExecutionState: () => 'running' }), true);
  assert.equal(f.events.some(event => event.type === 'business.resource.first_run'), false);
});

test('failed collection records failure and propagates the error without a second attempt', async () => {
  const f = fixture('scheduled_source_collection'); let calls = 0;
  await assert.rejects(f.prepare({ async ensureDigitalEmployeeSocialCollectionTask() { return { task: schedule, created: true, updated: false } as never; }, async runScheduledTaskNow() { calls++; return { state: 'failed', result: 'isolated failure' } as never; } }), /scheduled_source_collection_failed/);
  assert.equal(calls, 1); assert.equal(f.events.at(-1)!.type, 'business.resource.first_run_failed');
});

test('content preparation forwards frozen facts and batch orders, retaining knowledge gaps', async () => {
  const f = fixture('content_production'); const profile = { marker: 'frozen-facts' };
  f.tables.set(C.contentBatchPlans, [{ id: 'batch', tenant_id: 'a', run_id: 'run', orders: [{ id: 'order' }] }]);
  assert.equal(await f.prepare({
    async ensureFrozenEnterpriseProfileForRun(tenantId, plan, config, boundAt) { assert.equal(tenantId, 'a'); assert.equal(plan!.id, 'plan'); assert.equal(config, f.input.config); assert.equal(boundAt, f.run.started_at); return profile as never; },
    async advanceAutomatedContentProduction(input) { assert.equal(input.enterpriseProfile, profile); assert.equal(input.batchPlanId, 'batch'); assert.deepEqual(input.contentOrders, [{ id: 'order' }]); return { projectRefs: [{ type: 'studio_project', id: 'project' }], knowledgeGaps: [{ type: 'knowledge_gap', id: 'gap' }], changed: false, ready: false, summary: 'Waiting', blocker: 'Missing evidence' } as never; },
  }), true);
  assert.equal((f.task.business_refs as unknown[]).length, 2);
  assert.equal(f.events[0]!.type, 'content.production.progressed');
  assert.equal(f.events[0]!.payload!.externalPublishPerformed, false);
});

test('draft preparation needs a current segment, freezes facts and never dispatches messages', async () => {
  const f = fixture('followup_batch_draft');
  assert.equal(await f.prepare(), false);
  f.tables.set(C.segments, [{ id: 'segment', tenant_id: 'a', run_id: 'run', status: 'generated' }]);
  const profile = { marker: 'frozen' };
  assert.equal(await f.prepare({
    async ensureFrozenEnterpriseProfileForRun() { return profile as never; },
    async createFollowupBatch(input) { assert.equal(input.enterpriseProfile, profile); assert.equal(input.segmentId, 'segment'); assert.equal(input.idempotent, true); return { created: true, batch: { id: 'batch', version: 1, content_hash: 'hash' }, items: [{ id: 'item' }] } as never; },
    async getTenantFollowupDispatchStatus() { return { authorization: { scheduledFollowupSendAllowed: false } } as never; },
  }), true);
  assert.equal(f.events[0]!.payload!.messagesSent, 0); assert.equal(f.events[0]!.payload!.bulkWorkerStatus, 'manual_only');
});

test('empty customer inventory cannot create a customer segment', async () => {
  const f = fixture('customer_segmentation'); assert.equal(await f.prepare(), false); assert.deepEqual(f.writes, []);
});
