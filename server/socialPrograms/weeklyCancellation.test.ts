import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, Record_, ListQuery } from '../storage/datastore.js';
import { reconcileWeeklyCancellation, WEEKLY_CANCELLATIONS } from './weeklyCancellation.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
type Row = Record_ & Record<string, any>;
function memoryStore() {
  const rows = new Map<string, Row[]>();
  const failures: string[] = [];
  let writes = 0;
  const dataStore: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
    async list<T>(collection: string, query: ListQuery = {}) { const filtered = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)); const page = query.page ?? 1, perPage = query.perPage ?? 500; return { items: structuredClone(filtered.slice((page - 1) * perPage, page * perPage)) as T[], totalItems: filtered.length, totalPages: Math.ceil(filtered.length / perPage), page, perPage }; },
    async create<T>(collection: string, data: Record<string, unknown>) { if (failures[0] === `create:${collection}`) { failures.shift(); return null; } const row = { id: `${collection}-${++writes}`, ...structuredClone(data) }; rows.set(collection, [...(rows.get(collection) ?? []), row]); return structuredClone(row) as T; },
    async update(collection: string, id: string, patch: Record<string, unknown>) { if (failures[0] === `update:${collection}:${patch.status ?? ''}`) { failures.shift(); return false; } const row = rows.get(collection)?.find(item => item.id === id); if (!row) return false; Object.assign(row, structuredClone(patch)); return true; },
    async delete(collection: string, id: string) { const list = rows.get(collection) ?? []; const next = list.filter(row => row.id !== id); rows.set(collection, next); return next.length !== list.length; },
  };
  rows.set('starter_social_content_tasks', [{ id: 'binding', tenant_id: 'tenant', task_id: 'content', weekly_plan_id: 'package', create_idempotency_key: 'weekly-production:package:1:pub', run_id: 'run', status: 'generating' }]);
  rows.set('workflow_runs', [{ id: 'run', tenant_id: 'tenant', status: 'running', goal_id: 'goal' }]);
  rows.set('weekly_goals', [{ id: 'goal', tenant_id: 'tenant', status: 'active' }]);
  rows.set('workflow_tasks', [{ id: 'run-task', tenant_id: 'tenant', run_id: 'run', status: 'running' }, { id: 'prior-success', tenant_id: 'tenant', run_id: 'run', status: 'succeeded', result: { receipt: 'already-paid' } }]);
  rows.set('content_execution_jobs', [{ id: 'job', tenant_id: 'tenant', job_key: 'job-key', task_id: 'content', run_id: 'run', user_id: 'user', account_id: 'account', task_type: 'social-content', status: 'running', provider_receipts: [{ provider: 'isolated', requestId: 'request', state: 'unknown', providerTaskId: 'paid-job', metadata: {}, firstRecordedAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }] }]);
  rows.set('social_publication_assignments', [{ id: 'assignment', tenant_id: 'tenant', operating_package_id: 'package', operating_package_version: 1, assignment_id: 'assignment-id', status: 'package_ready' }]);
  rows.set('social_publication_attempts', [{ id: 'unknown-publication', tenant_id: 'tenant', assignment_id: 'assignment-id', status: 'unknown', provider_receipt_id: 'accepted-receipt' }, { id: 'published-publication', tenant_id: 'tenant', assignment_id: 'assignment-id', status: 'published', provider_receipt_id: 'real-receipt', platform_post_id: 'real-post' }]);
  return { rows, failures, dataStore };
}
test('weekly compensation resumes every durable boundary without hiding irreversible or unknown effects', async () => {
  for (const fault of ['update:content_execution_jobs:cancelled', 'update:workflow_tasks:cancelled', 'create:run_events', 'create:audit_logs', 'update:workflow_runs:cancelled', 'update:starter_social_content_tasks:paused', 'update:social_publication_assignments:revoked', `update:${WEEKLY_CANCELLATIONS}:completed_with_external_effects`]) {
    const { rows, failures, dataStore } = memoryStore();
    failures.push(fault);
    let taskCancellations = 0;
    const input = { dataStore, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, reason: 'user-retired', now: '2026-10-07T00:00:00Z', cancelPending: async () => { taskCancellations++; } };
    await assert.rejects(reconcileWeeklyCancellation(input), /部分后续工作/);
    assert.equal(rows.get(WEEKLY_CANCELLATIONS)![0]!.status, 'partial_failure', fault);
    const completed = await reconcileWeeklyCancellation(input);
    assert.equal(completed.status, 'completed_with_external_effects', fault);
    assert.equal(taskCancellations, 1);
    assert.equal(rows.get('workflow_runs')![0]!.status, 'cancelled');
    assert.equal(rows.get('workflow_tasks')![1]!.status, 'succeeded');
    assert.equal(rows.get('content_execution_jobs')![0]!.status, 'cancelled');
    assert.equal(rows.get('content_execution_jobs')![0]!.provider_receipts[0].providerTaskId, 'paid-job');
    assert.equal(rows.get('social_publication_attempts')![0]!.status, 'unknown');
    assert.equal(rows.get('social_publication_attempts')![1]!.status, 'published');
    assert.equal(rows.get('social_publication_assignments')![0]!.receipt_recovery_required, true);
    assert.ok(completed.effects.some(effect => effect.resourceId === 'unknown-publication' && effect.outcome === 'unknown_requires_reconciliation'));
    assert.ok(completed.effects.some(effect => effect.resourceId === 'published-publication' && effect.outcome === 'irreversible'));
    assert.equal(rows.get('run_events')!.filter(row => row.type === 'workflow.cancelled').length, 1);
    assert.equal(rows.get('audit_logs')!.filter(row => row.action === 'workflow.cancelled').length, 1);
    assert.deepEqual(await reconcileWeeklyCancellation(input), completed);
  }
});
test('weekly compensation does not touch cross-tenant or other-version bindings and assignments', async () => {
  const { rows, dataStore } = memoryStore();
  rows.get('starter_social_content_tasks')!.push({ id: 'other-binding', tenant_id: 'victim', weekly_plan_id: 'package', create_idempotency_key: 'weekly-production:package:1:pub', status: 'generating' }, { id: 'other-version', tenant_id: 'tenant', weekly_plan_id: 'package', create_idempotency_key: 'weekly-production:package:2:pub', status: 'generating' });
  await reconcileWeeklyCancellation({ dataStore, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, reason: 'cancel', now: '2026-10-07T00:00:00Z', cancelPending: async () => {} });
  assert.equal(rows.get('starter_social_content_tasks')![1]!.status, 'generating');
  assert.equal(rows.get('starter_social_content_tasks')![2]!.status, 'generating');
});

