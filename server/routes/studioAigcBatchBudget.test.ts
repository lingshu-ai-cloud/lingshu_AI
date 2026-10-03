import assert from 'node:assert/strict';
import { studioAigcBatchBudgetPreview, studioAigcBudgetConfigFromEnv, storyboardBudgetSegmentDurations, storyboardBudgetConfirmedStageDurations } from './studioAigcBatchBudget.js';
import type { StudioBatchShotRoute } from './studioBatchShotRoutes.js';

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
