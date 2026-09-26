import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSocialProductSceneReplicationSpec } from '../../shared/socialContentAssetSupply.js';
import { createSocialProductSceneAdapter } from './socialContentProductSceneAdapter.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-product-scene-'));
const output = path.join(root, 'scene.mp4');
fs.writeFileSync(output, 'mock-product-scene-video');
const inventory = {
  customerVideoIds: [], productImageIds: ['image-a', 'image-b'], presenterAssetIds: [], referenceVideoIds: [],
  factoryEvidenceAssetIds: [], customerCaseEvidenceAssetIds: [], productEffectEvidenceAssetIds: [], licensedStockAssetIds: [],
  productIdentityGroups: [
    { productRef: 'serum-a', imageIds: ['image-a'] },
    { productRef: 'cream-b', imageIds: ['image-b'] },
  ],
};
const spec = buildSocialProductSceneReplicationSpec({
  shot: { shotId: 'hook', function: 'hook', referenceShotId: 'reference-hook' },
  inventory,
  referenceShots: [{
    shotId: 'reference-hook', startSeconds: 0, endSeconds: 3, visualDescription: '多个产品在干净展台上有序摆放',
    spokenText: null, captionText: null, audioDescription: null, rhythmDescription: '稳定', purpose: 'hook',
    shotLanguage: { shotSize: '中近景', cameraAngle: '轻俯拍', movement: '环绕展台旋转并轻微推近', composition: '两个产品对称陈列' },
    tags: { sceneTypes: ['干净展台'], subjects: ['产品'], subjectRelations: ['有序摆放'], cameraLanguage: ['环绕旋转', '轻微推近'], contentFunctions: ['hook'], soundTypes: [], onScreenInformation: [], truthRequirements: ['none'], suggestedProductionMethods: [] },
    fidelityPoints: [], mustDifferPoints: [],
  }],
});
assert.equal(spec.templateSource, 'reference_shot');
assert.equal(spec.sceneLock.productSlots.length, 2);
assert.match(spec.cameraLock.movementPath, /环绕/);

const context: any = {
  tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  shot: {
    shotId: 'hook', function: 'hook', sourceStrategy: 'aigc_product_scene_replication', sourceRefs: ['image-a', 'image-b'],
    fallbackSourceStrategy: 'motion_graphics', productSceneReplication: spec,
    truthBoundary: { subject: 'none', syntheticVisualAllowed: true, customerEvidenceRequired: false, customerEvidenceRefs: [], confirmedFactRefs: ['fact-1'], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] },
  },
  baselineScene: { sceneId: 'hook', shotFunction: '开场', subject: '多产品', action: '环绕展示' },
  availableAssets: [
    { id: 'image-a', sourceId: 'image-a', type: 'image', url: '/tmp/image-a.png', contentHash: 'hash-a' },
    { id: 'image-b', sourceId: 'image-b', type: 'image', url: '/tmp/image-b.png', contentHash: 'hash-b' },
  ],
};
let request: any;
const adapter = createSocialProductSceneAdapter({
  maximumCostCny: 3,
  async execute(input) {
    request = input;
    return {
      status: 'completed', providerId: 'mock-video', providerTaskId: 'provider-task-1', model: 'mock-v1',
      localPath: output, contentHash: 'scene-hash', duration: 3, actualCostCny: 2.7,
      quality: { productIdentitySimilarity: { 'serum-a': 0.96, 'cream-b': 0.95 }, labelOcrExactMatch: true,
        sceneTopologyScore: 0.94, productSlotLayoutScore: 0.93, cameraTrajectoryScore: 0.95,
        evidenceRefs: ['qa://identity', 'qa://trajectory'] },
    };
  },
});
const completed = await adapter.execute(context);
assert.ok(completed);
assert.equal(completed.sourceStrategy, 'aigc_product_scene_replication');
assert.equal(request.referenceImages.length, 2);
assert.equal(request.spec.sceneTemplateKey, 'reference-shot:reference-hook');
assert.match(completed.disclosure || '', /非客户实拍场景/);
assert.equal(completed.asset.segments[0]?.sceneTemplateKey, 'reference-shot:reference-hook');

const identityFailed = createSocialProductSceneAdapter({ maximumCostCny: 3, async execute() {
  return { status: 'completed', providerId: 'mock-video', providerTaskId: 'provider-task-2', model: 'mock-v1',
    localPath: output, contentHash: 'bad-scene-hash', duration: 3, actualCostCny: 2.7,
    quality: { productIdentitySimilarity: { 'serum-a': 0.96, 'cream-b': 0.71 }, labelOcrExactMatch: true,
      sceneTopologyScore: 0.94, productSlotLayoutScore: 0.93, cameraTrajectoryScore: 0.95, evidenceRefs: ['qa://identity'] } };
} });
await assert.rejects(() => identityFailed.execute(context), /product_identity_failed:cream-b/);

const cameraFailed = createSocialProductSceneAdapter({ maximumCostCny: 3, async execute() {
  return { status: 'completed', providerId: 'mock-video', providerTaskId: 'provider-task-3', model: 'mock-v1',
    localPath: output, contentHash: 'bad-camera-hash', duration: 3, actualCostCny: 2.7,
    quality: { productIdentitySimilarity: { 'serum-a': 0.96, 'cream-b': 0.95 }, labelOcrExactMatch: true,
      sceneTopologyScore: 0.94, productSlotLayoutScore: 0.93, cameraTrajectoryScore: 0.6, evidenceRefs: ['qa://trajectory'] } };
} });
await assert.rejects(() => cameraFailed.execute(context), /camera_trajectory_failed/);

fs.rmSync(root, { recursive: true, force: true });
console.log('social product scene adapter tests passed');
