import test from 'node:test';import assert from 'node:assert/strict';
import {planTypeAwareProductScriptTiming} from './socialContentMaterialTiming';
import {createSocialAssetSupplyPlan} from './socialContentAssetSupply';
// Timing tests exercise an explicitly frozen historical generated route, not a
// newly authored V1 local-only plan or a V2 unselected budget candidate.
const plan=createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v2',inventory:{productImageIds:['actual-product']},shots:[{shotId:'product',function:'demonstration',materialType:'product'}]}).shots[0];
plan.sourceStrategy='aigc_product_scene_replication';
plan.materialRouting!.policy='local_first_product_i2v';
delete plan.materialRouting!.productGenerationDecision;
function script():any{return {version:'new-draft-1',status:'draft',referenceAnalysisId:'reference',primaryHookId:'hook',hookOptions:[],createdAt:'2026-10-11',structureFidelitySummary:'reference structure',originalityDifferenceSummary:'own product',shots:[{shotId:'product',referenceShotId:null,startSeconds:0,endSeconds:8,purpose:'demonstration',visualInstruction:'产品手持晃一圈',spokenText:null,captionText:'Own product',materialPlan:structuredClone(plan),risks:[]},{shotId:'next',referenceShotId:null,startSeconds:8,endSeconds:12,purpose:'transition',visualInstruction:'转场',spokenText:null,materialPlan:{...structuredClone(plan),sourceStrategy:'customer_real_asset'},risks:[]}]};}
const run=(s:any,extra:any={})=>planTypeAwareProductScriptTiming({policyVersion:'type-aware.v1',script:s,...extra});
test('new silent product short-shot retimes the whole visual timeline and its material specification',()=>{
 const source=script(),before=JSON.stringify(source),result=run(source);
 assert.deepEqual(result.script.shots.map(s=>[s.startSeconds,s.endSeconds]),[[0,3],[3,7]]);assert.deepEqual(result.changedShotIds,['product']);assert.equal(result.script.status,'review_required');assert.equal(result.script.shots[0].materialPlan.productSceneReplication!.cameraLock.durationSeconds,3);assert.equal(JSON.stringify(source),before);
});
test('measured speech spanning a product cut protects its duration and all original ASR evidence',()=>{
 const source=script();source.narrationLines=[{draftText:'Never cut this measured sentence.',sourceStartSeconds:0,sourceEndSeconds:10,sourceWords:[{start:0,end:10,text:'measured'}],visualShotIds:['product','next']}];const before=JSON.stringify(source.narrationLines),result=run(source);
 assert.deepEqual(result.protectedShotIds,['product']);assert.deepEqual(result.script.shots.map(s=>[s.startSeconds,s.endSeconds]),[[0,8],[8,12]]);assert.equal(JSON.stringify(result.script.narrationLines),before);assert.equal(result.script.shots[0].materialPlan.productSceneReplication!.cameraLock.durationSeconds,8);
});
test('subsequent narration is moved as a visual slot with full duration and explicitly needs review, without changing source words',()=>{
 const source=script();source.shots[1].spokenText='Full natural narration.';source.shots[1].speechLines=[{draftText:'Full natural narration.',sourceStartSeconds:8,sourceEndSeconds:12,sourceWords:[{start:8,end:12,text:'Full'}],narrationOwnerShotId:'next'}];const before=JSON.stringify(source.shots[1].speechLines),result=run(source);
 assert.equal(result.narrationReviewRequired,true);assert.equal(result.script.shots[1].endSeconds-result.script.shots[1].startSeconds,4);assert.equal(JSON.stringify(result.script.shots[1].speechLines),before);
});
test('confirmed, explicit revision, and historical scripts are not rewritten; explicit shot duration also stays frozen',()=>{
 const source=script();assert.equal(planTypeAwareProductScriptTiming({script:source}).script,source);assert.equal(run(source,{explicitFrozenRevision:true}).script,source);source.status='confirmed';assert.equal(run(source).script,source);
 const explicit=script();explicit.shots[0].materialPlan.materialRouting.generation.durationOrigin='explicit_frozen';assert.equal(run(explicit).script,explicit);
});
test('own spoken product timing and malformed scene ranges cannot become a silent three-second clip',()=>{
 const source=script();source.shots[0].spokenText='Complete narration requiring eight seconds.';assert.deepEqual(run(source).protectedShotIds,['product']);assert.equal(run(source).script.shots[0].endSeconds,8);
 for(const changed of [{startSeconds:NaN},{endSeconds:0},{startSeconds:-1}]){const bad=script();Object.assign(bad.shots[0],changed);assert.throws(()=>run(bad),/material_script_timing_invalid/);}
});

test('single-source fidelity keeps every reference slot and narration while planning short product source clips',()=>{
 const source=script();source.shots[1].spokenText='Later narration stays at eight seconds.';
 const before=structuredClone(source);const result=run(source,{referenceMode:'single_source_fidelity'});
 assert.deepEqual(result.changedShotIds,[]);
 assert.deepEqual(result.script.shots.map(s=>[s.shotId,s.startSeconds,s.endSeconds]),before.shots.map(s=>[s.shotId,s.startSeconds,s.endSeconds]));
 assert.equal(result.script.shots[0].materialPlan.productSceneReplication!.cameraLock.durationSeconds,3);
 assert.equal(result.script.shots[0].materialPlan.materialRouting!.generation!.durationSeconds,3);
 assert.equal(result.narrationReviewRequired,false);assert.deepEqual(source,before);
});

test('short product source can be reconstructed for its longer reference slot without changing the frozen source contract',()=>{
 const timed=run(script(),{referenceMode:'single_source_fidelity'}).script.shots[0];
 const reconstructed=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v1',inventory:{productImageIds:['actual-product']},shots:[{shotId:timed.shotId,function:timed.purpose,materialType:'product',plannedDurationSeconds:timed.materialPlan.materialRouting!.generation!.durationSeconds,productSceneReplication:timed.materialPlan.productSceneReplication,materialRouting:timed.materialPlan.materialRouting}]}).shots[0];
 assert.equal(reconstructed.productSceneReplication!.cameraLock.durationSeconds,3);assert.equal(reconstructed.materialRouting!.generation!.durationOrigin,'default_short_shot');
});
