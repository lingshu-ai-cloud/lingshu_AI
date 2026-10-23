import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as C, type TaskRecord, type ConfigRecord, type EventRecord } from '../routes/digitalEmployeeRecords.js';
import { createTaskInterventionApplication, TaskControlError, type TaskInterventionDependencies } from './taskInterventionApplication.js';

function fixture() {
  const tables = new Map<string, Record_[]>([
    [C.tasks, [
      { id: 'task', tenant_id: 'a', run_id: 'run', goal_id: 'goal', plan_id: 'plan', task_key: 'prepare', title: 'Prepare', status: 'failed', sequence: 1, task_version: 3, output: {}, depends_on: [] },
      { id: 'downstream', tenant_id: 'a', run_id: 'run', goal_id: 'goal', plan_id: 'plan', task_key: 'deliver', title: 'Deliver', status: 'pending', sequence: 2, task_version: 1, depends_on: ['prepare'], output: {} },
      { id: 'other', tenant_id: 'b', run_id: 'other-run', task_key: 'deliver', status: 'pending', sequence: 2, depends_on: ['prepare'] },
    ]],
    [C.runs, [{ id: 'run', tenant_id: 'a', goal_id: 'goal', plan_id: 'plan', status: 'running' }]],
    [C.goals, [{ id: 'goal', tenant_id: 'a', status: 'active', starts_at: '2026-10-19', ends_at: '2026-10-25' }]],
    [C.plans, [{ id: 'plan', tenant_id: 'a', goal_id: 'goal', status: 'approved', plan: {} }]],
  ]);
  const rows = (collection: string) => tables.get(collection) || [];
  const writes: string[] = [];
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const audits: string[] = [];
  const advances: string[] = [];
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows(collection).find(row => row.id === id) || null) as T | null; },
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = rows(collection).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      if (query.sort === '-version') items = [...items].sort((a, b) => Number(b.version) - Number(a.version));
      return { items: structuredClone(items) as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: 500 };
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `created-${writes.length}`, ...structuredClone(data) };
      tables.set(collection, [...rows(collection), row]); writes.push(collection);
      return structuredClone(row) as T;
    },
    async update(collection, id, data) {
      const row = rows(collection).find(row => row.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data)); writes.push(collection); return true;
    },
    async delete() { throw new Error('unexpected_delete'); },
  };
  const deps: TaskInterventionDependencies = {
    store,
    async tenantRecord(collection, id, tenantId) {
      const row = await store.getById(collection, id);
      return row?.tenant_id === tenantId ? row as never : null;
    },
    async first(collection, where) { return (await store.list(collection, { where })).items[0] as never || null; },
    async requiredCreate(collection, data) { return await store.create(collection, data) as never; },
    async configForTenant() { return { id: 'config', tenant_id: 'a', config: {}, status: 'active' } as ConfigRecord; },
    executionConfigForPlan: (_plan, fallback) => fallback,
    async buildBusinessSnapshot() { return {} as never; },
    async getWhatsAppCustomers() { return []; },
    async observeTaskProof() { return { ready: false, proof: { status: 'missing' }, businessRefs: [] }; },
    async advanceRun(tenantId, runId) { advances.push(`${tenantId}:${runId}`); },
    async supersedeAffectedBusinessState() {},
    async appendEvent(event) { events.push(event); return { id: 'event', ...event } as unknown as EventRecord; },
    async appendAudit(event) { audits.push(event.action); },
    async appendAuthorizationRequiredEvent() { throw new Error('unexpected_authorization_invalidation'); },
  };
  return { tables, rows, writes, events, audits, advances, deps, application: createTaskInterventionApplication(deps),
    task: rows(C.tasks)[0]!, run: rows(C.runs)[0]!, plan: rows(C.plans)[0]! };
}

const retry = { tenantId: 'a', userId: 'user', taskId: 'task', expectedTaskVersion: '3', action: 'retry' as const, scope: 'one_off' as const, instruction: 'Retry', rerunDownstream: true };
const rejects = (code: string) => (error: unknown) => error instanceof TaskControlError && error.message === code;

test('retry persists one correction and resets only this run dependency chain', async () => {
  const f = fixture();
  const result = await f.application.applyTaskControl(retry);
  assert.deepEqual(result, { runId: 'run', goalId: 'goal' });
  assert.equal(f.task.status, 'pending');
  assert.equal(f.task.task_version, 4);
  assert.equal(f.rows(C.tasks)[1]!.task_version, 2);
  assert.equal(f.rows(C.tasks)[2]!.task_version, undefined);
  const correction = f.rows(C.corrections)[0]!;
  assert.equal(correction.status, 'applied_once');
  assert.deepEqual(correction.affected_task_ids, ['task', 'downstream']);
  assert.equal((correction.before_state as { tasks: TaskRecord[] }).tasks[0]!.status, 'failed');
  assert.equal(f.events[0]?.type, 'task.retry');
  assert.deepEqual(f.audits, ['workflow_task.retry']);
  assert.deepEqual(f.advances, [], 'caller queues continuation after committing the correction');
});

test('tenant and stale version failures leave every table unchanged', async () => {
  const f = fixture();
  await assert.rejects(f.application.applyTaskControl({ ...retry, tenantId: 'b' }), rejects('task_not_found'));
  await assert.rejects(f.application.applyTaskControl({ ...retry, expectedTaskVersion: '2' }), rejects('task_version_conflict'));
  assert.deepEqual(f.writes, []);
});

