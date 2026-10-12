import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { executeSocialAssetSupplyPlan, alignSocialAssetSupplyPlanToBaseline, type SocialAssetSupplyProviderAdapter } from './socialContentAssetSupplyExecution.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseSocialTaskBrief } from './socialContentRecords.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
const baseline = {schemaVersion:'social-content-script-baseline.v1',version:'route-fixture',source:'knowledge_fallback',formulaReference:null,themeId:null,language:'en',lockedAt:'2026-10-11T00:00:00Z',createdBeforeMaterialAdaptation:true,scenes:[{sceneId:'S01',formulaNodeId:null,shotFunction:'value',subject:'product',action:'demonstrate',voiceover:'Meet the product.',narration:'Meet the product.'}]} as StoredSocialScriptBaseline;
function plan(type:'factory'|'product'|'consumer_demo',state:'matched'|'missing'='matched') {
 const result=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',inventory:{productImageIds:['actual-product-image']},shots:[{shotId:'S01',function:'value',requestedDescription:'Product scene'}]});
 const shot=result.shots[0]!;
 if(type==='product'&&state==='missing'&&shot.productSceneReplication)shot.productSceneReplication.cameraLock.durationSeconds=3;
 Object.assign(shot,{sourceStrategy:state==='matched'?'customer_real_asset':'aigc_product_scene_replication',sourceRefs:state==='matched'?['real-video']:['actual-product-image'],fallbackSourceStrategy:null,materialRouting:{schemaVersion:'social-material-routing.v1',materialType:type,policy:type==='product'?'local_first_product_i2v':'local_only',localMatch:{state,sourceRefs:state==='matched'?['real-video']:[],evidenceRef:state==='matched'?'tenant-semantic-evidence':null},...(state==='missing'&&type==='product'?{generation:{method:'reference_first_frame_product_replacement_i2v',durationSeconds:3,productImageRefs:['actual-product-image'],referenceShotId:'reference-S01',referenceSourceId:'reference-video'}}:{})}});
 return result;
}
function adapter(type:'video'|'image'='video',synthetic=false): SocialAssetSupplyProviderAdapter {return {adapterId:'actual-local',sourceStrategies:['customer_real_asset'],async execute(){return {asset:{id:'real-video',sourceId:'real-video',type,url:'local',localPath:'local',name:'real tenant asset',duration:3,segments:[]} as any,sourceStrategy:'customer_real_asset',providerId:'tenant-library',sourceRef:'real-video',synthetic,representation:'non_evidentiary_visual',authorizationRef:'real-rights',disclosure:null};}};}
function run(p:ReturnType<typeof plan>,adapters:SocialAssetSupplyProviderAdapter[]) {return executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:'/tmp/local-route-no-paid',plan:p,baseline,availableAssets:[],adapters});}
test('new material policy survives old product capability and viral alignment; factory/product/consumer use semantic local video without generation',async()=>{
 for(const type of ['factory','product','consumer_demo'] as const){const p=plan(type);let paid=0;const gen:SocialAssetSupplyProviderAdapter={adapterId:'must-not-pay',sourceStrategies:['aigc_product_scene_replication','non_evidentiary_ai_visual'],async execute(){paid++;throw Error('unexpected paid');}};assert.equal(alignSocialAssetSupplyPlanToBaseline({plan:p,baseline}).shots[0]!.sourceStrategy,'customer_real_asset');const result=await run(p,[adapter(),gen]);assert.equal(result.assets[0]!.id,'real-video');assert.equal(paid,0);assert.equal(result.execution.shots[0]!.fallbackApplied,false);}
});
test('factory and consumer missing local match stop before any supplier, with no synthetic fallback',async()=>{
 for(const type of ['factory','consumer_demo'] as const){let calls=0;const gen:SocialAssetSupplyProviderAdapter={adapterId:'must-not-pay',sourceStrategies:['aigc_product_scene_replication','motion_graphics'],async execute(){calls++;return null;}};await assert.rejects(run(plan(type,'missing'),[gen]),/local_real_video_required/);assert.equal(calls,0);}
});
test('semantic local match cannot be satisfied by image motion or synthetic customer evidence',async()=>{
 for(const [type,synthetic] of [['image',false],['video',true]] as const)await assert.rejects(run(plan('product'),[adapter(type,synthetic)]),/material_route_requires_verified_local_video/);
});
test('explicit product mismatch dispatches only reviewed product I2V, and unknown receipt forbids fallback or resubmission',async()=>{
 const p=plan('product','missing');let local=0,generated=0;const localAdapter=adapter();localAdapter.execute=async()=>{local++;return null;};const gen:SocialAssetSupplyProviderAdapter={adapterId:'product-i2v',sourceStrategies:['aigc_product_scene_replication'],async execute(context){generated++;assert.equal((context.shot as any).materialRouting.generation.durationSeconds,3);throw Error('provider_submission_unknown:receipt-persisted');}};
 await assert.rejects(run(p,[localAdapter,gen]),/provider_submission_unknown/);assert.equal(local,0);assert.equal(generated,1);
});
test('product image animation is rejected before local zoom or paid generation can run',async()=>{
 const p=plan('product','missing');p.shots[0]!.sourceStrategy='customer_product_image_animation';let local=0,paid=0;
 const exact:SocialAssetSupplyProviderAdapter={adapterId:'forbidden-local-motion',sourceStrategies:['customer_product_image_animation'],async execute(){local++;throw Error('must-not-render');}};
 await assert.rejects(run(p,[exact,{adapterId:'paid-trap',sourceStrategies:['aigc_product_scene_replication'],async execute(){paid++;throw Error('unexpected paid');}}]),/still_image_motion_forbidden/);
 assert.equal(local,0);assert.equal(paid,0);
});
test('customer product image animation rejects unfrozen duration and missing locked image contract before execution',async()=>{
 for(const mutate of [(p:ReturnType<typeof plan>)=>{p.shots[0]!.productSceneReplication!.cameraLock.durationSeconds=4;},(p:ReturnType<typeof plan>)=>{p.shots[0]!.materialRouting!.generation!.productImageRefs=[];}]){
  const p=plan('product','missing');p.shots[0]!.sourceStrategy='customer_product_image_animation';mutate(p);let calls=0;
  await assert.rejects(run(p,[{adapterId:'must-not-run',sourceStrategies:['customer_product_image_animation'],async execute(){calls++;return null;}}]),/product_generation_contract/);assert.equal(calls,0);
 }
});
test('baseline alignment replaces stale product source refs with frozen enterprise image refs',()=>{
 const p=plan('product','missing');p.shots[0]!.sourceRefs=['stale-route-ref'];
 const aligned=alignSocialAssetSupplyPlanToBaseline({plan:p,baseline});
 assert.deepEqual(aligned.shots[0]!.sourceRefs,['actual-product-image']);
});
test('already approved canonical product asset wins before a paid adapter and is not generated again',async()=>{
 const p=plan('product','missing');let paid=0;
 const canonical:SocialAssetSupplyProviderAdapter={adapterId:'canonical-approved',sourceStrategies:['aigc_product_scene_replication'],async execute(){return {asset:{id:'canonical-product-video',sourceId:'approved-generation',type:'video',url:'local',localPath:'local',name:'approved product video',duration:3,segments:[]} as any,sourceStrategy:'aigc_product_scene_replication',providerId:'durable-approved-receipt',sourceRef:'actual-product-image',synthetic:true,representation:'non_evidentiary_visual',authorizationRef:'tenant-product-rights',disclosure:'Synthetic product scene; not a real customer demonstration.'};}};
 const supplier:SocialAssetSupplyProviderAdapter={adapterId:'must-not-repost',sourceStrategies:['aigc_product_scene_replication'],async execute(){paid++;throw Error('unexpected duplicate generation');}};
 const result=await run(p,[canonical,supplier]);assert.equal(result.assets[0]!.id,'canonical-product-video');assert.equal(paid,0);
});
test('actual versioned planner and existing library adapter preserve reviewed product segment without paid generation',async()=>{
 const {existingAssetSupplyAdapters}=await import('./socialContentProductionSupport.js');
 const p=createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v1',productionApproach:'ai_enhanced',inventory:{customerVideoIds:['real-video'],productIdentityGroups:[{productRef:'product',imageIds:['actual-product-image']}]},shots:[{shotId:'S01',function:'value',materialType:'product',productRef:'product',productPolicy:'locked',requestedDescription:'Product demonstration',localVideoMatch:{sourceRefs:['real-video'],semanticMatch:'verified',evidenceRef:'semantic-actual-segment',productRef:'product'},selectedMaterialSegment:{sourceRef:'real-video',segmentId:'reviewed-segment',startSeconds:4,endSeconds:7}}]});
 const asset={id:'real-video',sourceId:'real-video',name:'owned product video',type:'video',url:'local',localPath:'local',duration:10,visualObservations:['real product demonstration'],segments:[{id:'unrelated-segment',start:0,end:2},{id:'reviewed-segment',start:4,end:7}]} as any;
 const result=await executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:'/tmp/local-no-paid',plan:p,baseline,availableAssets:[asset],adapters:existingAssetSupplyAdapters()});
 assert.equal(result.plan.materialRoutingPolicyVersion,'type-aware.v1');assert.equal(result.execution.shots[0]!.sourceStrategy,'customer_real_asset');assert.deepEqual(result.assets[0]!.segments,[{id:'reviewed-segment',start:4,end:7}]);assert.equal(result.execution.shots[0]!.attempts.length,1);
});
test('mismatched generation duration stops before any paid adapter',async()=>{
 const p=plan('product','missing');p.shots[0]!.productSceneReplication!.cameraLock.durationSeconds=4;let paid=0;
 await assert.rejects(run(p,[{adapterId:'must-not-pay',sourceStrategies:['aigc_product_scene_replication'],async execute(){paid++;return null;}}]),/product_generation_contract/);assert.equal(paid,0);
});

