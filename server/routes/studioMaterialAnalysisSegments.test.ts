import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisDetailToSegment, productionAnalysisSegments } from './studioMaterialAnalysisSegments.js';

type Detail = Parameters<typeof analysisDetailToSegment>[1];

test('studio material projection retains product/person, OCR and confidence semantics', () => {
  const detail = { time: '0-2.5s', visual: '人物手持清晰产品瓶身', observedFacts: '包装完整',
    onScreenText: 'FACTORY FACTORY Serum', purpose: '展示产品', shot: '大特写',
    beats: [{ action: '拿起' }, { action: '旋转' }], confidence: 0.83 } as Detail;
  const segment = analysisDetailToSegment({ id: 'material-a', duration: 10 }, detail, 0, 0);
  assert.equal(segment.id, 'material-a-segment-1');
  assert.deepEqual([segment.start, segment.end, segment.duration], [0, 2.5, 2.5]);
  assert.deepEqual(segment.subject, ['产品', '人物']);
  assert.equal(segment.action, '拿起 → 旋转');
  assert.equal(segment.productClarity, 'high');
  assert.deepEqual(segment.logoText, ['FACTORY', 'Serum']);
  assert.equal(segment.quality, 83);
  assert.equal(segment.needsReview, false);
});

test('studio production segment cursor and observed facts remain compatible', () => {
  const analysis = { scriptDetails15s: [
    { time: '0-2', visual: '场景', purpose: '开场', observedFacts: '第一幕', confidence: 0.9 },
    { time: '', visual: '产品近景', observedFacts: '第二幕' },
  ] } as Parameters<typeof productionAnalysisSegments>[2];
  const segments = productionAnalysisSegments('material-b', 10, analysis);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end]), [[0, 2], [2, 5]]);
  assert.deepEqual(segments.map(segment => segment.observedFacts), ['第一幕', '第二幕']);
  assert.equal(segments[1]?.needsReview, true);
});

test('studio segment projection clamps confidence and rejects unsupported detail as review', () => {
  const segment = analysisDetailToSegment({ id: 'material-c', duration: 2 },
    { time: '1-9', visual: '背景', confidence: 3, needsReview: true } as Detail, 1, 0);
  assert.equal(segment.end, 2);
  assert.equal(segment.confidence, 1);
  assert.equal(segment.quality, 100);
  assert.equal(segment.needsReview, true);
});
