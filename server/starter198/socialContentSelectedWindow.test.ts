import assert from 'node:assert/strict';
import test from 'node:test';
import { existingAssetSupplyAdapters } from './socialContentProductionSupport.js';
import type { SocialAssetSupplyAdapterContext } from './socialContentAssetSupplyExecution.js';
import { buildSocialProductionPlan, buildPlannedTimeline, type SocialProductionAsset } from './socialContentProductionPlan.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';

const asset: SocialProductionAsset = { id: 'factory', sourceId: 'library-source', name: '生产车间', type: 'video',
  url: '/tmp/factory.mp4', localPath: '/tmp/factory.mp4', contentHash: 'a'.repeat(64), duration: 10,
  visualObservations: ['工人操作灌装设备'], segments: [{ id: 'fill', start: 3, end: 8 }] };
function context(start: number, end: number): SocialAssetSupplyAdapterContext {
  return { tenantId: 'tenant', taskId: 'task', outputDirectory: '/tmp', availableAssets: [asset],
    baselineScene: { sceneId: `scene-${start}` }, shot: { sourceStrategy: 'customer_real_asset', sourceRefs: ['factory'],
      selectedMaterialSegment: { sourceRef: 'factory', segmentId: 'fill', startSeconds: start, endSeconds: end },
      truthBoundary: { customerEvidenceRefs: ['factory'] } } } as SocialAssetSupplyAdapterContext;
}
const adapter = existingAssetSupplyAdapters().find(item => item.adapterId === 'existing_customer_asset.v1')!;
test('selected windows survive the original asset adapter, production plan and render timeline', async () => {
  const first = await adapter.execute(context(3, 4));
  const second = await adapter.execute(context(4, 5));
  assert.ok(first && second);
  assert.notEqual(first.asset.id, second.asset.id);
  assert.equal(first.asset.sourceId, second.asset.sourceId);
  assert.equal(first.sourceRef, 'factory', 'the selected original asset alias survives window derivation');
  assert.equal(first.asset.contentHash, second.asset.contentHash);
  assert.deepEqual(first.asset.selectedSourceWindow, { startSeconds: 3, endSeconds: 4 });
  const baseline = { schemaVersion: 'social-content-script-baseline.v1', themeId: 'product_value', scenes: [3,4].map(start => ({
    sceneId: `scene-${start}`, shotFunction: '生产', subject: '灌装设备', action: '灌装', narration: '真实生产',
  })) } as StoredSocialScriptBaseline;
  const assets = [first.asset, second.asset];
  const plan = buildSocialProductionPlan({ baseline, assets, routedSceneAssets: assets.map((item, index) => ({
    sceneId: `scene-${index+3}`, assetId: item.id, durationSeconds: 1,
  })) });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual(plan.scenes.map(scene => [scene.clip.start, scene.clip.end]), [[3,4],[4,5]]);
  const timeline = buildPlannedTimeline({ plan, assets, duration: 2 });
  assert.deepEqual(timeline.map(scene => [scene.trimStart, scene.trimEnd]), [[3,4],[4,5]]);
  assert.equal(asset.id, 'factory', 'original inventory row remains unchanged');
});
test('the adapter rejects out-of-analysis, invalid or oversized source windows', async () => {
  for (const [start,end] of [[2,4],[7,9],[4,4],[-1,1],[NaN,4]]) {
    assert.equal(await adapter.execute(context(start!,end!)), null);
  }
});
