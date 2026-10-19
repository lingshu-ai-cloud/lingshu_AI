import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialProductionExecutorCheckpoint, socialProductionExecutor, socialProductionGraphInput } from '../server/starter198/socialContentProductionGraph.js';

function detail() {
  return { version: '3', mode: 'instant', brief: { productionApproach: 'material_cut' }, sources: [], assetSupplyPlan: {},
    agentWorkflow: { directorBrief: { version: '3', scenes: [{ sceneId: 'scene-1', voiceover: 'approved words' }] },
      executionPlan: { version: '3', directorBriefVersion: '3', scenes: [{ sceneId: 'scene-1', selectedSourceStrategy: 'customer_real_asset',
        idempotencyKey: 'derived-3', candidates: [{ candidateId: 'source-1', provenance: { inputVersion: '3', authorizationRef: 'tenant-source-1' } }] }] },
      executionPlanReview: { version: '3', executionPlanVersion: '3', directorBriefVersion: '3', reviewId: 'derived-review-3', approved: true, sceneResults: [] },
      productionResult: null, replicationEvaluation: null } } as any;
}

test('historic jobs without a binding stay legacy; selected graph bindings fail closed on corruption', () => {
  assert.equal(socialProductionExecutor({ checkpoints: {} } as any), 'legacy');
  assert.throws(() => socialProductionExecutor({ checkpoints: {} } as any, { 'social.executor': { invalid: true } }), /binding_invalid/);
  assert.throws(() => socialProductionExecutor({ checkpoints: { 'langgraph.v1': {} } } as any), /binding_invalid/);
  const binding = createSocialProductionExecutorCheckpoint(detail(), { SOCIAL_CONTENT_EXECUTOR: 'langgraph' });
  assert.equal(socialProductionExecutor({ checkpoints: { 'social.executor': binding } } as any), 'langgraph');
  assert.throws(() => socialProductionExecutor({ checkpoints: { 'social.executor': { ...binding, inputHash: 'tampered' } } } as any), /binding_invalid/);
  assert.equal(createSocialProductionExecutorCheckpoint(detail(), {}).payload.executor, 'langgraph');
  assert.equal(createSocialProductionExecutorCheckpoint({ ...detail(), mode: 'instant' }, {}).payload.executor, 'legacy');
});

test('task projection versions may advance; approved words, routes and review cannot drift', () => {
  const frozen = detail(), latest = structuredClone(frozen);
  latest.version = '4'; latest.agentWorkflow.directorBrief.version = '4';
  Object.assign(latest.agentWorkflow.executionPlan, { version: '4', directorBriefVersion: '4' });
  latest.agentWorkflow.executionPlan.scenes[0].idempotencyKey = 'derived-4';
  latest.agentWorkflow.executionPlan.scenes[0].candidates[0].provenance.inputVersion = '4';
  Object.assign(latest.agentWorkflow.executionPlanReview, { version: '4', executionPlanVersion: '4', directorBriefVersion: '4', reviewId: 'derived-review-4' });
  assert.equal(socialProductionGraphInput(latest, frozen).inputHash, socialProductionGraphInput(frozen).inputHash);
  for (const mutate of [
    (value: any) => { value.agentWorkflow.directorBrief.scenes[0].voiceover = 'unapproved words'; },
    (value: any) => { value.agentWorkflow.executionPlan.scenes[0].selectedSourceStrategy = 'paid_aigc'; },
    (value: any) => { value.agentWorkflow.executionPlanReview.approved = false; },
  ]) {
    const changed = structuredClone(latest); mutate(changed);
    assert.throws(() => socialProductionGraphInput(changed, frozen), /plan_changed/);
  }
});
