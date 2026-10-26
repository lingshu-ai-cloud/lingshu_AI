import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  measureSocialSourceCaptionOccupancy,
  mergeSocialSourceTextReviews,
} from './socialSourceCaptionOccupancy.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import type { SocialSourceTextReview } from './socialSourceTextReview.js';

const asset = (overrides: Partial<SocialProductionAsset> = {}): SocialProductionAsset => ({
  id: 'asset', name: 'source', type: 'video', sourceId: 'source', url: '/source.mp4',
  localPath: '/source.mp4', duration: 10, visualObservations: [], segments: [], ...overrides,
});
const base = {
  assets: [asset()],
  scenes: [{ sceneId: 'scene', source: { assetId: 'asset', sourceStart: 2, sourceEnd: 8 } }],
  timeline: [{ sceneId: 'scene', targetStart: 10, targetEnd: 14, trimStart: 4, trimEnd: 8 }],
  captionCues: [{ start: 11, end: 12, text: 'target caption' }],
};

test('maps measured source occupancy into the frozen target timeline and selects upper placement', async () => {
  const result = await measureSocialSourceCaptionOccupancy({ ...base, analyzeAsset: async () => ({
    captionOccupancy: [{ id: 'caption', startMs: 4500, endMs: 6500, boxes: [{ x: .1, y: .7, width: .8, height: .12 }],
      confidence: .8, source: 'ocr', editable: false }],
  }) });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    sceneId: 'scene', assetId: 'asset', sourceStart: 4.5, sourceEnd: 6.5, targetStart: 10.5, targetEnd: 12.5,
    text: '', source: 'measured_caption_occupancy', spatialStatus: 'measured', status: 'avoided',
    boxes: [{ x: .1, y: .7, width: .8, height: .12 }], placementDecision: 'upper',
    evidenceVersion: 'studio-caption-occupancy.v1',
  });
});

test('keeps the default caption band when only the upper band is occupied', async () => {
  const [review] = await measureSocialSourceCaptionOccupancy({ ...base, analyzeAsset: async () => ({
    captionOccupancy: [{ id: 'caption', startMs: 4500, endMs: 6500, boxes: [{ x: .1, y: .15, width: .8, height: .1 }],
      confidence: .8, source: 'ocr', editable: false }],
  }) });
  assert.equal(review?.placementDecision, 'default');
  assert.equal(review?.status, 'avoided');
});

test('requires review when both stable caption bands are occupied', async () => {
  const [review] = await measureSocialSourceCaptionOccupancy({ ...base, analyzeAsset: async () => ({
    captionOccupancy: [{ id: 'caption', startMs: 4500, endMs: 6500,
      boxes: [{ x: .1, y: .15, width: .8, height: .1 }, { x: .1, y: .7, width: .8, height: .1 }],
      confidence: .8, source: 'ocr', editable: false }],
  }) });
  assert.equal(review?.placementDecision, 'unresolved');
  assert.equal(review?.status, 'review_required');
});

test('analyzes only used local video assets and degrades to the existing unmeasured path on failure', async () => {
  const analyzed: string[] = [];
  const result = await measureSocialSourceCaptionOccupancy({ ...base,
    assets: [asset(), asset({ id: 'unused' }), asset({ id: 'image', type: 'image' }), asset({ id: 'remote', localPath: undefined })],
    analyzeAsset: async value => { analyzed.push(value.id); throw new Error('analysis unavailable'); },
  });
  assert.deepEqual(analyzed, ['asset']);
  assert.deepEqual(result, []);
});

test('measured evidence supersedes only overlapping unmeasured evidence for the same scene', () => {
  const unmeasured: SocialSourceTextReview[] = [
    { sceneId: 'scene', assetId: 'asset', sourceStart: 4, sourceEnd: 6, targetStart: 10, targetEnd: 12,
      text: 'hint', source: 'analysis_on_screen_text', spatialStatus: 'unmeasured', status: 'review_required' },
    { sceneId: 'other', assetId: 'other', sourceStart: 0, sourceEnd: 1, targetStart: 20, targetEnd: 21,
      text: 'other', source: 'analysis_on_screen_text', spatialStatus: 'unmeasured', status: 'review_required' },
  ];
  const measured: SocialSourceTextReview[] = [{ sceneId: 'scene', assetId: 'asset', sourceStart: 4, sourceEnd: 6,
    targetStart: 10.5, targetEnd: 11.5, text: 'measured', source: 'measured_caption_occupancy',
    spatialStatus: 'measured', status: 'avoided', placementDecision: 'upper' }];
  assert.deepEqual(mergeSocialSourceTextReviews(unmeasured, measured), [measured[0], unmeasured[1]]);
});
