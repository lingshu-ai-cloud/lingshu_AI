import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPresenterFirstBudgetRouting} from './socialContentBudgetRouting.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {executeSocialAssetSupplyPlan,alignSocialAssetSupplyPlanToBaseline} from './socialContentAssetSupplyExecution.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
const shot=(id:string,type='product',local=true,critical=true)=>({shotId:id,sourceStrategy:type==='talking_head'?'authorized_digital_presenter':'customer_real_asset',fallbackSourceStrategy:null,sourceRefs:[id],feasibility:'ready',feasibilityReason:'ready',productionInstruction:'original',
 selectedMaterialSegment:local?{sourceRef:id,segmentId:`seg-${id}`,startSeconds:0,endSeconds:3}:undefined,
 materialRouting:{materialType:type,policy:type==='talking_head'?'authorized_presenter':'local_only',localMatch:{state:local?'matched':'missing',sourceRefs:local?[id]:[],evidenceRef:local?`verified:${id}`:null,productRef:'sku',sourceTier:type==='product'?'product_high_fidelity_local':undefined},
 ...(type==='product'?{productGenerationDecision:{state:'eligible',importance:critical?'critical':'standard',reason:'candidate'},generation:{method:'enterprise_authored_product_first_frame_i2v',videoProvider:'seedance',durationSeconds:3,productImageRefs:['image'],referenceShotId:null,referenceSourceId:null}}:{})},
 ...(type==='product'?{productSceneReplication:{productIdentity:{groups:[{productRef:'sku',referenceImageIds:['image']}]}}}:{})} as any);
