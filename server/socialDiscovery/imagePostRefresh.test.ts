import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';
import { refreshExistingImagePost } from './imagePostRefresh.js';

const item: CrawledImagePost = {
  platform: 'instagram', title: 'Bottle', sourceUrl: 'https://example.test/post/1',
  thumbnailUrl: 'https://example.test/1.png', imageUrls: ['https://example.test/1.png'],
  caption: 'New caption', views: '', tags: ['factory'],
};
const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };

function fixture(options: { defer?: boolean; analyzedBefore?: boolean; failStage?: boolean; failImages?: boolean } = {}) {
  const events: string[] = [];
  let row: Record<string, unknown> = {
    id: 'record-1', tenantId: 'tenant-1', thumbnailUrl: 'old.png', status: 'analyzed',
    aiAnalysis: JSON.stringify({ contentFormat: 'image', caption: 'Old caption',
      imageEvidence: options.analyzedBefore ? evidence : undefined }),
  };
  let updates = 0;
  const store = {
    async getById() { return structuredClone(row); },
    async update(_collection: string, _id: string, patch: Record<string, unknown>) {
      updates++;
      events.push(`update-${updates}`);
      if (options.failStage && updates === 1) return false;
      row = { ...row, ...patch };
      return true;
    },
  } as unknown as DataStore;
  const input = { store, collection: 'trend_videos', tenantId: 'tenant-1', existingRecord: structuredClone(row),
    item, keyword: 'bottle', accountMode: false, accountUrl: '', deferImageAnalysis: Boolean(options.defer),
    async persistThumbnail() { events.push('thumbnail'); return '/media/record-1.png'; },
    async persistImages() { events.push('images'); if (options.failImages) throw Error('image_storage_failed'); return ['/api/overseas/videos/record-1/image/0']; },
    async analyze() { events.push('analyze'); assert.equal(row.status, 'pending');
      assert.equal(JSON.parse(String(row.aiAnalysis)).caption, 'New caption');
      return { status: 'analyzed' as const, analysis: evidence, provider: 'qwen' as const }; },
    async queue() { events.push('queue'); assert.equal(row.status, 'pending'); },
  };
  return { input, events, get row() { return row; } };
}

test('existing post stores refreshed source before vision analysis', async () => {
  const f = fixture();
  const result = await refreshExistingImagePost(f.input);
  assert.deepEqual(f.events, ['images', 'thumbnail', 'update-1', 'analyze', 'update-2']);
  assert.equal(result.thumbnailUrl, '/media/record-1.png');
  assert.equal(f.row.status, 'analyzed');
  assert.equal(JSON.parse(String(f.row.aiAnalysis)).imageEvidence.observedFacts[0].subjects[0], 'bottle');
});

test('refresh never analyzes or queues if source persistence fails', async () => {
  const failed = fixture({ failStage: true });
  await assert.rejects(refreshExistingImagePost(failed.input), /source_persistence_failed/);
  assert.ok(!failed.events.includes('analyze'));
  const images = fixture({ failImages: true });
  await assert.rejects(refreshExistingImagePost(images.input), /image_storage_failed/);
  assert.ok(!images.events.includes('analyze'));
});

test('deferred refresh queues only unanalyzed records after source write', async () => {
  const deferred = fixture({ defer: true });
  await refreshExistingImagePost(deferred.input);
  assert.deepEqual(deferred.events, ['images', 'thumbnail', 'update-1', 'queue']);
  const analyzed = fixture({ defer: true, analyzedBefore: true });
  await refreshExistingImagePost(analyzed.input);
  assert.deepEqual(analyzed.events, ['images', 'thumbnail', 'update-1', 'analyze', 'update-2']);
});
