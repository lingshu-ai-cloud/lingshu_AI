import assert from 'node:assert/strict';
import test from 'node:test';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { executeSocialAssetSupplyPlan } from './socialContentAssetSupplyExecution.js';

for (const error of ['provider_submission_unknown:accepted_no_output', 'provider_submission_uncertain:network',
  'product_scene_not_completed:pending:actual-task:poll_pending', 'digital_presenter_not_completed:uncertain:actual-task:poll_unknown']) {
  test(`unresolved supplier outcome prevents another adapter: ${error}`, async () => {
    const f = await prepared();
    try {
      let fallbackCalls = 0;
      const strategies = [...new Set(f.context.plan.shots.map(shot => shot.sourceStrategy))];
      await assert.rejects(executeSocialAssetSupplyPlan({ tenantId: 't', taskId: 'content', outputDirectory: f.local,
        plan: f.context.plan, baseline: f.context.baseline, availableAssets: [], adapters: [
          { adapterId: 'actual-submitted-provider', sourceStrategies: strategies, async execute() { throw new Error(error); } },
          { adapterId: 'must-not-fallback', sourceStrategies: strategies, async execute() { fallbackCalls++; return null; } },
        ] }), failure => failure instanceof Error && failure.message === error);
      assert.equal(fallbackCalls, 0);
    } finally { await f.cleanup(); }
  });
}
