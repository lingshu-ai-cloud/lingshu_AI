import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {buildSocialAgentWorkflow} from './socialContentAgentWorkflow.js';
import {defaultBrief} from './socialContentTaskSupport.js';
import {parseCreateSocialTask} from './socialContentValidation.js';

function workflow(images:string[],runtime=true,version:'type-aware.v1'|'type-aware.v2'='type-aware.v2',maximum=15,rightsMissing=false){
 const brief=defaultBrief(parseCreateSocialTask({title:'产品展示',objective:'展示企业产品',productRef:'SKU-1',perItemBudgetCny:15,creationMode:'material_processing',productionApproach:'ai_enhanced',targetDurationSeconds:6}));
 brief.materialRoutingPolicyVersion=version;
 brief.perItemBudgetCny=maximum;
 const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:version,
  inventory:{productIdentityGroups:[{productRef:'SKU-1',imageIds:images}]},shots:[{shotId:'product',function:'demonstration',materialType:'product',productRef:'SKU-1',plannedDurationSeconds:3}]});
 if(rightsMissing)plan.status='requires_rights_confirmation';
 return buildSocialAgentWorkflow({taskId:'task',taskVersion:'1',taskStatus:'plan_review',mode:'instant',weeklyPlanId:null,brief,sources:[],factSourceRefs:['knowledge:product'],assetSupplyPlan:plan,referenceAnalysis:null,replicationScript:null,
  capabilityRuntime:runtime?[{strategy:'aigc_product_scene_replication',adapterIds:['controlled-generation-port'],environmentReady:true,reason:null}]:[]});
}
test('v2 eligible exact-product generation passes candidate review toward real budget preflight, never by faking a local match',()=>{
 const w=workflow(['real-product-image']),scene=w.executionPlan.scenes[0]!;
 assert.equal(scene.selectedSourceStrategy,'aigc_product_scene_replication');
 assert.equal(scene.feasibility,'functional_equivalent');
 assert.ok(scene.recommendedCandidateIds.length);
 assert.equal(w.executionPlanReview.reasonCodes.includes('material_insufficient'),false);
 assert.match(scene.feasibilityReason,/真实报价预检/);
});
test('missing current product images, absent runtime or v1 local-only cannot use provisional generation entry',()=>{
 for(const w of [workflow([]),workflow(['real-product-image'],false),workflow(['real-product-image'],true,'type-aware.v1')]){
  const scene=w.executionPlan.scenes[0]!;
  assert.equal(scene.recommendedCandidateIds.length,0);
  assert.equal(w.executionPlanReview.approved,false);
  assert.equal(w.executionPlanReview.reasonCodes.includes('capability_mismatch'),true);
 }
});
test('V2 advisory registry estimate cannot prevent real quote preflight, and is retained as pending not a paid approval',()=>{
 const w=workflow(['real-product-image'],true,'type-aware.v2',0.01);
 assert.equal(w.executionPlanReview.reasonCodes.includes('budget_exceeded'),false);
 assert.deepEqual(w.executionPlanReview.budgetPreflight?.state,'required');
 assert.equal(w.executionPlanReview.budgetPreflight?.maximumCny,0.01);
 assert.equal(w.executionPlanReview.budgetPreflight?.advisoryExceeded,true);
 assert.ok(w.executionPlanReview.budgetPreflight!.advisoryEstimatedCostCny>0.01);
});
test('deferred budget estimate does not hide missing rights',()=>{
 const w=workflow(['real-product-image'],true,'type-aware.v2',0.01,true);
 assert.equal(w.executionPlanReview.approved,false);
 assert.equal(w.executionPlanReview.reasonCodes.includes('rights_missing'),true);
 assert.equal(w.executionPlanReview.budgetPreflight?.state,'required');
});
