import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialImageTask, readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { claimSocialImagePaidJob, completeSocialImagePaidJob, markSocialImagePaidJobNotSubmitted, markSocialImagePaidJobUnknown, socialImageQueuedJobIssue } from './socialImagePaidJob.js';

class AtomicMemoryStore implements DataStore {
  private sequence = 0;
  private rows = new Map<string, Record_>();
  supportsAtomicCompareAndSwap = () => true;
  async getById<T = Record_>(_collection: string, id: string): Promise<T | null> { return structuredClone(this.rows.get(id) || null) as T | null; }
  async create<T = Record_>(_collection: string, data: Record<string, unknown>): Promise<T> {
    const row = { id: `row-${++this.sequence}`, ...structuredClone(data) } as Record_;
    this.rows.set(row.id, row);
    return structuredClone(row) as T;
  }
  async update(_collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    this.rows.set(id, { ...row, ...structuredClone(data) });
    return true;
  }
  async compareAndSwap(_collection: string, id: string, expected: Record<string, unknown>, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || Object.entries(expected).some(([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value))) return false;
    this.rows.set(id, { ...row, ...structuredClone(data) });
    return true;
  }
  async delete(): Promise<boolean> { return false; }
  async list<T = Record_>(_collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    return { items: [], totalItems: 0, totalPages: 0, page: query.page || 1, perPage: query.perPage || 20 };
  }
}

const hash = 'a'.repeat(64);

async function queuedTask(store: AtomicMemoryStore) {
  const created = await createSocialImageTask(store, 'tenant-a', { title: '图片', imageType: 'product_poster' });
  const saved = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    generationJobs: [{ id: 'unit-1', idempotencyKey: 'operation-1', status: 'queued', outputNodeIds: [], attempt: 0, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' }],
  });
  assert.equal(saved.kind, 'updated');
  return created.id;
}

test('paid unit is claimed once before submission and duplicate requests are denied', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  const claim = () => claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  const results = await Promise.allSettled([claim(), claim()]);
  assert.deepEqual(results.map(item => item.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await readSocialImageTask(store, 'tenant-a', taskId))?.generationJobs[0]?.status, 'running');
  await assert.rejects(claim(), /already_started/);
  await assert.rejects(claimSocialImagePaidJob({ store, tenantId: 'tenant-b', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /task_missing/);
});

test('uncertain outcome stays blocked but an existing material can be attached without resubmission', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  await markSocialImagePaidJobUnknown({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, error: 'transport uncertain' });
  assert.equal((await readSocialImageTask(store, 'tenant-a', taskId))?.generationJobs[0]?.status, 'outcome_unknown');
  const output = { id: 'output-1', role: 'carousel_page' as const, label: '轮播第 1 张', state: 'quality_checking' as const, mediaUrl: '/tenant-a/image.png', materialId: 'material-1', version: 1, qualityChecks: [] };
  const ready = await completeSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, output, provider: 'openai' });
  assert.equal(ready.outputs[0]?.materialId, 'material-1');
  assert.equal(ready.generationJobs[0]?.status, 'quality_checking');
  const repeated = await completeSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, output, provider: 'openai' });
  assert.equal(repeated.version, ready.version);
  await assert.rejects(completeSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, output: { ...output, materialId: 'different' }, provider: 'openai' }), /output_conflict/);
});

test('paid units fail closed without a verified atomic store', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  store.supportsAtomicCompareAndSwap = () => false;
  await assert.rejects(claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /atomic_store_required/);
  assert.equal((await readSocialImageTask(store, 'tenant-a', taskId))?.generationJobs[0]?.status, 'queued');
});

test('generic task writes cannot erase an unresolved paid job or forge its outcome', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  const queued = (await readSocialImageTask(store, 'tenant-a', taskId))!;
  assert.equal(socialImageQueuedJobIssue(queued, []), 'social_image_job_append_only');
  assert.equal(socialImageQueuedJobIssue(queued, [...queued.generationJobs, {
    id: 'unit-2', idempotencyKey: 'operation-2', status: 'queued', outputNodeIds: [], attempt: 0,
    createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z',
  }]), 'social_image_prior_paid_job_unresolved');
  assert.equal(socialImageQueuedJobIssue(queued, [{ ...queued.generationJobs[0]!, status: 'completed' }, ...queued.generationJobs]), 'social_image_job_history_immutable');
});

test('definitive pre-submission quota denial releases a unit without marking provider outcome unknown', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  const released = await markSocialImagePaidJobNotSubmitted({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, reason: 'quota_denied' });
  assert.equal(released.generationJobs[0]?.status, 'failed');
  assert.equal(released.status, 'planned');
});

test('multi-output types stay closed until their unit delivery path is implemented', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  const task = (await readSocialImageTask(store, 'tenant-a', taskId))!;
  const changed = await updateSocialImageTask(store, 'tenant-a', taskId, task.version, { imageType: 'carousel' });
  assert.equal(changed.kind, 'updated');
  await assert.rejects(claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /multi_output_not_ready/);
});