function entryPlan(kind:'factory'|'consumer_demo'|'product', candidates: Parameters<typeof materialRoutingRequests>[0]['candidates']) {
 const brief=parseSocialTaskBrief(JSON.parse(JSON.stringify(defaultBrief(parseCreateSocialTask({title:'正常新任务',objective:'真实素材视频',productRef:'SKU-1',creationMode:'viral_replication',productionApproach:'ai_enhanced'})))));
 const description=kind==='factory'?'工厂输送带灌装产品':kind==='consumer_demo'?'消费者涂抹产品上脸':'手握包装盒晃一圈';
 const visual=normalizeSceneVisualContract({subjects:kind==='factory'?['factory']:['person','product'],interaction:{kind:kind==='factory'?'factory_process':kind==='consumer_demo'?'person_using_product':'person_holding_product',description},action:{path:description},productRef:kind==='product'?'SKU-1':null,productPolicy:kind==='product'?'locked':'open'});
 const requests=materialRoutingRequests({policyVersion:brief.materialRoutingPolicyVersion,tenantId:'tenant',productRef:brief.productRef,shots:[{shotId:'S01',function:'value',materialType:kind,requestedDescription:description,visualContract:visual}],candidates});
 return {visual,plan:createSocialAssetSupplyPlan({creationMode:brief.creationMode!,productionApproach:brief.productionApproach!,materialRoutingPolicyVersion:brief.materialRoutingPolicyVersion,inventory:{customerVideoIds:['real-video'],factoryEvidenceAssetIds:['real-video'],productIdentityGroups:[{productRef:'SKU-1',imageIds:['actual-product-image']}]},shots:requests})};
}
test('normal task API parser and persisted brief drive real local execution for factory, consumer and exact SKU action',async()=>{
 const {existingAssetSupplyAdapters}=await import('./socialContentProductionSupport.js');
 for(const kind of ['factory','consumer_demo','product'] as const){
  const {visual}=entryPlan(kind,[]);
  const candidate={assetId:'real-video',sourceRef:'real-video',segmentId:'verified-action',origin:'my_materials',mediaType:'video',productRef:'SKU-1',materialRoles:kind==='factory'?['factory']:kind==='consumer_demo'?['person_usage']:['product'],visualContract:visual,timeRange:{startSeconds:3,endSeconds:6}} as Parameters<typeof materialRoutingRequests>[0]['candidates'][number];
  const p=entryPlan(kind,[candidate]).plan;let paid=0;
  const result=await executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'new-task',outputDirectory:'/unused',plan:p,baseline,availableAssets:[{id:'real-video',sourceId:'real-video',type:'video',name:'owned',url:'local',localPath:'local',duration:9,segments:[{id:'verified-action',start:3,end:6}]} as any],adapters:[...existingAssetSupplyAdapters(),{adapterId:'paid-trap',sourceStrategies:['aigc_product_scene_replication','non_evidentiary_ai_visual'],async execute(){paid++;throw Error('paid');}}]});
  assert.equal(result.plan.materialRoutingPolicyVersion,'type-aware.v1');assert.equal(result.execution.shots[0]!.sourceStrategy,'customer_real_asset');assert.deepEqual(result.assets[0]!.segments,[{id:'verified-action',start:3,end:6}]);assert.equal(paid,0);
 }
});
test('normal new task missing factory or consumer evidence blocks instead of converting inventory into AI permission',async()=>{
 for(const kind of ['factory','consumer_demo'] as const){let calls=0;await assert.rejects(run(entryPlan(kind,[]).plan,[{adapterId:'any-provider',sourceStrategies:['customer_real_asset','aigc_product_scene_replication','authorized_digital_presenter'],async execute(){calls++;return null;}}]),/local_real_video_required/);assert.equal(calls,0);}
});
test('normal new task wrong SKU or missing requested movement selects product replacement, not unrelated local footage',()=>{
 const {visual}=entryPlan('product',[]);
 for(const candidate of [{productRef:'OTHER',visualContract:visual},{productRef:'SKU-1',visualContract:normalizeSceneVisualContract({...visual,action:{path:'手握包装盒静止展示'},interaction:{kind:'person_holding_product',description:'手握包装盒静止展示'}})}]){
  const p=entryPlan('product',[{assetId:'real-video',sourceRef:'real-video',segmentId:'wrong',origin:'my_materials',mediaType:'video',materialRoles:['product'],timeRange:{startSeconds:3,endSeconds:6},...candidate} as Parameters<typeof materialRoutingRequests>[0]['candidates'][number]]).plan;
  assert.equal(p.shots[0]!.sourceStrategy,'aigc_product_scene_replication');assert.equal(p.shots[0]!.materialRouting?.localMatch.state,'missing');assert.equal(p.shots[0]!.materialRouting?.generation?.durationSeconds,3);
 }
});
test('stored historical brief and frozen plan remain unmarked through baseline alignment',()=>{
 const brief=defaultBrief(parseCreateSocialTask({title:'历史兼容',objective:'保持原计划'}));delete brief.materialRoutingPolicyVersion;
 assert.equal(parseSocialTaskBrief(JSON.parse(JSON.stringify(brief))).materialRoutingPolicyVersion,undefined);
 const old=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',inventory:{productImageIds:['actual-product-image']},shots:[{shotId:'S01',function:'value',requestedDescription:'Product scene'}]});
 const snapshot=JSON.stringify(old);const aligned=alignSocialAssetSupplyPlanToBaseline({plan:old,baseline});assert.equal(aligned.materialRoutingPolicyVersion,undefined);assert.equal(aligned.shots[0]!.materialRouting,undefined);assert.equal(JSON.stringify(old),snapshot);
});
test('new typed talking-head route uses real presenter authorization adapter; missing consent never reserves or submits',async()=>{
 const {createSocialDigitalPresenterAdapter}=await import('./socialContentDigitalPresenterAdapter.js');
 const brief=parseSocialTaskBrief(defaultBrief(parseCreateSocialTask({title:'人物口播',objective:'产品介绍',creationMode:'viral_replication'})));
 const p=createSocialAssetSupplyPlan({creationMode:brief.creationMode!,materialRoutingPolicyVersion:brief.materialRoutingPolicyVersion,inventory:{presenterAssetIds:['person-1']},shots:[{shotId:'S01',function:'hook',materialType:'talking_head',requestedDescription:'真人对镜口播'}]});
 let reservations=0,submissions=0;
 const presenter=createSocialDigitalPresenterAdapter({async resolvePresenter(){return {presenterAssetId:'person-1',providerId:'heygen',providerPresenterId:'avatar-1',providerVoiceId:'voice-1',authorizationRef:'rights-1',consentRef:'',assetVersion:1,authorized:true};},async authorizeBudget(){reservations++;return {allowed:true,reservationRef:'must-not-reserve'};},async execute(){submissions++;throw Error('must-not-submit');}});
 await assert.rejects(run(p,[presenter]),/asset_supply|presenter|unavailable/);assert.equal(reservations,0);assert.equal(submissions,0);assert.equal(p.shots[0]!.fallbackSourceStrategy,null);
});
