import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../shared/contracts/socialImageCreation.js';
import { createSocialImageTask, readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { claimSocialImagePlannedUnit, persistSocialImageMultiUnitPlan } from './socialImageDurablePlan.js';
import { completeSocialImagePaidJob, markSocialImagePaidJobUnknown } from './socialImagePaidJob.js';
import { finalizeSocialImageGif } from './socialImageGifDelivery.js';

class AtomicMemoryStore implements DataStore {
  private sequence = 0;
  private rows = new Map<string, Record_>();
  supportsAtomicCompareAndSwap = () => true;
  async getById<T = Record_>(_collection: string, id: string): Promise<T | null> {
    return structuredClone(this.rows.get(id) || null) as T | null;
  }
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

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('durable GIF plates compose fixed frames and one idempotent delivery without provider calls', async () => {
  const store = new AtomicMemoryStore();
  const product = await sharp({ create: { width: 35, height: 65, channels: 4, background: '#d13434' } }).png().toBuffer();
  const benchmark = await sharp({ create: { width: 240, height: 300, channels: 4, background: '#455668' } }).png().toBuffer();
  const created = await createSocialImageTask(store, 'tenant-a', { imageType: 'gif_poster', title: 'GIF delivery' });
  const configured = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    renderBrief: { headline: 'Product', subheadline: 'Stable', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: 'Contact' },
    contentBrief: { ...created.contentBrief, coreClaim: 'Known product', productRefs: ['product-a'] },
    enterpriseAssets: [{ assetId: 'product-a', role: 'product', name: 'Product A', source: 'enterprise_knowledge_base',
      required: true }],
    referenceSnapshot: { imageUrls: ['/benchmark.png'], collectedAt: '2026-10-22T00:00:00Z', fingerprint: 'benchmark-a' },
  });
  assert.equal(configured.kind, 'updated');
  if (configured.kind !== 'updated') return;
  let current = await persistSocialImageMultiUnitPlan({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: configured.task.version, productHashes: { 'product-a': hash(product) } });
  assert.equal(current.enterpriseAssets[0]?.contentHash, hash(product));
  const plates = new Map<string, Buffer>();
  for (const unit of current.renderPlan!.units) {
    const background = await sharp({ create: { width: 120, height: 150, channels: 4,
      background: ['#1769aa', '#39a96b', '#f29f05', '#9b51e0'][unit.index]! } }).png().toBuffer();
    const requestHash = 'a'.repeat(64);
    current = await claimSocialImagePlannedUnit({ store, tenantId: 'tenant-a', taskId: created.id, jobId: unit.jobId,
      idempotencyKey: unit.idempotencyKey, plannedInputHash: unit.plannedInputHash, renderRequestHash: requestHash });
    const materialId = `plate-${unit.index}`;
    plates.set(materialId, background);
    current = await completeSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId: created.id, jobId: unit.jobId,
      inputHash: requestHash, provider: 'fixture', output: { id: `output-${unit.index}`, role: 'gif_plate',
        label: unit.label, state: 'quality_checking', mediaUrl: `/media/${materialId}.png`, materialId,
        version: 1, qualityChecks: [] } });
  }
  const persisted = new Map<string, { materialId: string; mediaUrl: string; contentSha256: string; bytes: Buffer }>();
  const finalize = (expectedVersion: number) => finalizeSocialImageGif({
    store, tenantId: 'tenant-a', taskId: created.id, expectedVersion,
    readPlate: async output => plates.get(output.materialId || '') || null,
    readProduct: async id => id === 'product-a' ? product : null,
    readBenchmark: async url => url === '/benchmark.png' ? benchmark : null,
    persist: async asset => {
      const previous = persisted.get(asset.stableKey);
      if (previous) return previous;
      const record = { materialId: `generated-${persisted.size}`, mediaUrl: `/media/generated-${persisted.size}`,
        contentSha256: hash(asset.bytes), bytes: asset.bytes };
      persisted.set(asset.stableKey, record);
      return record;
    },
  });
  const delivered = await finalize(current.version);
  assert.equal(delivered.outputs.filter(output => output.role === 'gif_frame').length, 4);
  assert.equal(delivered.outputs.filter(output => output.role === 'gif_output').length, 1);
  assert.equal(delivered.gifDelivery?.frameOutputIds.length, 4);
  assert.equal(persisted.size, 5);
  const final = persisted.get([...persisted.keys()].find(key => key.endsWith(':delivery'))!);
  assert.ok(final);
  const metadata = await sharp(final.bytes, { animated: true }).metadata();
  assert.equal(metadata.format, 'gif');
  assert.equal(metadata.pages, 4);
  assert.equal(metadata.width, 240);
  assert.equal(metadata.pageHeight, 300);
  const repeated = await finalize(current.version);
  assert.equal(repeated.version, delivered.version);
  assert.equal(persisted.size, 5);
  assert.equal((await readSocialImageTask(store, 'tenant-b', created.id)), null);
  const rewrittenInput = await updateSocialImageTask(store, 'tenant-a', created.id, delivered.version,
    { contentBrief: { ...delivered.contentBrief, coreClaim: 'Changed after paid delivery' } });
  assert.equal(rewrittenInput.kind, 'invalid');

  const passed = delivered.outputs.map(output => output.role === 'gif_plate' ? output : {
    ...output, state: 'approved' as const,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const, note: 'fixture' })),
  });
  const approved = await updateSocialImageTask(store, 'tenant-a', created.id, delivered.version,
    { outputs: passed, status: 'approved', fieldsToConfirm: [] });
  assert.equal(approved.kind, 'updated');
  if (approved.kind === 'updated') assert.equal(approved.task.publishable, true);
});

test('GIF finalization refuses unresolved paid plates before persisting any asset', async () => {
  const store = new AtomicMemoryStore();
  const product = await sharp({ create: { width: 20, height: 30, channels: 4, background: '#d13434' } }).png().toBuffer();
  const created = await createSocialImageTask(store, 'tenant-a', { imageType: 'gif_poster', title: 'Unresolved GIF' });
  const configured = await updateSocialImageTask(store, 'tenant-a', created.id, created.version,
    { renderBrief: { headline: 'Product', subheadline: '', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: '' },
      contentBrief: { ...created.contentBrief, coreClaim: 'Known product', productRefs: ['product-a'] },
      enterpriseAssets: [{ assetId: 'product-a', role: 'product', name: 'Product A', source: 'enterprise_knowledge_base', required: true }] });
  assert.equal(configured.kind, 'updated');
  if (configured.kind !== 'updated') return;
  const planned = await persistSocialImageMultiUnitPlan({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: configured.task.version, productHashes: { 'product-a': hash(product) } });
  const first = planned.renderPlan!.units[0]!;
  await claimSocialImagePlannedUnit({ store, tenantId: 'tenant-a', taskId: created.id, jobId: first.jobId,
    idempotencyKey: first.idempotencyKey, plannedInputHash: first.plannedInputHash, renderRequestHash: 'b'.repeat(64) });
  const unknown = await markSocialImagePaidJobUnknown({ store, tenantId: 'tenant-a', taskId: created.id,
    jobId: first.jobId, inputHash: 'b'.repeat(64), error: 'provider response lost' });
  let persisted = 0;
  await assert.rejects(finalizeSocialImageGif({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: unknown.version, readPlate: async () => null, readProduct: async () => product,
    persist: async () => { persisted += 1; throw Error('must not persist'); } }), /social_image_gif_plate_unresolved/);
  assert.equal(persisted, 0);
});
