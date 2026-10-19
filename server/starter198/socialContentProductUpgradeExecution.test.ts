import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {executeSocialAssetSupplyPlan,alignSocialAssetSupplyPlanToBaseline,type SocialAssetSupplyProviderAdapter} from './socialContentAssetSupplyExecution.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
const baseline={schemaVersion:'social-content-script-baseline.v1',version:'upgrade-fixture',source:'knowledge_fallback',formulaReference:null,themeId:null,language:'en',lockedAt:'2026-10-15T00:00:00Z',createdBeforeMaterialAdaptation:true,scenes:[{sceneId:'product',formulaNodeId:null,shotFunction:'demonstration',subject:'product',action:'show',voiceover:'Our product.',narration:'Our product.'}]} as StoredSocialScriptBaseline;
function plan(){
 const p=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v2',
  inventory:{customerVideoIds:['own-local'],productIdentityGroups:[{productRef:'SKU-1',imageIds:['own-image']}]},
  shots:[{shotId:'product',function:'demonstration',materialType:'product',productRef:'SKU-1',plannedDurationSeconds:3,
   localVideoMatch:{sourceRefs:['own-local'],semanticMatch:'verified',evidenceRef:'exact-visual-proof',productRef:'SKU-1'},
   selectedMaterialSegment:{sourceRef:'own-local',segmentId:'same-scene',startSeconds:2,endSeconds:5}}]});
 const shot=p.shots[0]!,routing=shot.materialRouting!;
 routing.policy='local_first_product_i2v';
 routing.productGenerationDecision={...routing.productGenerationDecision!,state:'selected',quoteRef:'actual-quote-fixture',budgetPlanRef:'server-plan-fixture',estimatedCostCny:2};
 shot.sourceStrategy='aigc_product_scene_replication';shot.sourceRefs=['own-image'];
 shot.truthBoundary.syntheticVisualAllowed=true;shot.truthBoundary.mustNotImplyCustomerReality=true;
 return p;
}
const execute=(p:ReturnType<typeof plan>,adapters:SocialAssetSupplyProviderAdapter[])=>executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:'/tmp/no-paid-upgrade-test',plan:p,baseline,availableAssets:[],adapters});
test('selected V2 product upgrade retains exact local provenance but dispatches only generated route',async()=>{
 const p=plan(),before=structuredClone(p.shots[0]!.materialRouting!.localMatch);
 const aligned=alignSocialAssetSupplyPlanToBaseline({plan:p,baseline});
 assert.deepEqual(aligned.shots[0]!.sourceRefs,['own-image']);
 assert.deepEqual(aligned.shots[0]!.materialRouting!.localMatch,before);
 let local=0,generated=0;
 await assert.rejects(execute(p,[
  {adapterId:'local-trap',sourceStrategies:['customer_real_asset'],async execute(){local++;return null;}},
  {adapterId:'controlled-generation',sourceStrategies:['aigc_product_scene_replication'],async execute(context){generated++;assert.deepEqual(context.shot.materialRouting!.localMatch,before);throw Error('controlled_stop_before_provider');}},
 ]),/controlled_stop_before_provider/);
 assert.equal(local,0);assert.equal(generated,1);
});
test('missing budget proof, wrong version or wrong SKU stops upgrade before any adapter',async()=>{
 for(const mutate of [
  (p:ReturnType<typeof plan>)=>{delete p.shots[0]!.materialRouting!.productGenerationDecision!.quoteRef;},
  (p:ReturnType<typeof plan>)=>{delete p.shots[0]!.materialRouting!.productGenerationDecision!.budgetPlanRef;},
  (p:ReturnType<typeof plan>)=>{p.materialRoutingPolicyVersion='type-aware.v1';},
  (p:ReturnType<typeof plan>)=>{p.shots[0]!.materialRouting!.localMatch.productRef='wrong-SKU';},
 ]){
  const p=plan();mutate(p);let calls=0;
  await assert.rejects(execute(p,[{adapterId:'must-not-call',sourceStrategies:['aigc_product_scene_replication','customer_real_asset'],async execute(){calls++;return null;}}]),/product_selected|selected_local_provenance/);
  assert.equal(calls,0);
 }
});
