import assert from 'node:assert/strict';
import { materialAnalysisTokenBudget, normalizeQwenQualityScore, QWEN_SHOT_CLASSIFICATION_FIELDS } from './qwen.js';
import { imageEvidenceReviewReasons, normalizeImageLayerBlueprints, type ImagePostEvidenceAnalysis } from './qwenContracts.js';

assert.equal(normalizeQwenQualityScore(9), 90);
assert.equal(normalizeQwenQualityScore('8.5'), 85);
assert.equal(normalizeQwenQualityScore(86), 86);
assert.equal(normalizeQwenQualityScore(120), 100);
assert.equal(normalizeQwenQualityScore(-2), 0);
assert.equal(normalizeQwenQualityScore('not-a-score'), 0);
assert.equal(materialAnalysisTokenBudget(8), 2400);
assert.equal(materialAnalysisTokenBudget(48), 6720, 'long factory reels need enough output room for complete JSON');
assert.equal(materialAnalysisTokenBudget(100), 7200, 'material analysis output remains bounded');
assert.deepEqual(QWEN_SHOT_CLASSIFICATION_FIELDS, ['materialType', 'narrativeRole', 'classificationEvidence'],
  'every explicit Qwen shot schema must request evidence-backed production classification');
const blueprints = normalizeImageLayerBlueprints([{ imageIndex: 1, layers: [], masks: [{
  id: 'observed', shape: 'polygon', bounds: { x: -.2, y: .1, width: 2, height: .8 },
  opacity: 4, color: 'red" onload="evil', points: [null, { x: .2, y: .3 }, { x: .4, y: .3 }, { x: .3, y: .4 }], zIndex: 3,
}] }], 1);
assert.deepEqual(blueprints[0]?.masks[0]?.bounds, { x: 0, y: .1, width: 1, height: .8 });
assert.equal(blueprints[0]?.masks[0]?.color, undefined);
assert.equal(blueprints[0]?.masks[0]?.opacity, 1);
assert.equal(blueprints[0]?.masks[0]?.points?.length, 3);

const evidence: ImagePostEvidenceAnalysis = {
  version: 2, status: 'analyzed', observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: ['white'], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [],
  layerBlueprints: [{ imageIndex: 1, layers: [{ id: 'bg', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: .9 }], masks: [] }], uncertainties: [],
};
assert.deepEqual(imageEvidenceReviewReasons(evidence, 1), []);
assert.deepEqual(imageEvidenceReviewReasons({ ...evidence, layerBlueprints: [] }, 1), ['missing_layer_blueprints']);
assert.deepEqual(imageEvidenceReviewReasons({ ...evidence, observedFacts: [] }, 1), ['missing_image_facts']);

console.log('qwen quality score normalization tests passed');