test('weekly compensation follows creative repair child mapping and preserves unknown provider evidence', async () => {
  const { rows, dataStore } = memoryStore();
  rows.set('social_weekly_production_repair_cases', [{ id: 'case-row', tenant_id: 'tenant', package_id: 'package', package_version: 1, case_id: 'creative-case', payload: { kind: 'creative_revision', requestHash: 'case-request-hash' } }]);
  const mappingBody = { schemaVersion: 'weekly-creative-repair-child-execution.v1', version: 1, tenantId: 'tenant', caseId: 'creative-case', caseRequestHash: 'case-request-hash', childTaskId: 'creative-child', runId: 'creative-run', jobId: 'creative-job' }, mapping = { ...mappingBody, recordHash: socialRequestHash(mappingBody) };
  rows.set('social_weekly_creative_repair_child_executions', [{ id: 'mapping', tenant_id: 'tenant', case_id: 'creative-case', content_hash: socialRequestHash(mapping), payload: mapping }]);
  rows.get('starter_social_content_tasks')!.push({ id: 'creative-binding', tenant_id: 'tenant', task_id: 'creative-child', run_id: 'creative-run', weekly_plan_id: null, create_idempotency_key: 'weekly-creative-repair:creative-case:configuration-hash', status: 'generating' });
  rows.get('workflow_runs')!.push({ id: 'creative-run', tenant_id: 'tenant', status: 'running', goal_id: 'creative-goal' });
  rows.get('weekly_goals')!.push({ id: 'creative-goal', tenant_id: 'tenant', status: 'active' });
  rows.get('workflow_tasks')!.push({ id: 'creative-run-task', tenant_id: 'tenant', run_id: 'creative-run', status: 'running' });
  rows.get('content_execution_jobs')!.push({ id: 'creative-job', tenant_id: 'tenant', job_key: 'creative-key', task_id: 'creative-child', run_id: 'creative-run', user_id: 'owner', account_id: 'account', task_type: 'social-content', status: 'running', provider_receipts: [{ provider: 'actual', requestId: 'creative-request', state: 'accepted', providerTaskId: 'paid-creative-task', metadata: {}, firstRecordedAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }] });
  const completed = await reconcileWeeklyCancellation({ dataStore, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, reason: 'cancel', now: '2026-10-07T00:00:00Z', cancelPending: async () => {} });
  assert.equal(rows.get('content_execution_jobs')!.find(row => row.id === 'creative-job')!.status, 'cancelled');
  assert.equal(rows.get('workflow_runs')!.find(row => row.id === 'creative-run')!.status, 'cancelled');
  assert.equal(rows.get('starter_social_content_tasks')!.find(row => row.id === 'creative-binding')!.status, 'paused');
  assert.ok(completed.effects.some(effect => effect.resourceId === 'creative-job' && effect.outcome === 'unknown_requires_reconciliation' && effect.receiptRefs.includes('paid-creative-task')));
  assert.equal((await reconcileWeeklyCancellation({ dataStore, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, reason: 'cancel', now: '2026-10-07T00:00:00Z', cancelPending: async () => {} })).effects.filter(effect => effect.resourceId === 'creative-job').length, 1);
});

