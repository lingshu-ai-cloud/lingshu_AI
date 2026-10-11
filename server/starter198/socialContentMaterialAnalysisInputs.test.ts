import test from 'node:test';
import assert from 'node:assert/strict';
import { socialContentMaterialAnalysisInputs } from './socialContentMaterialAnalysisInputs.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentReplication.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
const image = {id: 'KB-image', sourceId: 'KB-source', type: 'image'} as SocialProductionAsset;
const video = {id: 'real-video', sourceId: 'video-source', type: 'video'} as SocialProductionAsset;
const productShot = {shotId: 'product', sourceStrategy: 'aigc_product_scene_replication', sourceRefs: [image.id],
  materialRouting: {generation: {method: 'enterprise_authored_product_first_frame_i2v'}}};
const plan = (shots: unknown[]) => ({shots}) as SocialAssetSupplyPlan;
test('registered product references stay available for actual frame QA without redundant material analysis', () => {
  const result = socialContentMaterialAnalysisInputs({assets: [image, video], policyVersion: 'type-aware.v1',
    plan: plan([productShot, {shotId: 'factory', sourceStrategy: 'customer_real_asset', sourceRefs: [video.id]}])});
  assert.deepEqual(result.analyze, [video]);
  assert.deepEqual(result.productReferences, [image]);
});
test('historical and shared material consumers keep analysis while an exclusive owned product animation reuses verified bytes', () => {
  assert.deepEqual(socialContentMaterialAnalysisInputs({assets: [image], plan: plan([productShot])}).analyze, [image]);
  const shared = socialContentMaterialAnalysisInputs({assets: [image], policyVersion: 'type-aware.v1',
    plan: plan([productShot, {shotId: 'other', sourceStrategy: 'customer_real_asset', sourceRefs: [image.id]}])});
  assert.deepEqual(shared.analyze, [image]); assert.deepEqual(shared.productReferences, []);
  const animation = socialContentMaterialAnalysisInputs({assets: [image], policyVersion: 'type-aware.v1',
    plan: plan([{...productShot, sourceStrategy: 'customer_product_image_animation'}])});
  assert.deepEqual(animation.analyze, []); assert.deepEqual(animation.productReferences, [image]);
});
