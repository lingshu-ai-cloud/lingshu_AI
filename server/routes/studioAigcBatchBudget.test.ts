import assert from 'node:assert/strict';
import { studioAigcBatchBudgetPreview, studioAigcBudgetConfigForSpec, studioAigcBudgetConfigFromEnv, studioAigcBudgetPreviewForSpec, storyboardBudgetSegmentDurations, storyboardBudgetConfirmedStageDurations } from './studioAigcBatchBudget.js';
import type { StudioBatchShotRoute } from './studioBatchShotRoutes.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';

const route = (shotId: string, kind: StudioBatchShotRoute['route']): StudioBatchShotRoute => ({
  shotId, slotId: shotId, order: 1, visualTopic: 'product', expressionPurpose: '', route: kind,
  status: kind === 'aigc_first_frame' ? 'needs_plan' : 'matched', matchedMaterialId: null,
  matchedSegmentId: null, trimStart: null, trimEnd: null, reason: '', generated: false,
});
const mixed = [route('locked', 'local_material'), route('a', 'aigc_first_frame'), route('b', 'aigc_first_frame')];
const preview = studioAigcBatchBudgetPreview(mixed, { firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 30, modelId: 'seedance' });
assert.equal(preview.aigcShots, 2);
assert.equal(preview.aigcShotRatio, 0.67);
assert.equal(preview.candidateDurationSeconds, 4);
assert.equal(preview.estimate480pCny, 15.6);
assert.equal(preview.estimate720pCny, 25.2);
assert.equal(preview.recommendedResolution, '720p');
assert.equal(studioAigcBatchBudgetPreview(mixed, { firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 16, modelId: 'seedance' }).recommendedResolution, '480p');
const durationAware = studioAigcBatchBudgetPreview(mixed, {
  firstFrameCostCny: 0.3, maxRetries: 0, batchBudgetCny: 12, modelId: 'seedance',
  slots: [{ id: 'a', duration: 6, priority: 10 }, { id: 'b', duration: 4, priority: 1 }],
});
assert.equal(durationAware.shotPlans.find(plan => plan.shotId === 'a')?.targetDurationSeconds, 6);
assert.equal(durationAware.shotPlans.find(plan => plan.shotId === 'a')?.status, 'ready');
assert.equal(durationAware.shotPlans.find(plan => plan.shotId === 'b')?.status, 'ready');
assert.equal(durationAware.estimatedCostCny, 9.6);
const overlong = studioAigcBatchBudgetPreview([route('long', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 100, modelId: 'seedance', slots: [{ id: 'long', duration: 18 }],
});
assert.equal(overlong.shotPlans[0]?.status, 'unsupported');
assert.deepEqual(storyboardBudgetSegmentDurations(18), [14, 4]);
const usage = { ...route('use', 'aigc_first_frame'), visualTopic: 'usage_scene' as const };
const segmented = studioAigcBatchBudgetPreview([usage], {
  firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 100, modelId: 'seedance', slots: [{ id: 'use', duration: 18 }],
});
assert.equal(segmented.shotPlans[0]?.status, 'ready');
assert.deepEqual(segmented.shotPlans[0]?.segmentDurations, [14, 4]);
assert.equal(segmented.estimate480pCny, 33);
const confirmedAction = { sceneType: 'usage', actionStartState: '准备安装', actionBeats: '取出灯具；对准安装位；固定灯具',
  actionKeyStates: '灯具已取出；灯具已对准', actionEndState: '灯具已固定' };
assert.deepEqual(storyboardBudgetConfirmedStageDurations(12, confirmedAction), [4, 4, 4]);
assert.deepEqual(storyboardBudgetConfirmedStageDurations(12.5, confirmedAction), [5, 5, 5]);
assert.equal(storyboardBudgetConfirmedStageDurations(8, confirmedAction), null);
const shortStages = studioAigcBatchBudgetPreview([usage], {
  firstFrameCostCny: 0.3, maxRetries: 0, batchBudgetCny: 100, modelId: 'seedance',
  slots: [{ id: 'use', duration: 12.5 }], actionPlans: { use: confirmedAction },
});
assert.deepEqual(shortStages.shotPlans[0]?.segmentDurations, [5, 5, 5]);
assert.equal(shortStages.shotPlans[0]?.targetDurationSeconds, 13);
const cloneWithObserver = studioAigcBatchBudgetPreview([route('clone-shot', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, cloneGeometryObservationCostCny: 0.2, creationMode: 'clone',
  maxRetries: 1, batchBudgetCny: 30, modelId: 'seedance',
});
assert.equal(cloneWithObserver.shotPlans[0]?.estimatedFirstFrameCostCny, 0.5);
assert.equal(cloneWithObserver.shotPlans[0]?.estimatedGeometryObservationCostCny, 0.2);
assert.equal(cloneWithObserver.estimate480pCny, 8.2);
const freeWithObserverEnabled = studioAigcBatchBudgetPreview([route('free-shot', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, cloneGeometryObservationCostCny: 0.2, creationMode: 'free_creation',
  maxRetries: 1, batchBudgetCny: 30, modelId: 'seedance',
});
assert.equal(freeWithObserverEnabled.shotPlans[0]?.estimatedFirstFrameCostCny, 0.3);
assert.equal(studioAigcBudgetConfigForSpec({ automation: { managedBy: 'digital_employee' },
  contentOrder: { operatingContext: { estimatedContentCost: 12.5 } } }).batchBudgetCny, 12.5,
'managed production uses the already-frozen per-content estimate instead of the 30 yuan environment default');
assert.equal(studioAigcBudgetConfigForSpec({ automation: { managedBy: 'digital_employee' },
  contentOrder: { operatingContext: { estimatedContentCost: 12.5 } } }, 8).batchBudgetCny, 8,
'a native request may lower but never raise the frozen limit');
assert.equal(studioAigcBudgetConfigForSpec({ automation: { managedBy: 'digital_employee' } }).batchBudgetCny, 0,
'managed production without a frozen order limit fails closed');
const ledgerAware = studioAigcBatchBudgetPreview([route('done', 'local_material'), route('next', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 12.5, usedCostCny: 3.9, modelId: 'seedance', preferredResolution: '480p',
});
assert.equal(ledgerAware.aigcShots, 1, 'completed verified materials do not receive a second generation allocation');
assert.equal(ledgerAware.batchBudgetCny, 12.5, 'the frozen limit is not changed');
assert.equal(ledgerAware.budgetUsedCny, 3.9, 'completed/reserved/uncertain allocations stay counted, not refunded');
assert.equal(ledgerAware.availableBudgetCny, 8.6);
assert.equal(ledgerAware.estimatedCostCny, 7.8);
assert.equal(ledgerAware.budgetRemainingCny, 0.8);
assert.equal(ledgerAware.shotPlans[0].status, 'ready');
const insufficient = studioAigcBatchBudgetPreview([route('next', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 12.5, usedCostCny: 5.7, modelId: 'seedance',
});
assert.equal(insufficient.availableBudgetCny, 6.8);
assert.equal(insufficient.shotPlans[0].status, 'budget_excluded');
assert.equal(insufficient.budgetEnoughFor480p, false);
for (const usedCostCny of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
  const invalid = studioAigcBatchBudgetPreview([route('next', 'aigc_first_frame')], {
    firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 12.5, usedCostCny, modelId: 'seedance',
  });
  assert.equal(invalid.budgetEvidenceValid, false);
  assert.equal(invalid.availableBudgetCny, 0);
  assert.equal(invalid.shotPlans[0].status, 'budget_excluded');
}
const noTrustedLedger = studioAigcBudgetPreviewForSpec({ automation: { managedBy: 'digital_employee' },
  shootingSlots: [{ id: 's', duration: 4 }], storyboardSourcePlans: { s: { mode: 'ai' } },
}, { firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 12.5, modelId: 'seedance' });
assert.equal(noTrustedLedger.budgetEvidenceValid, false, 'managed generation requires a trusted current native ledger');
assert.equal(noTrustedLedger.readyShots, 0);
const productComposite = studioAigcBatchBudgetPreview([route('product', 'aigc_first_frame')], {
  firstFrameCostCny: 0.3, maxRetries: 1, batchBudgetCny: 30, modelId: 'seedance', firstFrameCallCounts: { product: 2 },
  preferredResolution: '480p',
});
assert.equal(productComposite.shotPlans[0].estimatedFirstFrameCostCny, 0.6, 'native reservation receives the full two-call first-frame cost');
assert.equal(productComposite.shotPlans[0].firstFrameCallCount, 2);
assert.equal(productComposite.shotPlans[0].firstFrameOverheadCny, 0.3);
assert.equal(productComposite.estimate480pCny, 8.4);
const frameSpec = { automation: { managedBy: 'digital_employee' }, mode: 'clone', ratio: '9:16',
  shootingSlots: [{ id: 'shot', slotId: 'slot', duration: 4, detail: '产品展示' }],
  storyboardSourcePlans: { slot: { mode: 'ai', sceneType: 'product' as const, productIds: ['product'] } },
  automatedReplicationProgress: { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fingerprint' } },
  automatedReplicationShots: [{ shotId: 'shot', slotId: 'slot', kind: 'nonperson', start: 0, end: 4,
    firstFrameRequest: { projectId: 'project', sceneType: 'product', sourceFirstFrameUrl: '/source.jpg', productIds: ['product'] } }],
};
const frameHash = 'f'.repeat(64);
const frameContext = { tenantId: 'tenant', projectId: 'project', usedCny: 0.6, verifiedContentSha256ByMaterialId: {},
  verifiedFirstFrameContentSha256ByMaterialId: { frame: frameHash }, materials: [{ id: 'frame', tenantId: 'tenant', type: 'image', scope: 'own',
    sourceType: 'ai-storyboard-first-frame', provenance: { projectId: 'project', shotId: 'slot', fingerprint: 'frame-fingerprint',
      projectShotFingerprint: storyboardProjectShotInput(frameSpec, 'slot')!.fingerprint, confirmed: true,
      firstFrameQualityInput: { sourceSha256: frameHash }, firstFrameQuality: { phase: 'first_frame', status: 'passed', passed: true } } }] };
const frameBudget = { firstFrameCostCny: 0.3, cloneGeometryObservationCostCny: 0.2, maxRetries: 0, batchBudgetCny: 12.5, modelId: 'seedance', preferredResolution: '480p' as const };
const reusedFrame = studioAigcBudgetPreviewForSpec(frameSpec, frameBudget, frameContext);
assert.equal(reusedFrame.shotPlans[0].firstFrameCallCount, 0);
assert.equal(reusedFrame.shotPlans[0].estimatedFirstFrameCostCny, 0);
assert.equal(reusedFrame.shotPlans[0].estimatedGeometryObservationCostCny, 0);
assert.equal(reusedFrame.shotPlans[0].estimatedVideoCostCny, 3.6);
assert.equal(reusedFrame.budgetUsedCny, 0.6, 'retaining the image never refunds the original ledger allocation');
assert.equal(reusedFrame.availableBudgetCny, 11.9);
const unverifiedFrame = studioAigcBudgetPreviewForSpec(frameSpec, frameBudget, { ...frameContext, verifiedFirstFrameContentSha256ByMaterialId: {} });
assert.equal(unverifiedFrame.shotPlans[0].firstFrameCallCount, 2, 'a frame ID without actual validated bytes is not a free reusable image');
assert.equal(unverifiedFrame.shotPlans[0].estimatedFirstFrameCostCny, 0.8, 'two image calls plus one geometry observation');
const staleFrame = studioAigcBudgetPreviewForSpec({ ...frameSpec, ratio: '16:9' }, frameBudget, frameContext);
assert.equal(staleFrame.shotPlans[0].firstFrameCallCount, 2, 'changed shot inputs invalidate zero-cost frame reuse');
const crossTenantFrame = structuredClone(frameContext); crossTenantFrame.materials[0].tenantId = 'other';
assert.equal(studioAigcBudgetPreviewForSpec(frameSpec, frameBudget, crossTenantFrame).shotPlans[0].firstFrameCallCount, 2);
const legacyFrameSpec = { ...frameSpec, automation: undefined, automatedReplicationProgress: undefined,
  automatedReplicationShots: undefined,
  storyboardSourcePlans: { slot: { ...frameSpec.storyboardSourcePlans.slot, firstFrameMaterialId: 'frame' } } };
const legacyReuse = studioAigcBudgetPreviewForSpec(legacyFrameSpec, frameBudget, frameContext);
assert.equal(legacyReuse.shotPlans[0].firstFrameCallCount, 0, 'legacy source-plan images reuse the same trusted byte and project proof');
assert.equal(legacyReuse.budgetUsedCny, 0.6, 'legacy projects also retain prior native cost when the caller supplies the ledger');
assert.equal(studioAigcBudgetPreviewForSpec({ shootingSlots: [{ id: 'legacy', duration: 4 }],
  storyboardSourcePlans: { legacy: { mode: 'ai' } } }, frameBudget).budgetEvidenceValid, true,
'non-managed planning keeps its legacy no-context behavior');
const selectedOnlyProduct = { ...frameSpec, automatedReplicationProgress: undefined, automatedReplicationShots: undefined,
  selectedProductIds: ['product'], storyboardSourcePlans: { slot: { mode: 'ai', sceneType: 'product' as const, productIds: [] } },
  videoKickoff: { referenceAnalysis: { details: [{ shotId: 'slot', firstFrameRef: '/source.jpg' }] } } };
assert.equal(studioAigcBudgetPreviewForSpec(selectedOnlyProduct, frameBudget, { ...frameContext,
  verifiedFirstFrameContentSha256ByMaterialId: {} }).shotPlans[0].firstFrameCallCount, 2,
'an empty per-shot array must not hide the selected product and underquote two native image calls');
const oldGeometryEnabled = process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED;
const oldGeometryCost = process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY;
try {
  process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED = 'true';
  process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY = '0.2';
  assert.equal(studioAigcBudgetConfigFromEnv().cloneGeometryObservationCostCny, 0.2);
  process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY = '0';
  assert.throws(() => studioAigcBudgetConfigFromEnv(), /费用配置无效/);
} finally {
  if (oldGeometryEnabled === undefined) delete process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED;
  else process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED = oldGeometryEnabled;
  if (oldGeometryCost === undefined) delete process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY;
  else process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY = oldGeometryCost;
}