test('shared admission fence prevents late production and exposes truthful scoped cancellation summary', async () => {
  const { withWeeklyProductionAdmissionGuard, readWeeklyCancellation } = await import('./weeklyCancellation.js');
  const { dataStore } = memoryStore();
  let releaseAdmission!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { releaseAdmission = resolve; });
  const admissionEntered = new Promise<void>(resolve => { entered = resolve; });
  const admission = withWeeklyProductionAdmissionGuard({ dataStore, tenantId: 'tenant', packageId: 'package', packageVersion: 1, action: async () => { entered(); await waiting; return 'admitted'; } });
  await admissionEntered;
  const input = { dataStore, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, reason: 'cancel', now: '2026-10-07T00:00:00Z', cancelPending: async () => {} };
  await assert.rejects(reconcileWeeklyCancellation(input), /撤回补偿处理中/);
  releaseAdmission();
  assert.equal(await admission, 'admitted');
  await reconcileWeeklyCancellation(input);
  let created = false;
  await assert.rejects(withWeeklyProductionAdmissionGuard({ dataStore, tenantId: 'tenant', packageId: 'package', packageVersion: 1, action: async () => { created = true; } }), /不能创建或启动/);
  assert.equal(created, false);
  const summary = await readWeeklyCancellation(dataStore, 'tenant', 'program', 'package', 1);
  assert.equal(summary!.status, 'completed_with_external_effects');
  assert.equal(summary!.boundary, 'stop_future_work_preserve_external_effects');
  assert.ok(summary!.effects.some(effect => effect.outcome === 'unknown_requires_reconciliation' && effect.receiptCount > 0));
  assert.equal(await readWeeklyCancellation(dataStore, 'victim', 'program', 'package', 1), null);
  assert.equal(await readWeeklyCancellation(dataStore, 'tenant', 'other-program', 'package', 1), null);
  assert.equal(await readWeeklyCancellation(dataStore, 'tenant', 'program', 'package', 2), null);
});

test('cancellation migration keeps compensation server-owned and uniquely versioned', async () => {
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile('pb_migrations/1791072009_create_social_weekly_cancellations.js', 'utf8');
  assert.match(migration, /name: "social_weekly_cancellations"/);
  assert.match(migration, /min: 15, max: 15/);
  assert.match(migration, /listRule: null/);
  assert.match(migration, /createRule: null/);
  assert.match(migration, /updateRule: null/);
  assert.match(migration, /deleteRule: null/);
  assert.match(migration, /completed_with_external_effects/);
  assert.match(migration, /name: "checkpoints", type: "json"/);
  assert.match(migration, /name: "effects", type: "json"/);
  assert.match(migration, /UNIQUE INDEX.*\(tenant_id, program_id, package_id, package_version\)/);
});
