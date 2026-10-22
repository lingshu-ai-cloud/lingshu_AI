import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { recordsToVideos, specialRecommendationForVideo, supplyItemsToVideos } from './inspirationVideoProjection';

test('crawler projection keeps collected image evidence, deduplicates source, and labels metadata fallback honestly', () => {
  const items = recordsToVideos([
    { id: 'image-a', platform: 'instagram', title: '图文', sourceUrl: 'https://www.instagram.com/p/abc/',
      aiAnalysis: JSON.stringify({ contentFormat: 'image', imageUrls: ['https://cdn.example/image.jpg'], views: '1.2k' }) },
    { id: 'image-b', platform: 'instagram', title: '重复图文', sourceUrl: 'https://www.instagram.com/p/abc/',
      aiAnalysis: JSON.stringify({ contentFormat: 'image', imageUrls: ['https://cdn.example/other.jpg'] }) },
    { id: 'video-a', platform: 'youtube', title: '待分析视频', sourceUrl: 'https://www.youtube.com/watch?v=abc', duration: 18 },
  ]);
  assert.equal(items.length, 2);
  const image = items.find(item => item.recordId === 'image-a')!;
  assert.equal(image.contentFormat, 'image');
  assert.equal(image.thumbnail, 'https://cdn.example/image.jpg');
  assert.equal(image.aiAnalysis?.gemini, undefined, 'image evidence must not be replaced by a video metadata template');
  const video = items.find(item => item.recordId === 'video-a')!;
  assert.equal(video.aiAnalysis?.analysisSource, 'metadata-fallback');
  assert.equal(video.aiAnalysis?.analysisQuality, 'metadata');
});

test('supply projection rejects unsupported platform before mapping candidate data', () => {
  const items = supplyItemsToVideos([
    { platform: 'unsupported', candidateId: 'foreign', title: 'foreign', sourceUrl: 'https://example.com', score: { scoredAt: '2026-10-22T00:00:00Z' } },
  ] as Parameters<typeof supplyItemsToVideos>[0]);
  assert.deepEqual(items, []);
});

test('special account recommendation requires eight measurable peers and real source identity', () => {
  const base: TrendVideo = { id: 'current', platform: 'youtube', title: '视频', thumbnail: '', tags: [],
    views: '10000', duration: 15, trend: 'stable', contentFormat: 'video',
    aiAnalysis: { sourceAccount: 'account-1', accountBaselineLevel: 'low' } };
  const peers = Array.from({ length: 8 }, (_, index) => ({ ...base, id: `peer-${index}`, views: '1000' }));
  assert.equal(specialRecommendationForVideo(base, peers.slice(0, 7), []), null);
  assert.equal(specialRecommendationForVideo({ ...base, aiAnalysis: {} }, peers, []), null);
  const recommendation = specialRecommendationForVideo(base, peers, []);
  assert.equal(recommendation?.level, '极高');
  assert.equal(recommendation?.multiple, 10);
});
