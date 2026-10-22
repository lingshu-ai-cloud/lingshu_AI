import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createImagePostAnalysisQueue } from './imagePostAnalysisQueue.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

const item: CrawledImagePost = {
  platform: 'instagram', title: 'Bottle', sourceUrl: 'https://example.test/post/1',
  thumbnailUrl: 'https://example.test/1.png', imageUrls: ['https://example.test/1.png'],
  caption: 'Bottle caption', views: '', tags: ['factory'],
};
const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };

function fixture(options: { available?: boolean; throwProvider?: boolean; failedAfterProvider?: boolean; changeSource?: boolean } = {}) {
  const events: string[] = [];
  let record: Record<string, unknown> = {
    id: 'record-1', tenantId: 'tenant-1', contentFormat: 'image', status: 'pending',
    platform: 'instagram', sourceUrl: item.sourceUrl, thumbnailUrl: '/media/record-1.png',
    aiAnalysis: JSON.stringify({ contentFormat: 'image', caption: item.caption,
      imageUrls: ['/api/overseas/videos/record-1/image/0'], imageObjectKeys: ['image-1'] }),
  };
  let lease: Record<string, unknown> | null = null;
  const store = {
    async getById(collection: string, id: string) {
      return structuredClone(collection === 'trend_videos' && id === record.id ? record
        : collection === 'durable_operation_leases' && id === lease?.id ? lease : null);
    },
    async list(collection: string, query: ListQuery = {}) {
      const values = collection === 'trend_videos' ? [record] : lease ? [lease] : [];
      const rows = values.filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      return { items: structuredClone(rows), totalItems: rows.length, totalPages: rows.length ? 1 : 0, page: 1, perPage: 100 };
    },
    async create(collection: string, data: Record<string, unknown>) {
      assert.equal(collection, 'durable_operation_leases');
      if (lease) return null;
      lease = { id: 'lease-1', ...data };
      events.push('lease');
      return structuredClone(lease);
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      assert.equal(collection, 'trend_videos');
      assert.equal(id, 'record-1');
      events.push('update');
      record = { ...record, ...structuredClone(patch) };
      return true;
    },
    async delete(collection: string, id: string) {
      assert.equal(collection, 'durable_operation_leases');
      assert.equal(id, 'lease-1');
      lease = null;
      events.push('release');
      return true;
    },
  } as unknown as DataStore;
  const queue = createImagePostAnalysisQueue({ store, collection: 'trend_videos',
    leaseAvailable: async () => options.available !== false,
    async analyze(received, keyword) {
      events.push('provider');
      assert.equal(received.sourceUrl, item.sourceUrl);
      assert.equal(keyword, 'bottle');
      if (options.changeSource) record = { ...record, sourceUrl: 'https://example.test/post/2' };
      if (options.throwProvider) throw Error('transport_unknown');
      if (options.failedAfterProvider) return { status: 'failed', error: 'Qwen/Gemini unavailable', providerAttempted: true };
      return { status: 'analyzed', analysis: evidence, provider: 'qwen' };
    },
  });
  return { queue, events, get record() { return record; }, set record(value: Record<string, unknown>) { record = value; } };
}

test('deferred record is queued durably, then claimed once before provider call', async () => {
  const f = fixture();
  await f.queue.queue('record-1', item, 'bottle');
  assert.deepEqual(f.events, ['update']);
  assert.equal(JSON.parse(String(f.record.aiAnalysis)).imageAnalysisQueueState, 'queued');
  assert.deepEqual(await f.queue.runOnce(), { available: true, picked: 1, completed: 1, failed: 0, unknown: 0 });
  assert.deepEqual(f.events, ['update', 'lease', 'update', 'provider', 'update', 'release']);
  assert.equal(f.record.status, 'analyzed');
  assert.equal(JSON.parse(String(f.record.aiAnalysis)).imageEvidence.observedFacts[0].subjects[0], 'bottle');
  assert.equal((await f.queue.runOnce()).picked, 0);
});

test('unproven atomic lease leaves durable work queued without supplier call', async () => {
  const f = fixture({ available: false });
  await f.queue.queue('record-1', item, 'bottle');
  assert.deepEqual(await f.queue.runOnce(), { available: false, picked: 0, completed: 0, failed: 0, unknown: 0 });
  assert.deepEqual(f.events, ['update']);
});

test('provider uncertainty and interrupted processing are not automatically replayed', async () => {
  const f = fixture({ throwProvider: true });
  await f.queue.queue('record-1', item, 'bottle');
  assert.equal((await f.queue.runOnce()).unknown, 1);
  assert.equal(JSON.parse(String(f.record.aiAnalysis)).imageAnalysisQueueState, 'unknown');
  assert.equal((await f.queue.runOnce()).picked, 0);
  assert.equal(f.events.filter(value => value === 'provider').length, 1);
  const interrupted = fixture();
  await interrupted.queue.queue('record-1', item, 'bottle');
  interrupted.record = { ...interrupted.record, aiAnalysis: JSON.stringify({
    ...JSON.parse(String(interrupted.record.aiAnalysis)), imageAnalysisQueueState: 'processing',
  }) };
  assert.equal((await interrupted.queue.runOnce()).picked, 0);
  assert.ok(!interrupted.events.includes('provider'));
  const failed = fixture({ failedAfterProvider: true });
  await failed.queue.queue('record-1', item, 'bottle');
  assert.equal((await failed.queue.runOnce()).unknown, 1);
  assert.equal(JSON.parse(String(failed.record.aiAnalysis)).imageAnalysisQueueState, 'unknown');
  assert.equal((await failed.queue.runOnce()).picked, 0);
});

test('changed source is rejected before provider and in-flight source change cannot overwrite it', async () => {
  const before = fixture();
  await before.queue.queue('record-1', item, 'bottle');
  before.record = { ...before.record, sourceUrl: 'https://example.test/post/2' };
  assert.equal((await before.queue.runOnce()).failed, 1);
  assert.ok(!before.events.includes('provider'));
  const during = fixture({ changeSource: true });
  await during.queue.queue('record-1', item, 'bottle');
  assert.equal((await during.queue.runOnce()).unknown, 1);
  assert.equal(during.record.sourceUrl, 'https://example.test/post/2');
  assert.notEqual(during.record.status, 'analyzed');
  assert.equal(JSON.parse(String(during.record.aiAnalysis)).imageAnalysisQueueState, 'processing');
});
