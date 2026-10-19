import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoAiAnalysis } from '../types/index.js';
import { mergeShotClassificationRepair } from './qwen.js';

test('classification repair only fills production classification fields', () => {
  const source: VideoAiAnalysis = {
    theme: '产品演示', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
    scriptDetails15s: [{ time: '0-2s', visual: '手持瓶身靠近镜头', observedFacts: '手与瓶身可见', purpose: '产品开场', dialogue: '', materialType: 'unknown', narrativeRole: 'unknown', classificationEvidence: '', needsReview: true }],
  };
  const repaired = mergeShotClassificationRepair(source, [{ index: 1, materialType: 'product', narrativeRole: 'hook', classificationEvidence: '画面可见手持瓶身靠近镜头', needsReview: false }]);
  assert.equal(repaired.scriptDetails15s?.[0]?.materialType, 'product');
  assert.equal(repaired.scriptDetails15s?.[0]?.narrativeRole, 'hook');
  assert.equal(repaired.scriptDetails15s?.[0]?.visual, source.scriptDetails15s?.[0]?.visual);
  assert.equal(repaired.scriptDetails15s?.[0]?.time, source.scriptDetails15s?.[0]?.time);
  assert.equal(repaired.scriptDetails15s?.[0]?.needsReview, false, 'handoff repair may clear only the explicit review field');
  assert.equal(source.scriptDetails15s?.[0]?.materialType, 'unknown', 'source evidence remains immutable');
});
