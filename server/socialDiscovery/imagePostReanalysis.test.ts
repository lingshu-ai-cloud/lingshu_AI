import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { reanalyzeStoredImagePost } from './imagePostReanalysis.js';

const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };

function fixture(options: { failStart?: boolean; failFinish?: boolean; changeSource?: boolean } = {}) {
  const events: string[] = [];
  let row: Record<string, unknown> = {
    id: 'record-1', tenantId: 'tenant-1', contentFormat: 'image', platform: 'instagram',
    sourceUrl: 'https://example.test/post/1', thumbnailUrl: '/media/record-1.png',
    title: 'Bottle', tags: '["factory"]', status: 'analyzed',
    aiAnalysis: JSON.stringify({ contentFormat: 'image', caption: 'Bottle caption', keyword: 'bottle',
      imageUrls: ['/api/overseas/videos/record-1/image/0'], imageObjectKeys: ['image-1'] }),
  };
  let updates = 0;
  const store = {
    async getById() { return structuredClone(row); },
    async update(_collection: string, _id: string, patch: Record<string, unknown>) {
      events.push(`update-${++updates}`);
      if ((options.failStart && updates === 1) || (options.failFinish && updates === 2)) return false;
      row = { ...row, ...patch };
      return true;
    },
  } as unknown as DataStore;
  const record = structuredClone(row);
  const input = { store, collection: 'trend_videos', tenantId: 'tenant-1', record,
    async analyze(item: { imageUrls?: string[]; caption?: string }, keyword: string) {
      events.push('analyze');
      assert.equal(row.status, 'pending');
      assert.equal(item.imageUrls?.[0], '/api/overseas/videos/record-1/image/0');
      assert.equal(item.caption, 'Bottle caption');
      assert.equal(keyword, 'bottle');
      if (options.changeSource) row = { ...row, sourceUrl: 'https://example.test/post/2' };
      return { status: 'analyzed' as const, analysis: evidence, provider: 'qwen' as const };
    },
  };
  return { input, events, get row() { return row; } };
}

test('manual reanalysis persists attempt before provider and result after it', async () => {
  const f = fixture();
  const result = await reanalyzeStoredImagePost(f.input);
  assert.equal(result.status, 'analyzed');
  assert.deepEqual(f.events, ['update-1', 'analyze', 'update-2']);
  assert.equal(f.row.status, 'analyzed');
  assert.equal(JSON.parse(String(f.row.aiAnalysis)).imageEvidence.observedFacts[0].subjects[0], 'bottle');
});

test('failed attempt persistence prevents provider call and failed result write stays pending', async () => {
  const start = fixture({ failStart: true });
  await assert.rejects(reanalyzeStoredImagePost(start.input), /attempt_persistence_failed/);
  assert.deepEqual(start.events, ['update-1']);
  const finish = fixture({ failFinish: true });
  await assert.rejects(reanalyzeStoredImagePost(finish.input), /result_persistence_failed/);
  assert.deepEqual(finish.events, ['update-1', 'analyze', 'update-2']);
  assert.equal(finish.row.status, 'pending');
});

test('changed source after provider response is not overwritten by stale evidence', async () => {
  const f = fixture({ changeSource: true });
  await assert.rejects(reanalyzeStoredImagePost(f.input), /source_changed/);
  assert.deepEqual(f.events, ['update-1', 'analyze']);
  assert.equal(f.row.sourceUrl, 'https://example.test/post/2');
});

test('cross-tenant input is rejected before any write or provider call', async () => {
  const f = fixture();
  await assert.rejects(reanalyzeStoredImagePost({ ...f.input, tenantId: 'tenant-2' }), /tenant_mismatch/);
  assert.deepEqual(f.events, []);
});
