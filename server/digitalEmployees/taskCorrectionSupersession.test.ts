import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { RunRecord, TaskRecord } from '../routes/digitalEmployeeRecords.js';
import type { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import type { getFollowupBatchItems } from './customerWorkflow.js';
import { supersedeAffectedBusinessState } from './taskCorrectionSupersession.js';

const tenantId = 'tenant-a';
const run = { id: 'run-a', tenant_id: tenantId } as RunRecord;
const now = '2026-10-23T08:00:00.000Z';
const affected = (key: string): TaskRecord => ({ id: `task-${key}`, task_key: key,
  tenant_id: tenantId, run_id: run.id } as TaskRecord);

function fixture(seed: Record<string, Record_[]>) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, structuredClone(rows)]));
  const writes: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
  const jobs: string[] = [];
  const store: DataStore = {
    async getById() { return null; }, async create() { return null; }, async delete() { return false; },
    async list<T>(collection: string, query: ListQuery = {}) {
      const rows = (tables.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      return { items: structuredClone(rows) as T[], totalItems: rows.length, totalPages: 1,
        page: 1, perPage: query.perPage ?? 30 };
    },
    async update(collection, id, data) {
      const row = tables.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      writes.push({ collection, id, data }); Object.assign(row, structuredClone(data)); return true;
    },
  };
  const controlJob: typeof controlContentExecutionJob = async ({ jobId }) => {
    jobs.push(jobId);
    return {} as Awaited<ReturnType<typeof controlContentExecutionJob>>;
  };
  const getItems: typeof getFollowupBatchItems = async () =>
    (tables.get('followup_batch_items') ?? []) as unknown as Awaited<ReturnType<typeof getFollowupBatchItems>>;
  return { store, tables, writes, jobs, controlJob, getItems };
}

test('routing correction invalidates active jobs, frozen batch, owned project and affected approval', async () => {
  const f = fixture({
    content_execution_jobs: [
      { id: 'job-live', tenant_id: tenantId, run_id: run.id, status: 'running' },
      { id: 'job-done', tenant_id: tenantId, run_id: run.id, status: 'succeeded' },
    ],
    content_batch_plans: [{ id: 'batch-a', tenant_id: tenantId,
      run_id: run.id, status: 'approved' }],
    studio_projects: [
      { id: 'owned', tenant_id: tenantId, status: 'draft', spec: {
        workflowRunId: run.id, automation: { managedBy: 'digital_employee', stage: 'active' } } },
      { id: 'other-run', tenant_id: tenantId, status: 'draft', spec: {
        workflowRunId: 'run-b', automation: { managedBy: 'digital_employee', stage: 'active' } } },
    ],
    approval_requests: [{ id: 'approval-a', tenant_id: tenantId, run_id: run.id,
      task_id: 'task-content_mode_routing', status: 'pending' }],
  });
  await supersedeAffectedBusinessState({ store: f.store, tenantId, run,
    affected: [affected('content_mode_routing')], now,
    controlJob: f.controlJob, getFollowupBatchItems: f.getItems });
  assert.deepEqual(f.jobs, ['job-live']);
  assert.equal(f.writes.some(write => write.id === 'batch-a' && write.data.status === 'superseded'), true);
  assert.equal(f.writes.some(write => write.id === 'owned' &&
    (write.data.spec as { automation: { stage: string } }).automation.stage === 'superseded'), true);
  assert.equal(f.writes.some(write => write.id === 'other-run'), false);
  assert.equal(f.writes.some(write => write.id === 'approval-a' && write.data.status === 'superseded'), true);
});

test('followup draft correction preserves sent and delivered items while superseding unsent work', async () => {
  const f = fixture({
    followup_batches: [{ id: 'batch-a', tenant_id: tenantId, run_id: run.id, status: 'approved' }],
    followup_batch_items: [
      { id: 'unsent', status: 'approved' }, { id: 'sent', status: 'sent' },
      { id: 'delivered', status: 'delivered' },
    ],
    approval_requests: [],
  });
  await supersedeAffectedBusinessState({ store: f.store, tenantId, run,
    affected: [affected('followup_batch_draft')], now,
    controlJob: f.controlJob, getFollowupBatchItems: f.getItems });
  assert.equal(f.writes.some(write => write.id === 'batch-a' && write.data.status === 'superseded'), true);
  assert.deepEqual(f.writes.filter(write => write.collection === 'followup_batch_items')
    .map(write => write.id), ['unsent']);
});

test('followup approval correction resets only decision-stage batch and items', async () => {
  const f = fixture({
    followup_batches: [
      { id: 'batch-a', tenant_id: tenantId, run_id: run.id, status: 'approved' },
      { id: 'batch-b', tenant_id: tenantId, run_id: run.id, status: 'sent' },
    ],
    followup_batch_items: [
      { id: 'approved-item', status: 'approved' },
      { id: 'sent-item', status: 'sent' },
    ],
    approval_requests: [],
  });
  await supersedeAffectedBusinessState({ store: f.store, tenantId, run,
    affected: [affected('followup_batch_approval')], now,
    controlJob: f.controlJob, getFollowupBatchItems: f.getItems });
  assert.equal(f.writes.some(write => write.id === 'batch-a' && write.data.status === 'draft'), true);
  assert.equal(f.writes.some(write => write.id === 'batch-b'), false);
  assert.deepEqual(f.writes.filter(write => write.collection === 'followup_batch_items')
    .map(write => write.id), ['approved-item']);
});
