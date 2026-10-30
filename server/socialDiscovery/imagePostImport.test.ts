import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { imagePostSourceHash } from './imagePostReanalysis.js';
import { importNewImagePost } from './imagePostImport.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

const item: CrawledImagePost = {
  platform: 'instagram', title: 'Bottle', sourceUrl: 'https://example.test/post/1',
  thumbnailUrl: 'https://example.test/1.png', imageUrls: ['https://example.test/1.png'],
  caption: 'Caption', views: '', tags: ['factory'],
};
const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };

function fixture(options: { failCreate?: boolean; failStageUpdate?: boolean; failImages?: boolean; rejectImage?: boolean; defer?: boolean; failAnalysis?: boolean; throwAnalysis?: boolean; uncertainResult?: boolean } = {}) {
  const events: string[] = [];
  let row: Record<string, unknown> | null = null;
  let updates = 0;
  const store = {
    async create(_collection: string, data: Record<string, unknown>) {
      events.push('create');
      if (options.failCreate) return null;
      row = { id: 'record-1', ...data };
      return structuredClone(row);
    },
    async getById() { return row ? structuredClone(row) : null; },
    async delete() { events.push('delete'); row = null; return true; },
    async update(_collection: string, _id: string, patch: Record<string, unknown>) {
      updates++;
      events.push(`update-${updates}`);
      if (options.failStageUpdate && updates === 1) return false;
      Object.assign(row!, patch);
      return true;
    },
  } as unknown as DataStore;
  const input = { store, collection: 'trend_videos', tenantId: 'tenant-1', item, keyword: 'bottle',
    crawlerSource: 'instagram-image-search', accountMode: false, accountUrl: '',
    deferImageAnalysis: Boolean(options.defer),
    async persistThumbnail() { events.push('thumbnail'); return '/media/record-1.png'; },
    async persistImages() { events.push('images'); if (options.rejectImage) throw Error('image_post_single_static_image_required'); if (options.failImages) throw Error('image_storage_failed'); return ['/api/overseas/videos/record-1/image/0']; },
    async analyze(received: CrawledImagePost) { events.push('analyze'); assert.equal(received.tenantId, 'tenant-1'); assert.deepEqual(received.imageUrls, ['/api/overseas/videos/record-1/image/0']); if (options.throwAnalysis) throw Error('transport_unknown'); return options.failAnalysis
      ? { status: 'failed' as const, error: 'vision_unavailable', providerAttempted: options.uncertainResult }
      : { status: 'analyzed' as const, analysis: evidence, provider: 'qwen' as const }; },
    async queue() { events.push('queue'); },
  };
  return { input, events, get row() { return row; } };
}

test('new record and source media are durable before visual analysis', async () => {
  const f = fixture();
  const saved = await importNewImagePost(f.input);
  assert.deepEqual(f.events, ['create', 'images', 'thumbnail', 'update-1', 'analyze', 'update-2']);
  assert.equal(saved?.status, 'analyzed');
  const analysis = JSON.parse(String(saved?.aiAnalysis));
  assert.equal(analysis.imageEvidence.observedFacts[0].subjects[0], 'bottle');
  assert.equal(analysis.imageUrls[0], '/api/overseas/videos/record-1/image/0');
});

test('rejected animated image leaves no new post or analysis job', async () => {
  const f = fixture({ rejectImage: true });
  assert.equal(await importNewImagePost(f.input), null);
  assert.equal(f.row, null);
  assert.deepEqual(f.events, ['create', 'images', 'delete']);
});

test('missing record or failed source persistence never reaches vision model', async () => {
  const missing = fixture({ failCreate: true });
  assert.equal(await importNewImagePost(missing.input), null);
  assert.deepEqual(missing.events, ['create']);
  const failed = fixture({ failStageUpdate: true });
  await assert.rejects(importNewImagePost(failed.input), /source_persistence_failed/);
  assert.ok(!failed.events.includes('analyze'));
  assert.equal(failed.row?.status, 'pending');
  const images = fixture({ failImages: true });
  await assert.rejects(importNewImagePost(images.input), /image_storage_failed/);
  assert.ok(!images.events.includes('analyze'));
  assert.equal(images.row?.status, 'pending');
});

test('deferred analysis queues only after source write and synchronous failures remain visible', async () => {
  const deferred = fixture({ defer: true });
  const staged = await importNewImagePost(deferred.input);
  assert.deepEqual(deferred.events, ['create', 'images', 'thumbnail', 'update-1']);
  assert.equal(staged?.status, 'pending');
  const receipt = JSON.parse(String(staged?.aiAnalysis));
  assert.equal(receipt.imageAnalysisQueueState, 'queued');
  assert.equal(receipt.imageAnalysisQueueInput.item.sourceUrl, item.sourceUrl);
  assert.equal(receipt.imageAnalysisQueueInput.item.tenantId, 'tenant-1');
  assert.deepEqual(receipt.imageAnalysisQueueInput.item.imageUrls, receipt.imageUrls);
  assert.equal(receipt.imageAnalysisQueueInput.sourceHash, imagePostSourceHash(deferred.row!));
  assert.equal(receipt.imageUrls[0], '/api/overseas/videos/record-1/image/0');
  const failed = fixture({ failAnalysis: true });
  const saved = await importNewImagePost(failed.input);
  assert.equal(saved?.status, 'failed');
  assert.equal(JSON.parse(String(saved?.aiAnalysis)).imageAnalysisError, 'vision_unavailable');
});

test('interrupted inline calls retain an uncertain attempt and are never advertised as unsubmitted', async () => {
  const f = fixture({ throwAnalysis: true });
  await assert.rejects(importNewImagePost(f.input), /transport_unknown/);
  const analysis = JSON.parse(String(f.row?.aiAnalysis));
  assert.equal(analysis.imageAnalysisQueueState, 'unknown');
  assert.ok(analysis.imageAnalysisAttemptId && analysis.imageAnalysisStartedAt);
  assert.equal(analysis.imageAnalysisError, 'image_post_queue_result_unknown');
});

test('failed transport after a provider attempt is uncertain, not automatically retryable', async () => {
  const f = fixture({ failAnalysis: true, uncertainResult: true });
  await assert.rejects(importNewImagePost(f.input), /provider_result_unknown/);
  assert.equal(JSON.parse(String(f.row?.aiAnalysis)).imageAnalysisQueueState, 'unknown');
});
