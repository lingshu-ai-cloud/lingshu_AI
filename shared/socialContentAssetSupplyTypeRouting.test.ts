import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAssetSupplyPlan,classifySocialAssetSupplyMaterialType} from './socialContentAssetSupply';

const inventory={customerVideoIds:['product-local','consumer-local'],factoryEvidenceAssetIds:['factory-local'],productIdentityGroups:[{productRef:'own-product',imageIds:['own-image']}]};
function plan(shot:any,extra:any={}){return createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v1',productionApproach:'ai_enhanced',inventory,shots:[shot],...extra}).shots[0];}
test('factory and consumer scenes remain real local media even with people, product images and generation routes',()=>{
 const factory=plan({shotId:'factory',function:'trust',materialType:'factory',requestedDescription:'员工在工厂灌装产品',localVideoMatch:{sourceRefs:['factory-local'],semanticMatch:'verified',evidenceRef:'semantic:filling-action'}});
 assert.equal(factory.sourceStrategy,'customer_real_asset');assert.deepEqual(factory.sourceRefs,['factory-local']);assert.equal(factory.materialRouting?.policy,'local_only');assert.equal(factory.fallbackSourceStrategy,null);assert.equal(factory.truthBoundary.syntheticVisualAllowed,false);
 const consumer=plan({shotId:'use',function:'demonstration',materialType:'consumer_demo',requestedDescription:'消费者上脸使用产品'});
 assert.equal(consumer.sourceStrategy,'customer_real_asset');assert.equal(consumer.feasibility,'goal_degraded');assert.deepEqual(consumer.sourceRefs,[]);assert.equal(consumer.fallbackSourceStrategy,null);assert.equal(consumer.digitalHumanPlan,undefined);
 const matched=plan({shotId:'use',function:'demonstration',materialType:'consumer_demo',localVideoMatch:{sourceRefs:['consumer-local'],semanticMatch:'verified',evidenceRef:'semantic:use-action'}});
 assert.equal(matched.materialRouting?.localMatch.state,'matched');assert.deepEqual(matched.sourceRefs,['consumer-local']);assert.equal(matched.feasibility,'full_fidelity');
 const missingFactory=plan({shotId:'f',function:'trust',materialType:'factory'},{inventory:{productImageIds:['own-image']}});
 assert.equal(missingFactory.feasibility,'goal_degraded');assert.equal(missingFactory.productSceneReplication,undefined);
 assert.equal(plan({shotId:'f',function:'trust',materialType:'factory'}).feasibility,'goal_degraded','Flat factory inventory is only a candidate pool, never evidence of this shot matching');
});
test('products require per-shot semantic and product evidence before local reuse; otherwise choose reference first-frame I2V',()=>{
 const request={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',productPolicy:'locked'};
 const matched=plan({...request,localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:product-action',productRef:'own-product'}});
 assert.equal(matched.sourceStrategy,'customer_real_asset');assert.equal(matched.productSceneReplication,undefined);assert.equal(matched.fallbackSourceStrategy,null);
 const segment={sourceRef:'product-local',segmentId:'actual-action',startSeconds:4,endSeconds:7};
 const withSegment={...request,localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:segment',productRef:'own-product'},selectedMaterialSegment:segment};
 assert.deepEqual(plan(withSegment).selectedMaterialSegment,segment);
 for(const invalid of [{...segment,sourceRef:'outside'},{...segment,startSeconds:NaN},{...segment,endSeconds:4},{...segment,startSeconds:-1}])assert.throws(()=>plan({...withSegment,selectedMaterialSegment:invalid}),/material_local_match_segment_invalid/);
 for(const match of [undefined,{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'',productRef:'own-product'},{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic',productRef:'wrong-product'},{sourceRefs:['outside-tenant'],semanticMatch:'verified',evidenceRef:'semantic',productRef:'own-product'}]){
  const generated=plan({...request,localVideoMatch:match});
  assert.equal(generated.sourceStrategy,'aigc_product_scene_replication');assert.equal(generated.materialRouting?.localMatch.state,'missing');assert.equal(generated.materialRouting?.generation?.method,'enterprise_authored_product_first_frame_i2v');assert.equal(generated.materialRouting?.generation?.durationSeconds,3);assert.deepEqual(generated.materialRouting?.generation?.productImageRefs,['own-image']);assert.equal(generated.fallbackSourceStrategy,null);
 }
 const missingOwnProduct=plan({...request,productRef:'not-in-kb'});assert.equal(missingOwnProduct.feasibility,'goal_degraded');assert.deepEqual(missingOwnProduct.sourceRefs,[]);
 assert.equal(plan({...request,plannedDurationSeconds:8}).productSceneReplication?.cameraLock.durationSeconds,8);
 for(const duration of [NaN,Infinity,0,-1])assert.throws(()=>plan({...request,plannedDurationSeconds:duration}),/material_planned_duration_invalid/);
});
test('only actual talking-head classification requests a presenter and unknown scenes cannot silently become products',()=>{
 const actualHook='Original authorized digital twin; new exact English hook, original voice, no product claim';
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'S01',function:'hook',requestedDescription:actualHook}),'talking_head');
 assert.equal(plan({shotId:'S01',function:'hook',requestedDescription:actualHook}).sourceStrategy,'authorized_digital_presenter');
 for(const description of ['数字分身对镜口播','avatar talking to camera','真人对镜speaking'])assert.equal(classifySocialAssetSupplyMaterialType({shotId:'speaker',function:'hook',requestedDescription:description}),'talking_head');
 for(const description of ['Product packaging close-up with voiceover; no avatar talking','产品运镜展示，加旁白，不出现数字分身口播'])assert.equal(classifySocialAssetSupplyMaterialType({shotId:'product',function:'demonstration',requestedDescription:description}),'product');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'none',function:'transition',requestedDescription:'No product claim; no avatar talking'}),'unknown');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'u',function:'demonstration',requestedDescription:'消费者涂抹产品上脸'}),'consumer_demo');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',requestedDescription:'工人检查工厂设备'}),'factory');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'p',function:'demonstration',requestedDescription:'手拿产品晃一圈展示包装',interaction:'person_holding_product'}),'product');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',requestedDescription:'工厂输送带灌装产品'}),'factory');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'t',function:'hook',requestedDescription:'真人在工厂拿产品对镜口播'}),'talking_head');
 const factoryReference:any={shotId:'ref',visualDescription:'工厂内人物手持包装',spokenText:'Meet our product.',tags:{subjects:['person','product'],subjectRelations:[],sceneTypes:['factory']},referenceProductionRouting:{state:'ready',personPresence:'person',observedPresenterRole:'sales_presenter'}};
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'t',function:'hook',referenceShotId:'ref'},[factoryReference]),'talking_head');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',referenceShotId:'ref'},[{...factoryReference,referenceProductionRouting:{...factoryReference.referenceProductionRouting,observedPresenterRole:'background'}}]),'factory');
 const speaker=plan({shotId:'s',function:'hook',materialType:'talking_head',requestedDescription:'真人口播'});assert.equal(speaker.sourceStrategy,'authorized_digital_presenter');assert.equal(speaker.materialRouting?.policy,'authorized_presenter');assert.ok(speaker.digitalHumanPlan);
 const factorySpeaker=plan({shotId:'t',function:'hook',requestedDescription:'真人在工厂拿产品对镜口播'});assert.equal(factorySpeaker.sourceStrategy,'authorized_digital_presenter');assert.equal(factorySpeaker.feasibility,'goal_degraded');assert.equal(factorySpeaker.truthBoundary.subject,'customer_factory');assert.equal(factorySpeaker.truthBoundary.customerEvidenceRequired,true);assert.ok(factorySpeaker.truthBoundary.prohibitedRepresentations.includes('depict_generated_factory_as_customer_factory'));
 const unknown=plan({shotId:'unknown',function:'transition',materialType:'unknown'});assert.equal(unknown.sourceStrategy,'customer_real_asset');assert.equal(unknown.feasibility,'goal_degraded');assert.equal(unknown.productSceneReplication,undefined);
});
test('historical plans omit the new contract and explicit approved generation duration stays frozen',()=>{
 const shot:any={shotId:'p',function:'demonstration',requestedDescription:'纯产品展示',productRef:'own-product',productPolicy:'locked'};
 const historic=createSocialAssetSupplyPlan({creationMode:'viral_replication',inventory,shots:[shot]});assert.equal(historic.materialRoutingPolicyVersion,undefined);assert.equal(historic.shots[0].materialRouting,undefined);
 const original=historic.shots[0].productSceneReplication!;const snapshot=JSON.stringify(original);const current=plan({...shot,materialType:'product',productSceneReplication:original});
 assert.equal(current.materialRouting?.generation?.durationSeconds,original.cameraLock.durationSeconds);assert.equal(JSON.stringify(original),snapshot);
 assert.throws(()=>plan({...shot,materialType:'product',productSceneReplication:original,plannedDurationSeconds:original.cameraLock.durationSeconds+1}),/material_frozen_duration_changed/);
});
test('explicit free edits retain a verified exact video window without enabling paid generation',()=>{
 const segment={sourceRef:'product-local',segmentId:'real-segment',startSeconds:2,endSeconds:5},shot={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:free',productRef:'own-product'},selectedMaterialSegment:segment};
 const free=plan(shot,{productionApproach:'material_cut'});assert.equal(free.sourceStrategy,'customer_real_asset');assert.equal(free.materialRouting,undefined);assert.deepEqual(free.selectedMaterialSegment,segment);assert.equal(free.productSceneReplication,undefined);assert.equal(free.fallbackSourceStrategy,null);
 assert.throws(()=>plan({...shot,selectedMaterialSegment:{...segment,endSeconds:NaN}},{productionApproach:'material_cut'}),/material_local_match_segment_invalid/);
 assert.equal(plan({...shot,localVideoMatch:{...shot.localVideoMatch,evidenceRef:''}},{productionApproach:'material_cut'}).selectedMaterialSegment,undefined);
});

test('normal plan refresh preserves explicit original-pixel method while new product plans author KB-only frames',()=>{
 const shot:any={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',productPolicy:'locked'};
 const fresh=plan(shot);assert.equal(fresh.materialRouting?.generation?.firstFrameOrigin,'enterprise_authored_storyboard');
 const frozen=structuredClone(fresh.materialRouting!);frozen.generation!.method='reference_first_frame_product_replacement_i2v';delete frozen.generation!.firstFrameOrigin;
 const refreshed=plan({...shot,productSceneReplication:fresh.productSceneReplication,materialRouting:frozen});
 assert.equal(refreshed.materialRouting?.generation?.method,'reference_first_frame_product_replacement_i2v');
 assert.equal(refreshed.materialRouting?.generation?.firstFrameOrigin,'original_reference_pixels');
});
