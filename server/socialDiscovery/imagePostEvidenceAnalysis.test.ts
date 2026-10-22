import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { createImagePostEvidenceAnalyzer, type CrawledImagePost } from './imagePostEvidenceAnalysis.js';

const item: CrawledImagePost = {
  platform: 'instagram', title: 'Bottle', sourceUrl: 'https://example.test/post/1',
  thumbnailUrl: 'https://example.test/1.png', imageUrls: ['https://example.test/1.png', 'https://example.test/1.png'],
  caption: 'Product', views: '', tags: ['factory'],
};
const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };
const store = { async getById() { return null; }, async update() { return true; } } as unknown as DataStore;
const fetcher = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });

test('crawler analyzer deduplicates image URLs and keeps Qwen primary evidence', async () => {
  let imageCount = 0, fallbackCalls = 0;
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher,
    analyzeQwen: async input => { imageCount = input.images.length; return evidence; },
    analyzeGemini: async () => { fallbackCalls++; return evidence; } });
  const result = await analyzer.analyzeImagePostBestEffort(item, 'bottle');
  assert.equal(result.status, 'analyzed');
  assert.equal(result.provider, 'qwen');
  assert.equal(imageCount, 1);
  assert.equal(fallbackCalls, 0);
});

test('existing Gemini fallback and no-image failure remain unchanged', async () => {
  let fallbackCalls = 0;
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher,
    analyzeQwen: async () => { throw Error('primary failed'); },
    analyzeGemini: async () => { fallbackCalls++; return evidence; } });
  assert.equal((await analyzer.analyzeImagePostBestEffort(item, '')).provider, 'gemini');
  assert.equal(fallbackCalls, 1);
  assert.equal((await analyzer.analyzeImagePostBestEffort({ ...item, imageUrls: [], thumbnailUrl: '' }, '')).status, 'failed');
  assert.equal(fallbackCalls, 1);
});

test('deferred analysis stores provider evidence on the existing record', async () => {
  let resolveUpdate!: (value: Record<string, unknown>) => void;
  const updated = new Promise<Record<string, unknown>>(resolve => { resolveUpdate = resolve; });
  const localStore = { async getById() { return { id: 'record-1', aiAnalysis: '{}' }; },
    async update(_collection: string, _id: string, patch: Record<string, unknown>) { resolveUpdate(patch); return true; } } as unknown as DataStore;
  const analyzer = createImagePostEvidenceAnalyzer({ store: localStore, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher, analyzeQwen: async () => evidence });
  analyzer.queueImagePostAnalysis('record-1', item, '');
  const patch = await updated;
  assert.equal(patch.status, 'analyzed');
  const analysis = JSON.parse(String(patch.aiAnalysis));
  assert.equal(analysis.analysisSource, 'qwen-image-evidence-v2');
  assert.equal(analysis.imageEvidence.observedFacts[0].subjects[0], 'bottle');
});
