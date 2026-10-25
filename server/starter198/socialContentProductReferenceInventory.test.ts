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
test('confirmed SKU and display-name aliases do not exclude the enterprise product image', () => {
  const actual = { ...image, productId: 'GUIANFA-RS-001', productRef: 'product:GUIANFA-RS-001',
    productRefs: ['product:GUIANFA-RS-001', '云朵泡沫卸妆蜜'] };
  const input = { records: [actual], tenantId: 'tenant', productId: 'GUIANFA-RS-001', productRef: '云朵泡沫卸妆蜜' };
  assert.deepEqual(ownedProductReferenceImageIds(input), ['actual-KB-image']);
  assert.deepEqual(ownedProductReferenceImageIds({ ...input, records: [{ ...actual,
    productRefs: [...actual.productRefs, 'product:OTHER'] }] }), []);
});
test('selected enterprise product image URL binds its hashed material when legacy material identity fields are absent', () => {
  const legacy = {...image, productId: undefined, sourceUrl: '/api/overseas/enterprise/assets/rs001.png'};
  assert.deepEqual(ownedProductReferenceImageIds({records: [legacy], tenantId: 'tenant', productId: 'GUIANFA-RS-001',
    productRef: 'product:GUIANFA-RS-001', enterpriseProductImageUrls: ['/api/overseas/enterprise/assets/rs001.png']}), ['actual-KB-image']);
});
test('a matching enterprise URL cannot launder an image explicitly assigned to a different product', () => {
  const sourceUrl = '/api/overseas/enterprise/assets/rs001.png';
  const selected = {records: [{...image, sourceUrl}], tenantId: 'tenant', productId: 'SKU',
    productRef: 'product:SKU', enterpriseProductImageUrls: [sourceUrl]};
  assert.deepEqual(ownedProductReferenceImageIds(selected), ['actual-KB-image']);
  assert.deepEqual(ownedProductReferenceImageIds({...selected, records: [{...image, productId: 'OTHER', sourceUrl}]}), []);
  assert.deepEqual(ownedProductReferenceImageIds({...selected, records: [{...image, productRef: 'product:OTHER', sourceUrl}]}), []);
  assert.deepEqual(ownedProductReferenceImageIds({...selected, records: [{...image, productRefs: ['product:SKU', 'product:OTHER'], sourceUrl}]}), []);
});
test('wrong identity, shared ownership, generated package and missing byte hash cannot become actual KB references', () => {
  for (const change of [{productId: 'OTHER'}, {tenantId: 'other'}, {scope: 'shared'}, {type: 'video'},
    {sourceType: 'ai-generated'}, {synthetic: true}, {contentSha256: ''}]) assert.deepEqual(ids({...image, ...change}), []);
});
test('selected enterprise image is retained as inventory evidence, not executable product-shot video',()=>{
 const record={...image,productId:'GUIANFA-RS-001',productRef:'product:GUIANFA-RS-001',sourceType:'enterprise_product_table',width:160,height:288,licenseEvidence:'enterprise_profile:p:product:GUIANFA-RS-001',commercialUseApproved:true};
 const imageIds=ownedProductReferenceImageIds({records:[record],tenantId:'tenant',productId:'GUIANFA-RS-001',productRef:'product:GUIANFA-RS-001'});
 const plan=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:imageIds,productIdentityGroups:[{productRef:'product:GUIANFA-RS-001',imageIds}]},shots:[{shotId:'product-shot',function:'value',materialType:'product',productRef:'product:GUIANFA-RS-001',productPolicy:'locked',requestedDescription:'GUIANFA-RS-001 product close-up'}]});
 const shot=plan.shots[0]!;
 assert.deepEqual(imageIds,['actual-KB-image']);
 assert.deepEqual(shot.sourceRefs,[]);
 assert.equal(shot.sourceStrategy,'customer_real_asset');
 assert.equal(shot.materialRouting?.policy,'local_only');
 assert.equal(shot.materialRouting?.localMatch.state,'missing');
 assert.equal(shot.materialRouting?.generation,undefined);
 assert.equal(shot.productSceneReplication,undefined);
 assert.equal(shot.feasibility,'goal_degraded');
});
test('new routing admits a verified same-product local video segment',()=>{
 const request={shotId:'product-shot',function:'value' as const,materialType:'product' as const,productRef:'product:GUIANFA-RS-001',productPolicy:'locked' as const,plannedDurationSeconds:1.4,requestedDescription:'GUIANFA-RS-001 product close-up'};
 const before=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:[],productIdentityGroups:[]},shots:[request]}).shots[0]!;
 assert.deepEqual(before.sourceRefs,[]);
 assert.equal(before.feasibility,'goal_degraded');
 const imageIds=['actual-KB-image'];
 const segment={sourceRef:'same-product-video',segmentId:'verified-window',startSeconds:2,endSeconds:3.4};
 const refreshed=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{customerVideoIds:['same-product-video'],productImageIds:imageIds,productIdentityGroups:[{productRef:'product:GUIANFA-RS-001',imageIds}]},shots:[{...request,localVideoMatch:{sourceRefs:['same-product-video'],semanticMatch:'verified',evidenceRef:'verified:product-close-up',productRef:'product:GUIANFA-RS-001'},selectedMaterialSegment:segment}]}).shots[0]!;
 assert.deepEqual(refreshed.sourceRefs,['same-product-video']);
 assert.deepEqual(refreshed.selectedMaterialSegment,segment);
 assert.equal(refreshed.materialRouting?.localMatch.state,'matched');
 assert.equal(refreshed.materialRouting?.generation,undefined);
 assert.equal(refreshed.productSceneReplication,undefined);
 assert.equal(refreshed.feasibility,'full_fidelity');
});
test('current task SKU rejects a different product video despite matching image inventory',()=>{
 const request={shotId:'product-shot',function:'value' as const,materialType:'product' as const,
  productRef:'GUIANFA-RS-001',productPolicy:'locked' as const,plannedDurationSeconds:1.4,
  requestedDescription:'current product close-up',visualContract:normalizeSceneVisualContract({product:{requestedProductRef:'GUIANFA-RS-001'}})};
 const attempted=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',
  materialRoutingPolicyVersion:'type-aware.v1',inventory:{customerVideoIds:['other-product-video'],productImageIds:['actual-KB-image'],productIdentityGroups:[{
    productRef:'product:GUIANFA-RS-001',imageIds:['actual-KB-image']}]},shots:[{...request,
      localVideoMatch:{sourceRefs:['other-product-video'],semanticMatch:'verified',evidenceRef:'verified:other-product',productRef:'reference-video-product'},
      selectedMaterialSegment:{sourceRef:'other-product-video',segmentId:'wrong-sku',startSeconds:2,endSeconds:3.4}}]}).shots[0]!;
 assert.deepEqual(attempted.sourceRefs,[]);
 assert.equal(attempted.materialRouting?.localMatch.state,'missing');
 assert.equal(attempted.materialRouting?.generation,undefined);
 assert.equal(attempted.productSceneReplication,undefined);
 assert.equal(attempted.feasibility,'goal_degraded');
});
