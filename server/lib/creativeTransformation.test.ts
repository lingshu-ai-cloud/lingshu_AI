import assert from 'node:assert/strict';
import { assessMaterialCandidate, assessTransformation, buildPersonExecutionStrategy, commercialDigitalHumanGate, type ShotRequirement } from './creativeTransformation.js';

const proofShot: ShotRequirement = {
  id: 'proof-1', purpose: 'proof', narration: '工厂每天交付一万件', requiredEvidence: ['工厂实拍'],
  truthCritical: true, presenterAllowed: false, aiVisualAllowed: false, targetDurationSeconds: 3, targetRatio: '9:16',
};
const fakeProof = assessMaterialCandidate(proofShot, {
  id: 'ai-factory', semanticScore: 40, evidenceScore: 25, actionScore: 15, durationScore: 10, formatScore: 10,
  isAuthenticEvidence: false, rightsCleared: true,
});
assert.equal(fakeProof.decision, 'blocked');
assert.equal(fakeProof.allowedFallbacks.includes('digital_human'), false);

const product = assessTransformation({
  mode: 'product_replace',
  rights: { referenceVideo: 'cleared', sourcePerson: 'not_required', targetPerson: 'not_required', voice: 'not_required', productBrand: 'cleared' },
  source: { personCount: 1, continuousShot: true, durationSeconds: 8, productCount: 1, productVisibleRatio: 0.95, gripSimilarity: 0.9 },
});
assert.equal(product.status, 'compatible');

const unsafeSwap = assessTransformation({
  mode: 'face_swap',
  rights: { referenceVideo: 'unknown', sourcePerson: 'unknown', targetPerson: 'unknown', voice: 'not_required', productBrand: 'not_required' },
  source: { personCount: 1, faceForwardRatio: 0.9, maximumOcclusionRatio: 0.1 },
});
assert.equal(unsafeSwap.status, 'blocked');
assert.equal(unsafeSwap.recommendedMode, 'structure_remake');

assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.862, avOffsetFrames: 2, freezeSegments: 0 }, 'quality').passed, false);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 7.5, avOffsetFrames: 1, freezeSegments: 0 }, 'quality').passed, true);

const externalAuto = buildPersonExecutionStrategy({
  requestedMode: 'auto', sourceKind: 'external_reference', targetDurationSeconds: 5,
  rights: { referenceVideo: 'not_required', sourcePerson: 'not_required', targetPerson: 'cleared', voice: 'not_required', productBrand: 'not_required' },
  source: { personCount: 1, continuousShot: true, durationSeconds: 5 },
});
assert.equal(externalAuto.mode, 'creative');
assert.equal(externalAuto.feasibility, 'functional_equivalent');

const blockedDirectEdit = buildPersonExecutionStrategy({
  requestedMode: 'fast', sourceKind: 'external_reference', targetDurationSeconds: 5,
  rights: { referenceVideo: 'not_required', sourcePerson: 'not_required', targetPerson: 'cleared', voice: 'not_required', productBrand: 'not_required' },
  source: { personCount: 1, continuousShot: true, durationSeconds: 5, faceForwardRatio: 0.95, maximumOcclusionRatio: 0.05 },
});
assert.equal(blockedDirectEdit.status, 'blocked');
assert.equal(blockedDirectEdit.estimatedCredits, 0);

const authorizedExpert = buildPersonExecutionStrategy({
  requestedMode: 'expert', sourceKind: 'licensed_asset', targetDurationSeconds: 5, budgetCredits: 30,
  rights: { referenceVideo: 'cleared', sourcePerson: 'cleared', targetPerson: 'cleared', voice: 'cleared', productBrand: 'not_required' },
  source: { personCount: 1, continuousShot: true, durationSeconds: 5 },
});
assert.equal(authorizedExpert.status, 'review');
assert.equal(authorizedExpert.estimatedCredits, 25);
console.log('creative transformation policy tests passed');
