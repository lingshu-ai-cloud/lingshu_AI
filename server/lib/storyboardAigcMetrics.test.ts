import assert from 'node:assert/strict';
import { storyboardAigcMetrics } from './storyboardAigcMetrics.js';

const empty = storyboardAigcMetrics([], []);
assert.equal(empty.firstFrameFirstPassRate, null);
assert.equal(empty.videoAdoptionRate, null);
const report = { passed: true, reasonCodes: [], checks: { action_order: { verdict: 'pass' }, end_state: { verdict: 'pass' } } };
const result = storyboardAigcMetrics([
  { id: 'frame-a', sourceType: 'ai-storyboard-first-frame', createdAt: '2026-10-03T00:00:00Z', provenance: { shotId: 'a', firstFrameQuality: { passed: true }, estimatedCostCny: 0.3, generationLatencyMs: 5000 } },
  { id: 'frame-b', sourceType: 'ai-storyboard-first-frame', createdAt: '2026-10-03T00:00:01Z', provenance: { shotId: 'b', firstFrameQuality: { passed: false }, estimatedCostCny: 0.3 } },
  { id: 'video-a', sourceType: 'ai-seedance', createdAt: '2026-10-03T00:01:00Z', provenance: { storyboardAigc: true, shotId: 'a', storyboardQualityReport: report, estimatedCostCny: 4 } },
  { id: 'video-b', sourceType: 'ai-seedance', createdAt: '2026-10-03T00:01:01Z', provenance: { storyboardAigc: true, shotId: 'a', storyboardQualityReport: { reasonCodes: ['PRODUCT_IDENTITY_FAILED'], checks: {} }, estimatedCostCny: 4 } },
], ['video-a']);
assert.equal(result.firstFrameFirstPassRate, 0.5);
assert.equal(result.videoAdoptionRate, 0.5);
assert.equal(result.productIdentityErrorRate, 0.5);
assert.equal(result.actionCompletionRate, 1);
assert.equal(result.averageVideoAttemptsPerShot, 2);
assert.equal(result.estimatedCostCny, 8.6);
console.log('storyboardAigcMetrics tests passed');