function fixture(shots:any[]){return{plan:{shots}as any,workflow:{directorBrief:{scenes:shots.map(s=>({sceneId:s.shotId,duration:{startSeconds:0,endSeconds:3}}))},executionPlan:{scenes:shots.map(s=>({sceneId:s.shotId,estimatedCostCny:.001,candidates:[]}))}}as any,maximumCny:15};}
const quote=(base:number,perProduct=2)=>async(plan:any)=>({maximumCny:15,wholeTaskUpperBoundCny:base+plan.shots.filter((s:any)=>s.sourceStrategy==='aigc_product_scene_replication').length*perProduct,items:plan.shots.filter((s:any)=>s.sourceStrategy==='aigc_product_scene_replication').map((s:any)=>({shotId:s.shotId,upperBoundCny:perProduct,quoteRef:`actual:${s.shotId}`}))});
test('real presenter residual upgrades one critical product, not every product or none',async()=>{
 const f=fixture([shot('presenter','talking_head'),shot('a'),shot('b'),shot('standard','product',true,false)]);
 const result=await applyPresenterFirstBudgetRouting({...f,quote:quote(12,2)});
 assert.deepEqual(result.shots.map(s=>s.sourceStrategy),['authorized_digital_presenter','aigc_product_scene_replication','customer_real_asset','customer_real_asset']);
 assert.match(result.shots[1]!.materialRouting!.productGenerationDecision!.quoteRef!,/^whole-film-quote:/);
 assert.equal(result.shots[1]!.materialRouting!.productGenerationDecision!.estimatedCostCny,2);
 assert.equal(result.shots[2]!.materialRouting!.generation,undefined);assert.equal(result.shots[2]!.productSceneReplication,undefined);
 assert.equal(f.plan.shots[1].materialRouting.productGenerationDecision.state,'eligible');
});
test('presenter consumes cap: preserve all37 scenes and same-scene local sources',async()=>{
 const f=fixture([shot('presenter','talking_head'),...Array.from({length:36},(_,i)=>shot(`p${i}`))]);
 const result=await applyPresenterFirstBudgetRouting({...f,quote:quote(15)});
 assert.equal(result.shots.length,37);assert.equal(result.shots.filter(s=>s.sourceStrategy==='customer_real_asset').length,36);
 assert.deepEqual(result.shots.map(s=>s.shotId),f.plan.shots.map((s:any)=>s.shotId));
});
test('factory/D2C/general/unknown missing local fails before quotation, never borrowing another scene',async()=>{
 for(const type of ['factory','consumer_demo','general','unknown']){
 let calls=0;await assert.rejects(applyPresenterFirstBudgetRouting({...fixture([shot('available'),shot('missing',type,false)]),quote:async()=>{calls++;return{maximumCny:15,wholeTaskUpperBoundCny:0};}}),/local_material_required:missing/);assert.equal(calls,0);
 }
});
test('mandatory product generation allowed only when full-film quote fits',async()=>{
 const f=fixture([shot('presenter','talking_head'),shot('missing','product',false,false)]);
 assert.equal((await applyPresenterFirstBudgetRouting({...f,quote:quote(12,3)})).shots[1]!.sourceStrategy,'aigc_product_scene_replication');
 await assert.rejects(applyPresenterFirstBudgetRouting({...f,quote:quote(13,3)}),/mandatory_plan_exceeds_budget:16:15/);
});
test('wrong SKU and too short local segments never become executable fallback',async()=>{
 const wrong=shot('wrong');wrong.materialRouting.localMatch.productRef='different-sku';wrong.materialRouting.productGenerationDecision.state='local_only';
 const short=shot('short','factory');short.selectedMaterialSegment.endSeconds=.5;
 for(const s of [wrong,short])await assert.rejects(applyPresenterFirstBudgetRouting({...fixture([s]),quote:quote(0)}),/local_material_required/);
});
test('factory and D2C remain local, strip malicious generation despite spare budget',async()=>{
 const factory=shot('factory','factory'),d2c=shot('d2c','consumer_demo');factory.materialRouting.generation={productImageRefs:['not-authorized']};factory.productSceneReplication={};
 const result=await applyPresenterFirstBudgetRouting({...fixture([factory,d2c]),quote:quote(0)});
 assert.ok(result.shots.every(s=>s.sourceStrategy==='customer_real_asset'&&!s.productSceneReplication&&!s.materialRouting?.generation));
});
test('missing mandatory quote blocks; missing optional upgrade quote keeps deliverable local base',async()=>{
 const f=fixture([shot('p')]);let count=0;
 const result=await applyPresenterFirstBudgetRouting({...f,quote:async()=>{if(count++)throw Error('actual_tariff_missing');return{maximumCny:15,wholeTaskUpperBoundCny:3};}});
 assert.equal(result.shots[0]!.sourceStrategy,'customer_real_asset');assert.match(result.shots[0]!.materialRouting!.productGenerationDecision!.reason,/actual_tariff_missing/);
 await assert.rejects(applyPresenterFirstBudgetRouting({...f,quote:async()=>{throw Error('actual_tariff_missing');}}),/actual_tariff_missing/);
});
test('retained unknown spend is not replaced with advisory estimates',async()=>{
 const f=fixture([shot('presenter','talking_head'),shot('p')]);
 const result=await applyPresenterFirstBudgetRouting({...f,quote:async(plan)=>({maximumCny:15,retainedCny:13,wholeTaskUpperBoundCny:plan.shots.some(s=>s.sourceStrategy==='aigc_product_scene_replication')?16:14})});
 assert.equal(result.shots[1]!.sourceStrategy,'customer_real_asset');
 await assert.rejects(applyPresenterFirstBudgetRouting({...f,quote:async()=>({maximumCny:15,retainedCny:13,wholeTaskUpperBoundCny:3})}),/verified_whole_film_quote_missing/);
});
test('selected product requires real per-shot cost items; optional missing proof stays local',async()=>{
 const missing=async()=>({maximumCny:15,wholeTaskUpperBoundCny:5});
 await assert.rejects(applyPresenterFirstBudgetRouting({...fixture([shot('required','product',false)]),quote:missing}),/verified_product_quote_missing/);
 const result=await applyPresenterFirstBudgetRouting({...fixture([shot('optional')]),quote:missing});
 assert.equal(result.shots[0]!.sourceStrategy,'customer_real_asset');
 assert.match(result.shots[0]!.materialRouting!.productGenerationDecision!.reason,/verified_product_quote_missing/);
});
test('allocator to actual supply executor preserves matched provenance and dispatches generated product only',async()=>{
 const p=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v2',
  inventory:{customerVideoIds:['own-local'],productIdentityGroups:[{productRef:'SKU-1',imageIds:['own-image']}]},
  shots:[{shotId:'product',function:'demonstration',materialType:'product',productRef:'SKU-1',plannedDurationSeconds:3,
   localVideoMatch:{sourceRefs:['own-local'],semanticMatch:'verified',evidenceRef:'exact-visual-proof',productRef:'SKU-1'},
   selectedMaterialSegment:{sourceRef:'own-local',segmentId:'same-scene',startSeconds:2,endSeconds:5}}]});
 const f=fixture(p.shots),originalSegment=structuredClone(p.shots[0]!.selectedMaterialSegment);
 const allocated=await applyPresenterFirstBudgetRouting({...f,plan:p,quote:quote(1,2)});
 assert.equal(allocated.shots[0]!.sourceStrategy,'aigc_product_scene_replication');
 assert.deepEqual(allocated.shots[0]!.selectedMaterialSegment,originalSegment);
 assert.deepEqual(allocated.shots[0]!.sourceRefs,['own-image']);
 const baseline={schemaVersion:'social-content-script-baseline.v1',version:'budget-fixture',source:'knowledge_fallback',formulaReference:null,themeId:null,language:'en',lockedAt:'2026-10-15T00:00:00Z',createdBeforeMaterialAdaptation:true,scenes:[{sceneId:'product',formulaNodeId:null,shotFunction:'demonstration',subject:'product',action:'show',voiceover:'Our product.',narration:'Our product.'}]} as StoredSocialScriptBaseline;
 const aligned=alignSocialAssetSupplyPlanToBaseline({plan:allocated,baseline});
 let local=0,generated=0;
 await assert.rejects(executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:'/tmp/budget-no-paid-dispatch-test',plan:aligned,baseline,availableAssets:[],adapters:[
  {adapterId:'local-trap',sourceStrategies:['customer_real_asset'],async execute(){local++;throw Error('wrong_local_route');}},
  {adapterId:'controlled-generation',sourceStrategies:['aigc_product_scene_replication'],async execute(context){generated++;assert.deepEqual(context.shot.selectedMaterialSegment,originalSegment);assert.equal(context.shot.materialRouting!.productGenerationDecision!.estimatedCostCny,2);throw Error('controlled_stop_before_provider');}},
 ]}),/controlled_stop_before_provider/);
 assert.equal(local,0);assert.equal(generated,1);
});
