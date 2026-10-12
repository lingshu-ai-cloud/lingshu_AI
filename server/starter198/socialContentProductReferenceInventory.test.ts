import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedProductReferenceImageIds } from './socialContentProductReferenceInventory.js';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
const image = {id: 'actual-KB-image', tenantId: 'tenant', type: 'image', productId: 'SKU',
  contentSha256: 'a'.repeat(64), sourceType: 'social_task_upload'};
const ids = (record = image) => ownedProductReferenceImageIds({records: [record], tenantId: 'tenant', productId: 'SKU', productRef: null});
test('same-product image reference is admitted without unrelated clip-action analysis', () => {
  assert.deepEqual(ids(), ['actual-KB-image']);
});
test('selected enterprise product image URL binds its hashed material when legacy material identity fields are absent', () => {
  const legacy = {...image, productId: undefined, sourceUrl: '/api/overseas/enterprise/assets/rs001.png'};
  assert.deepEqual(ownedProductReferenceImageIds({records: [legacy], tenantId: 'tenant', productId: 'GUIANFA-RS-001',
    productRef: 'product:GUIANFA-RS-001', enterpriseProductImageUrls: ['/api/overseas/enterprise/assets/rs001.png']}), ['actual-KB-image']);
});
test('wrong identity, shared ownership, generated package and missing byte hash cannot become actual KB references', () => {
  for (const change of [{productId: 'OTHER'}, {tenantId: 'other'}, {scope: 'shared'}, {type: 'video'},
    {sourceType: 'ai-generated'}, {synthetic: true}, {contentSha256: ''}]) assert.deepEqual(ids({...image, ...change}), []);
});
test('selected enterprise image becomes the exact product identity group and product-shot source',()=>{
 const record={...image,productId:'GUIANFA-RS-001',productRef:'product:GUIANFA-RS-001',sourceType:'enterprise_product_table',width:160,height:288,licenseEvidence:'enterprise_profile:p:product:GUIANFA-RS-001',commercialUseApproved:true};
 const imageIds=ownedProductReferenceImageIds({records:[record],tenantId:'tenant',productId:'GUIANFA-RS-001',productRef:'product:GUIANFA-RS-001'});
 const plan=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:imageIds,productIdentityGroups:[{productRef:'product:GUIANFA-RS-001',imageIds}]},shots:[{shotId:'product-shot',function:'value',materialType:'product',productRef:'product:GUIANFA-RS-001',productPolicy:'locked',requestedDescription:'GUIANFA-RS-001 product close-up'}]});
 assert.deepEqual(plan.shots[0]!.sourceRefs,['actual-KB-image']);assert.equal(plan.shots[0]!.productSceneReplication?.productIdentity.groups[0]?.productRef,'product:GUIANFA-RS-001');assert.deepEqual(plan.shots[0]!.materialRouting?.generation?.productImageRefs,['actual-KB-image']);
});
test('new routing fills a prior empty product contract from current exact-SKU inventory without changing its scene timing',()=>{
 const request={shotId:'product-shot',function:'value' as const,materialType:'product' as const,productRef:'product:GUIANFA-RS-001',productPolicy:'locked' as const,plannedDurationSeconds:1.4,requestedDescription:'GUIANFA-RS-001 product close-up'};
 const before=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:[],productIdentityGroups:[]},shots:[request]}).shots[0]!;
 assert.deepEqual(before.productSceneReplication?.productIdentity.groups,[]);
 const imageIds=['actual-KB-image'];
 const refreshed=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:imageIds,productIdentityGroups:[{productRef:'product:GUIANFA-RS-001',imageIds}]},shots:[{...request,productSceneReplication:before.productSceneReplication,materialRouting:before.materialRouting}]}).shots[0]!;
 assert.deepEqual(refreshed.sourceRefs,imageIds);assert.deepEqual(refreshed.materialRouting?.generation?.productImageRefs,imageIds);
 assert.deepEqual(refreshed.productSceneReplication?.productIdentity.groups[0]?.referenceImageIds,imageIds);
 assert.equal(refreshed.productSceneReplication?.sceneLock.productSlots[0]?.productRef,'product:GUIANFA-RS-001');
 assert.equal(refreshed.productSceneReplication?.cameraLock.durationSeconds,1.4);
});
test('current task SKU fills a frozen empty reference contract even when the reference retained a different product label',()=>{
 const request={shotId:'product-shot',function:'value' as const,materialType:'product' as const,
  productRef:'GUIANFA-RS-001',productPolicy:'locked' as const,plannedDurationSeconds:1.4,
  requestedDescription:'current product close-up',visualContract:normalizeSceneVisualContract({product:{requestedProductRef:'reference-video-product'}})};
 const before=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',
  materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:[],productIdentityGroups:[]},shots:[request]}).shots[0]!;
 const frozen=structuredClone(before.productSceneReplication!);
 const camera=structuredClone(frozen.cameraLock),scene={...structuredClone(frozen.sceneLock),productSlots:[]};
 const refreshed=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',
  materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:['actual-KB-image'],productIdentityGroups:[{
    productRef:'product:GUIANFA-RS-001',imageIds:['actual-KB-image']}]},shots:[{...request,
      productSceneReplication:frozen,materialRouting:before.materialRouting}]}).shots[0]!;
 assert.deepEqual(refreshed.productSceneReplication?.productIdentity.groups,[{
  productRef:'product:GUIANFA-RS-001',referenceImageIds:['actual-KB-image'],
  requiredVisibleElements:['产品轮廓','材质与颜色','Logo','包装标签与可读文字'],
  forbiddenChanges:['shape','material','color','logo','label_text','packaging_structure']}]);
 assert.deepEqual(refreshed.sourceRefs,['actual-KB-image']);
 assert.deepEqual(refreshed.materialRouting?.generation?.productImageRefs,['actual-KB-image']);
 assert.deepEqual(refreshed.productSceneReplication?.cameraLock,camera);
 assert.deepEqual({...refreshed.productSceneReplication?.sceneLock,productSlots:[]},scene);
});
