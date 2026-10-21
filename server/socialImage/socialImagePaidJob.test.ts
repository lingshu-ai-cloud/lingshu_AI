import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialImageTask, readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { claimSocialImagePaidJob, completeSocialImagePaidJob, markSocialImagePaidJobNotSubmitted, markSocialImagePaidJobUnknown, recordSocialImagePaidJobFailure, socialImageOwnedMaterialUrl, socialImageQueuedJobIssue } from './socialImagePaidJob.js';
import { recoverSocialImagePaidMaterial } from './socialImageMaterialRecovery.js';

class AtomicMemoryStore implements DataStore {
  private sequence = 0;
  private rows = new Map<string, Record_>();
  supportsAtomicCompareAndSwap = () => true;
  supportsAtomicCompareAndSwapFor?: DataStore['supportsAtomicCompareAndSwapFor'];
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

test('persisted matching tenant material can repair a lost task write without another provider call', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  await markSocialImagePaidJobUnknown({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', inputHash: hash, error: 'task write lost' });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const material = {
    id: 'material-1', tenantId: 'tenant-a', scope: 'own', type: 'image', sourceType: 'ai_generated_marketing_image',
    sourceProvider: 'openai', file: 'tenants/tenant-a/material-1.png', contentSha256: createHash('sha256').update(bytes).digest('hex'),
    provenance: { socialImageTaskId: taskId, socialImageJobId: 'unit-1', socialImageInputHash: hash },
  };
  let reads = 0;
  const recover = (materials = [material]) => recoverSocialImagePaidMaterial({
    store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', materials,
    readBytes: async () => { reads += 1; return { bytes, mimeType: 'image/png' }; },
    materialUrl: () => '/media/tenants/tenant-a/material-1.png',
  });
  const first = await recover([{ ...material, tenantId: 'tenant-b' }, material]);
  assert.equal(first.task.generationJobs[0]?.status, 'quality_checking');
  assert.equal(first.task.outputs[0]?.materialId, material.id);
  const repeated = await recover();
  assert.equal(repeated.task.version, first.task.version);
  assert.equal(reads, 2);
});

test('material recovery rejects wrong tenant, ambiguous provenance and corrupt bytes', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const material = {
    id: 'material-1', tenantId: 'tenant-a', scope: 'own', type: 'image', sourceType: 'ai_generated_marketing_image',
    file: 'tenants/tenant-a/material-1.png', contentSha256: createHash('sha256').update(bytes).digest('hex'),
    provenance: { socialImageTaskId: taskId, socialImageJobId: 'unit-1', socialImageInputHash: hash },
  };
  const recover = (materials: Array<typeof material>, actualBytes = bytes) => recoverSocialImagePaidMaterial({
    store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', materials,
    readBytes: async () => ({ bytes: actualBytes, mimeType: 'image/png' }),
    materialUrl: () => '/media/tenants/tenant-a/material-1.png',
  });
  await assert.rejects(recover([{ ...material, tenantId: 'tenant-b' }]), /material_not_found/);
  await assert.rejects(recover([material, { ...material, id: 'material-2', file: 'tenants/tenant-a/material-2.png' }]), /material_ambiguous/);
  await assert.rejects(recover([material], Buffer.from('altered')), /material_hash_mismatch/);
  await assert.rejects(recover([{ ...material, file: 'tenants/tenant-b/material-1.png' }]), /material_not_found/);
  assert.equal((await readSocialImageTask(store, 'tenant-a', taskId))?.generationJobs[0]?.status, 'running');
});

test('recovered media paths are stable and tenant-scoped', () => {
  assert.equal(socialImageOwnedMaterialUrl({ id: 'a', file: 'tenants/tenant-a/a.png' }, 'tenant-a'), '/media/tenants/tenant-a/a.png');
  assert.equal(socialImageOwnedMaterialUrl({ id: 'a', objectKey: 'materials/tenants/dGVuYW50LWE/a.png' }, 'tenant-a'), '/api/overseas/studio/private-assets/materials/a.png');
  assert.throws(() => socialImageOwnedMaterialUrl({ id: 'a', objectKey: 'materials/tenants/dGVuYW50LWI/a.png' }, 'tenant-a'), /locator_invalid/);
});

test('paid units fail closed without a verified atomic store', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  store.supportsAtomicCompareAndSwap = () => false;
  await assert.rejects(claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /atomic_store_required/);
  assert.equal((await readSocialImageTask(store, 'tenant-a', taskId))?.generationJobs[0]?.status, 'queued');
});

test('paid unit uses collection-scoped atomic proof when global capability is unavailable', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  store.supportsAtomicCompareAndSwap = () => false;
  store.supportsAtomicCompareAndSwapFor = collection => collection === 'studio_projects';
  const claimed = await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  assert.equal(claimed.generationJobs[0]?.status, 'running');
  const denied = new AtomicMemoryStore();
  const deniedTaskId = await queuedTask(denied);
  denied.supportsAtomicCompareAndSwapFor = () => false;
  await assert.rejects(claimSocialImagePaidJob({ store: denied, tenantId: 'tenant-a', taskId: deniedTaskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /atomic_store_required/);
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

test('definitive provider rejection releases a unit while uncertain failure remains blocked', async () => {
  const rejected = new AtomicMemoryStore();
  const rejectedTaskId = await queuedTask(rejected);
  await claimSocialImagePaidJob({ store: rejected, tenantId: 'tenant-a', taskId: rejectedTaskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  const failed = await recordSocialImagePaidJobFailure({ store: rejected, tenantId: 'tenant-a', taskId: rejectedTaskId, jobId: 'unit-1', inputHash: hash, error: 'OpenAI Image 400: rejected', definitiveRejection: true });
  assert.equal(failed.generationJobs[0]?.status, 'failed');
  assert.equal(failed.status, 'planned');

  const uncertain = new AtomicMemoryStore();
  const uncertainTaskId = await queuedTask(uncertain);
  await claimSocialImagePaidJob({ store: uncertain, tenantId: 'tenant-a', taskId: uncertainTaskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash });
  const blocked = await recordSocialImagePaidJobFailure({ store: uncertain, tenantId: 'tenant-a', taskId: uncertainTaskId, jobId: 'unit-1', inputHash: hash, error: 'transport outcome unknown', definitiveRejection: false });
  assert.equal(blocked.generationJobs[0]?.status, 'outcome_unknown');
  assert.equal(blocked.status, 'blocked');
});

test('multi-output types stay closed until their unit delivery path is implemented', async () => {
  const store = new AtomicMemoryStore();
  const taskId = await queuedTask(store);
  const task = (await readSocialImageTask(store, 'tenant-a', taskId))!;
  const changed = await updateSocialImageTask(store, 'tenant-a', taskId, task.version, { imageType: 'carousel' });
  assert.equal(changed.kind, 'updated');
  await assert.rejects(claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId, jobId: 'unit-1', idempotencyKey: 'operation-1', inputHash: hash }), /multi_output_not_ready/);
});
