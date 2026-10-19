import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAssetSupplyPlan} from './socialContentAssetSupply';
import {hasVerifiedSameClassSocialLocalMatch} from './socialContentMaterialRouting';

const inventory={customerVideoIds:['product-local','consumer-local'],factoryEvidenceAssetIds:['factory-local'],productIdentityGroups:[{productRef:'own-product',imageIds:['own-image']}]};
const product={shotId:'product',function:'demonstration' as const,materialType:'product' as const,productRef:'own-product',productPolicy:'locked' as const,plannedDurationSeconds:4};
function plan(shot:any,extra:any={}){return createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v2',productionApproach:'ai_enhanced',inventory,shots:[shot],...extra}).shots[0]!;}
const match={sourceRefs:['product-local'],semanticMatch:'verified' as const,evidenceRef:'semantic:product-action',productRef:'own-product'};
const segment={sourceRef:'product-local',segmentId:'exact-product-segment',startSeconds:4,endSeconds:8};

test('v2 creates a real exact-SKU product generation candidate, not an automatic paid route',()=>{
 const p=plan({...product,localVideoMatch:match,selectedMaterialSegment:segment});
 assert.equal(p.sourceStrategy,'customer_real_asset');
 assert.equal(p.materialRouting?.productGenerationDecision?.state,'eligible');
 assert.equal(p.materialRouting?.productGenerationDecision?.importance,'critical');
 assert.equal(p.materialRouting?.productGenerationDecision?.quoteRef,undefined);
 assert.equal(p.materialRouting?.generation?.videoProvider,'seedance');
 assert.equal(p.materialRouting?.generation?.method,'enterprise_authored_product_first_frame_i2v');
 assert.deepEqual(p.materialRouting?.generation?.productImageRefs,['own-image']);
 assert.equal(p.materialRouting?.generation?.durationSeconds,4);
 assert.equal(p.productSceneReplication?.cameraLock.durationSeconds,4);
 assert.equal(p.materialRouting?.localMatch.productRef,'own-product');
 assert.equal(hasVerifiedSameClassSocialLocalMatch(p,'own-product'),true);
 assert.equal(hasVerifiedSameClassSocialLocalMatch(p,'other-product'),false);
});
test('product gaps may be budget-planned, but no image identity means no generation eligibility',()=>{
 const missingLocal=plan(product);
 assert.equal(missingLocal.materialRouting?.productGenerationDecision?.state,'eligible');
 assert.equal(missingLocal.sourceStrategy,'customer_real_asset');
 assert.equal(missingLocal.feasibility,'functional_equivalent');
 const noImage=plan({...product,productRef:'absent-product'});
 assert.equal(noImage.materialRouting?.productGenerationDecision?.state,'local_only');
 assert.equal(noImage.materialRouting?.generation,undefined);
 assert.equal(noImage.productSceneReplication,undefined);
 assert.equal(hasVerifiedSameClassSocialLocalMatch(missingLocal),false);
});
test('standard product shots are not falsely promoted to S-level',()=>{
 const p=plan({...product,function:'transition'});
 assert.equal(p.materialRouting?.productGenerationDecision?.importance,'standard');
 const critical=plan({...product,function:'transition',requestedDescription:'关键产品细节'});
 assert.equal(critical.materialRouting?.productGenerationDecision?.importance,'critical');
});
test('factory, D2C, unknown and general never receive generation candidates even with images',()=>{
 for(const materialType of ['factory','consumer_demo','unknown','general']){
  const p=plan({...product,materialType,requestedDescription:'保留原分镜语义'});
  assert.equal(p.materialRouting?.policy,'local_only');
  assert.equal(p.materialRouting?.generation,undefined);
  assert.equal(p.materialRouting?.productGenerationDecision,undefined);
  assert.equal(p.productSceneReplication,undefined);
  assert.equal(p.fallbackSourceStrategy,null);
  assert.equal(p.feasibility,'goal_degraded');
 }
});
test('v2 refuses historic cross-class source tiers as product identity evidence',()=>{
 for(const sourceTier of ['product_local','factory_local','other_local']){
  const p=plan({...product,localVideoMatch:{...match,sourceTier,productRef:'other-product'},selectedMaterialSegment:segment});
  assert.equal(p.materialRouting?.localMatch.state,'missing');
  assert.equal(hasVerifiedSameClassSocialLocalMatch(p,'own-product'),false);
 }
 for(const sourceTier of ['factory_local','other_local']){
  const p=plan({...product,localVideoMatch:{...match,sourceTier},selectedMaterialSegment:segment});
  assert.equal(p.materialRouting?.localMatch.state,'missing','Even a projected SKU cannot turn factory/other footage into a product shot');
 }
});
test('v1 and unversioned frozen/local contracts retain historic behavior',()=>{
 const p=plan(product,{materialRoutingPolicyVersion:'type-aware.v1'});
 assert.equal(p.materialRouting?.policy,'local_only');
 assert.equal(p.materialRouting?.generation,undefined);
 assert.equal(p.materialRouting?.productGenerationDecision,undefined);
});
test('explicit factory or D2C source-tier conflicts remain missing rather than borrowing another material class',()=>{
 for(const [materialType,sourceTier]of [['factory','product_local'],['consumer_demo','factory_local'],['consumer_demo','product_local']]){
  const p=plan({...product,materialType,localVideoMatch:{...match,sourceTier},selectedMaterialSegment:segment});
  assert.equal(p.materialRouting?.localMatch.state,'missing');
  assert.equal(p.materialRouting?.generation,undefined);
  assert.equal(p.feasibility,'goal_degraded');
 }
});