test('manual completion cannot bypass approval or missing real publication receipts', async () => {
  const f = fixture();
  f.task.execution_mode = 'approval';
  await assert.rejects(f.application.applyTaskControl({ ...retry, action: 'manual_complete' }), rejects('approval_decision_required'));
  f.task.execution_mode = 'observe'; f.task.task_key = 'platform_publish';
  await assert.rejects(f.application.applyTaskControl({ ...retry, action: 'manual_complete', rerunDownstream: false }), rejects('external_receipt_required'));
  assert.deepEqual(f.writes, []);
});

test('a downstream irreversible receipt prevents retry before any mutation', async () => {
  const f = fixture();
  f.rows(C.tasks)[1]!.output = { providerMessageId: 'real-receipt' };
  await assert.rejects(f.application.applyTaskControl(retry), rejects('irreversible_external_effect'));
  assert.deepEqual(f.writes, []);
});

test('viral analysis remains mandatory until exact coverage is observed', async () => {
  const f = fixture(); f.task.task_key = 'viral_analysis';
  await assert.rejects(f.application.applyTaskControl({ ...retry, action: 'skip' }), rejects('viral_analysis_exact_coverage_required'));
  assert.deepEqual(f.writes, []);
});

test('skip creates a reviewable rule candidate without activating a long-term rule', async () => {
  const f = fixture();
  await f.application.applyTaskControl({ ...retry, action: 'skip', scope: 'rule_candidate', rerunDownstream: false });
  assert.equal(f.task.status, 'skipped');
  assert.equal(f.rows(C.corrections)[0]!.status, 'rule_candidate_pending_review');
  assert.equal((f.rows(C.corrections)[0]!.after_state as Record<string, unknown>).longTermRuleActivated, false);
  assert.equal(f.rows(C.tasks)[1]!.task_version, 1);
});

test('evidence rejects foreign records without altering tasks or approvals', async () => {
  const f = fixture(); f.tables.set('studio_projects', [{ id: 'foreign', tenant_id: 'b' }]);
  await assert.rejects(f.application.attachTaskEvidence({ tenantId: 'a', userId: 'user', taskId: 'task', businessRefs: [{ type: 'studio_project', id: 'foreign' }] }), rejects('evidence_reference_invalid'));
  assert.deepEqual(f.writes, []);
});

test('replan replaces removed nodes with the current workflow graph and keeps the correction auditable', async () => {
  const f = fixture();
  await f.application.applyTaskControl({ ...retry, action: 'replan', enabledWorkflows: ['customer_segmentation'] });
  assert.equal(f.task.status, 'skipped', 'the obsolete task must not remain executable');
  assert.equal(f.rows(C.tasks)[1]!.status, 'skipped');
  const newTasks = f.rows(C.tasks).filter(row => row.id !== 'task' && row.id !== 'downstream' && row.tenant_id === 'a');
  assert.ok(newTasks.length > 0);
  assert.ok(newTasks.every(row => row.run_id === 'run' && row.status === 'pending'));
  const plan = f.plan.plan as { tasks: Array<{ key: string }> };
  assert.ok(plan.tasks.every(task => !['prepare', 'deliver'].includes(task.key)));
  assert.equal(f.rows(C.corrections)[0]!.status, 'applied_once');
  assert.equal(f.rows(C.tasks)[2]!.tenant_id, 'b');
});

test('evidence deduplicates canonical records, supersedes downstream approvals and resumes waiting input', async () => {
  const f = fixture(); f.task.status = 'waiting_human'; f.run.status = 'waiting_human';
  f.task.business_refs = [{ type: 'studio_project', id: 'project' }];
  f.tables.set('studio_projects', [{ id: 'project', tenant_id: 'a' }]);
  f.tables.set(C.approvals, [{ id: 'approval', tenant_id: 'a', run_id: 'run', task_id: 'downstream', status: 'pending' },
    { id: 'foreign-approval', tenant_id: 'b', run_id: 'run', task_id: 'downstream', status: 'pending' }]);
  await f.application.attachTaskEvidence({ tenantId: 'a', userId: 'user', taskId: 'task', businessRefs: [{ type: 'studio_project', id: 'project' }] });
  assert.equal((f.task.business_refs as unknown[]).length, 1);
  assert.equal(f.task.status, 'pending'); assert.equal(f.run.status, 'running');
  assert.equal(f.rows(C.approvals)[0]!.status, 'superseded');
  assert.equal(f.rows(C.approvals)[1]!.status, 'pending');
  assert.deepEqual(f.advances, ['a:run']);
});

test('director continue retains weekly authorization and records its chosen direction', async () => {
  const f = fixture();
  f.plan.plan = { packageApprovedBy: 'user', businessPackage: { tasks: [{ templateId: 'production', videoPlans: [{ contentId: 'content', productName: 'Bottle' }] }] } };
  await f.application.decideDirectorDirection({ tenantId: 'a', userId: 'user', taskId: 'task', contentId: 'content', decision: 'continue', applyToSimilar: false });
  assert.equal((f.plan.plan as Record<string, unknown>).packageApprovedBy, 'user');
  assert.deepEqual(f.audits, ['director_direction.continue']);
  assert.deepEqual(f.advances, ['a:run']);
  assert.equal(f.rows(C.corrections).length, 0);
});

test('failed director adjustment restores the previous plan when no correction was applied', async () => {
  const f = fixture();
  const original = { packageApprovedBy: 'user', businessPackage: { tasks: [{ templateId: 'production', videoPlans: [{ contentId: 'content', productName: 'Bottle' }] }] } };
  f.plan.plan = structuredClone(original);
  await assert.rejects(f.application.decideDirectorDirection({ tenantId: 'a', userId: 'user', taskId: 'task', contentId: 'content', decision: 'adjust', reason: 'weak_product_fit', applyToSimilar: false }), rejects('director_routing_task_missing'));
  assert.deepEqual(f.plan.plan, original);
  assert.equal(f.rows(C.corrections).length, 0);
});
