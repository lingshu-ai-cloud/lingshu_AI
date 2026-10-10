import assert from 'node:assert/strict';
import { allocateAigcBudget, planAigcShotBatch, requiredAigcAssetRoles, type AigcShotInput } from './aigcShotPlanning.js';

const product = { role: 'product_identity' as const, assetId: 'product-1', version: 'v2', source: 'knowledge_base' as const };
const composition = { role: 'composition_reference' as const, assetId: 'frame-1', version: 'v1', source: 'reference_video' as const };
const shot = (overrides: Partial<AigcShotInput> = {}): AigcShotInput => ({
  shotId: 'shot-1', type: 'product_live_action', mode: 'viral_replication', description: 'hand holds product',
  originalDurationSeconds: 6, selectedSource: 'intelligent_generation', assets: [product, composition],
  observedAction: 'hand lifts the product', ...overrides,
});
const offers = [{ modelId: 'video-a', resolutions: ['480p', '720p'] as const, minDurationSeconds: 4, maxDurationSeconds: 8,
  firstFrameCostCny: 1, videoCostCnyPerSecond: { '480p': 0.5, '720p': 1 } }];

assert.deepEqual(requiredAigcAssetRoles(shot()), ['product_identity', 'composition_reference']);
assert.deepEqual(requiredAigcAssetRoles(shot({ type: 'factory_scene', mode: 'free_creation' })), []);
assert.deepEqual(requiredAigcAssetRoles(shot({ type: 'factory_scene', mode: 'free_creation', requiresProductIdentity: true, requiresPersonIdentity: true })), ['product_identity', 'person_identity']);
const plan = planAigcShotBatch({ shots: [shot()], offers: [...offers], budgetCny: 10, maxRetries: 1 });
assert.equal(plan.shots[0].status, 'ready');
assert.equal(plan.shots[0].resolutionTier, '480p');
assert.equal(plan.shots[0].targetDurationSeconds, 6);
assert.equal(plan.shots[0].assemblyDurationSeconds, 6);
assert.equal(plan.shots[0].estimatedCostCny, 8);
assert.equal(plan.shots[0].observedAction, 'hand lifts the product');

const mixed = planAigcShotBatch({ shots: [
  shot({ shotId: 'matched', selectedSource: 'matched_material' }),
  shot({ shotId: 'locked', selectedSource: 'locked_material' }),
  shot({ shotId: 'low', priority: 1 }),
  shot({ shotId: 'high', priority: 10 }),
], offers: [...offers], budgetCny: 8 });
assert.equal(mixed.requestedGeneratedShots, 2);
assert.equal(mixed.generatedShotRatio, 0.5);
assert.equal(mixed.plannedGeneratedShotRatio, 0.5);
assert.equal(mixed.plannedGeneratedShots, 2);
assert.deepEqual(mixed.shots.map(item => item.status), ['preserved', 'preserved', 'ready', 'ready']);
assert.deepEqual(mixed.shots.map(item => item.resolutionTier), [null, null, '480p', '480p']);

const limited = planAigcShotBatch({ shots: [shot({ shotId: 'low', priority: 1 }), shot({ shotId: 'high', priority: 10 })],
  offers: [...offers], budgetCny: 4 });
assert.deepEqual(limited.shots.map(item => item.status), ['budget_excluded', 'ready']);
assert.equal(limited.generatedShotRatio, 1);
assert.equal(limited.plannedGeneratedShotRatio, 0.5);
assert.equal(limited.shots[1].resolutionTier, '480p');

const invalid = planAigcShotBatch({ shots: [shot({ assets: [{ ...product, source: 'reference_video' }] })], offers: [...offers], budgetCny: 100 });
assert.equal(invalid.shots[0].status, 'needs_input');
assert.deepEqual(invalid.shots[0].missingAssets, ['product_identity', 'composition_reference']);
assert.equal(invalid.estimatedCostCny, 0);

assert.throws(() => planAigcShotBatch({ shots: [shot(), shot()], offers: [...offers], budgetCny: 10 }), /duplicate/);
const tooLong = planAigcShotBatch({ shots: [shot({ originalDurationSeconds: 16 })], offers: [...offers], budgetCny: 100 });
assert.equal(tooLong.shots[0].status, 'unsupported');
assert.equal(tooLong.shots[0].targetDurationSeconds, 16);
const pinned = allocateAigcBudget({ candidates: [
  { shotId: 'pinned-720', targetDurationSeconds: 4, requestedResolution: '720p' },
  { shotId: 'auto', targetDurationSeconds: 4 },
], offers: [...offers], budgetCny: 9, maxRetries: 0 });
assert.equal(pinned[0].resolutionTier, '720p', 'explicit 720p must never silently downgrade');
assert.equal(pinned[1].resolutionTier, '480p');
const unaffordablePinned = allocateAigcBudget({ candidates: [{ shotId: 'pinned-720', targetDurationSeconds: 4, requestedResolution: '720p' }],
  offers: [...offers], budgetCny: 4, maxRetries: 0 });
assert.equal(unaffordablePinned[0].status, 'budget_excluded');
console.log('aigcShotPlanning tests passed');
