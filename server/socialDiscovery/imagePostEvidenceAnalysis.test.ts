import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { createImagePostEvidenceAnalyzer, imageAnalysisNetworkBlocked, type CrawledImagePost } from './imagePostEvidenceAnalysis.js';
import { serializeImagePostAnalysis, videoAnalysisOf } from '../lib/videoAnalysisCodec.js';

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
  assert.equal(result.analysis?.productionLabels?.[0]?.kind, 'unknown', 'old analyses without explicit classification never become product-only');
  assert.match(result.analysis?.productionLabels?.[0]?.sourceSha256 || '', /^[a-f0-9]{64}$/);
});

test('stored reference reanalysis reads tenant-scoped original bytes and binds its label to that image', async () => {
  const bytes = Buffer.from([9, 8, 7]);
  let reads = 0;
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url,
    readStoredReference: async (tenantId, url) => {
      assert.equal(tenantId, 'tenant-1');
      assert.equal(url, '/api/overseas/videos/record-1/image/0');
      reads++;
      return { bytes, mimeType: 'image/png' };
    },
    analyzeQwen: async input => {
      assert.equal(input.images[0]?.base64, bytes.toString('base64'));
      return { ...evidence, productionLabels: [{ imageIndex: 1, kind: 'product_only', productPresence: 'present',
        evidence: '可见瓶装产品', confidence: .9, sourceSha256: null, verification: 'unverified' }] };
    },
  });
  const result = await analyzer.analyzeImagePostBestEffort({ ...item, tenantId: 'tenant-1',
    imageUrls: ['/api/overseas/videos/record-1/image/0'] }, '');
  assert.equal(result.status, 'analyzed');
  assert.equal(reads, 1);
  assert.equal(result.analysis?.productionLabels?.[0]?.productPresence, 'present');
  assert.match(result.analysis?.productionLabels?.[0]?.sourceSha256 || '', /^[a-f0-9]{64}$/);
});

test('each image production label is tied to the analyzed bytes; failed images stay unknown', async () => {
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused', normalizeThumbnailUrl: url => url,
    fetcher: async url => String(url).endsWith('/missing.png') ? new Response(null, { status: 404 }) : fetcher(),
    analyzeQwen: async () => ({ ...evidence, productionLabels: [{ imageIndex: 1, kind: 'product_only', evidence: '产品和纯色背景', confidence: .9, sourceSha256: null, verification: 'unverified' }] }) });
  const result = await analyzer.analyzeImagePostBestEffort({ ...item, imageUrls: ['https://example.test/1.png', 'https://example.test/missing.png'] }, '');
  assert.deepEqual(result.analysis?.productionLabels?.map(label => label.kind), ['product_only', 'unknown']);
  assert.equal(result.analysis?.productionLabels?.[1]?.sourceSha256, null);
  const stored = serializeImagePostAnalysis({ contentFormat: 'image', imageEvidence: { ...result.analysis, padding: 'x'.repeat(5000) } });
  const restored = videoAnalysisOf({ aiAnalysis: stored });
  assert.deepEqual((restored.imageEvidence as typeof result.analysis)?.productionLabels, result.analysis?.productionLabels);
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

test('after both providers fail, the caller can retain an unknown-cost state', async () => {
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher,
    analyzeQwen: async () => { throw Error('qwen transport'); },
    analyzeGemini: async () => { throw Error('gemini transport'); } });
  const result = await analyzer.analyzeImagePostBestEffort(item, 'bottle');
  assert.equal(result.status, 'failed');
  assert.equal(result.providerAttempted, true);
});

test('proven pre-dispatch isolation denial is retryable after service recovery, without fallback', async () => {
  let fallbackCalls = 0;
  const blocked = Object.assign(Error('isolated_test_network_blocked'), { code: 'ISOLATED_NETWORK_BLOCKED' });
  const wrapped = new Error('Connection error.', { cause: blocked });
  assert.equal(imageAnalysisNetworkBlocked(wrapped), true);
  assert.equal(imageAnalysisNetworkBlocked(Error('Connection error.')), false);
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher,
    analyzeQwen: async () => { throw wrapped; },
    analyzeGemini: async () => { fallbackCalls++; return evidence; } });
  const result = await analyzer.analyzeImagePostBestEffort(item, 'bottle');
  assert.equal(result.error, 'image_post_analysis_network_blocked');
  assert.equal(result.providerAttempted, false);
  assert.equal(fallbackCalls, 0);
});

test('supplier model rejection is a known failure and never silently switches suppliers', async () => {
  let fallbackCalls = 0;
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, fetcher,
    analyzeQwen: async () => { throw Object.assign(Error('Model not exist.'), { status: 404 }); },
    analyzeGemini: async () => { fallbackCalls++; return evidence; } });
  const result = await analyzer.analyzeImagePostBestEffort(item, 'bottle');
  assert.equal(result.error, 'image_post_analysis_model_unavailable');
  assert.equal(result.providerRejected, true);
  assert.equal(result.providerAttempted, true);
  assert.equal(fallbackCalls, 0);
});

test('selected carousel analysis reads and submits only the original fourth image and retains index four', async () => {
  const reads: string[] = [];
  const analyzer = createImagePostEvidenceAnalyzer({ store, collection: 'trend_videos', mediaDir: '/unused',
    normalizeThumbnailUrl: url => url, readStoredReference: async (_tenantId, url) => {
      reads.push(url); return { bytes: Buffer.from('fourth-image'), mimeType: 'image/png' };
    }, analyzeQwen: async input => {
      assert.deepEqual(input.images.map(image => image.imageIndex), [4]);
      return { ...evidence, observedFacts: [{ ...evidence.observedFacts[0], imageIndex: 4 }],
        productionLabels: [{ imageIndex: 4, kind: 'product_only', productPresence: 'present',
          evidence: '可见气垫产品', confidence: .99, sourceSha256: null, verification: 'unverified' }] };
    } });
  const result = await analyzer.analyzeImagePostBestEffort({ ...item, tenantId: 'tenant-1', analysisImageIndex: 4,
    imageUrls: [0,1,2,3].map(index => `/api/overseas/videos/post/image/${index}`) }, '');
  assert.deepEqual(reads, ['/api/overseas/videos/post/image/3']);
  assert.deepEqual(result.analysis?.productionLabels?.map(label => label.imageIndex), [4]);
  assert.equal(result.analysis?.productionLabels?.[0]?.productPresence, 'present');
  const invalid = await analyzer.analyzeImagePostBestEffort({ ...item, analysisImageIndex: 9 }, '');
  assert.equal(invalid.error, 'image_post_analysis_selection_invalid');
  assert.equal(reads.length, 1);
});
