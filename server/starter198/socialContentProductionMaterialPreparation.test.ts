import {assertSocialPresenterRouteAvailable} from './socialContentPresenterRouteAdmission.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareSocialProductionMaterialRouting} from './socialContentProductionMaterialPreparation.js';

test('material preparation loads only the reviewed task scope and propagates a failed load',async()=>{
  let loads=0;
  const input={repository:{materialLibrary:undefined,dataStore:undefined} as any,tenantId:'tenant',taskId:'task',runId:'run',
    detail:{brief:{productionMode:'social_ready',productRef:'sku',productionApproach:'material_cut'},assetSupplyPlan:null,
      sources:[],theme:null,version:'1'} as any,agentWorkflow:{} as any,presenterExecutions:[],
    productionApproach:'material_cut' as const,usesTypeAwareRouting:false,canonicalTypeAwareSupplyPlan:null,outputDir:'/tmp/social-test'};
  const prepared=await prepareSocialProductionMaterialRouting({...input,runtime:{loadProductionAssets:async request=>{
    loads++;
    assert.equal(request.tenantId,'tenant');
    assert.equal(request.productRef,'sku');
    assert.equal(request.allowAuthorizedSharedLibrary,false);
    assert.equal(request.requiredMaterialIds,undefined);
    return [];
  }}});
  assert.equal(loads,1);
  assert.deepEqual(prepared.rawAssets,[]);
  assert.deepEqual(prepared.materialInputs.analyze,[]);
  await assert.rejects(prepareSocialProductionMaterialRouting({...input,runtime:{loadProductionAssets:async()=>{
    throw new Error('material_load_failed');
  }}}),/material_load_failed/);
});


test('generated speech is a product route blocker before material work or any paid producer; no silent fallback',async()=>{
  let loads=0;
  const plan={shots:[{shotId:'speaker',sourceStrategy:'authorized_digital_presenter',digitalHumanPlan:{method:'talking_head',presenterAssetIds:['person']}}]};
  const original=structuredClone(plan);
  await assert.rejects(prepareSocialProductionMaterialRouting({
    repository:{} as any,tenantId:'t',taskId:'task',runId:'run',
    detail:{brief:{productionApproach:'ai_enhanced'},assetSupplyPlan:plan,version:'1'} as any,
    agentWorkflow:{executionPlan:{scenes:[]},directorBrief:{scenes:[]}} as any,presenterExecutions:[],productionApproach:'ai_enhanced',
    usesTypeAwareRouting:false,canonicalTypeAwareSupplyPlan:null,outputDir:'/tmp/never-generate',
    runtime:{loadProductionAssets:async()=>{loads++;return [];}}
  }), /user_input_required:presenter_speech_route_unavailable:.*上传已授权.*重新确认/);
  assert.equal(loads,0);
  assert.deepEqual(plan,original);
});


test('measured silent Seedance selection can normalize an action route without opening speech generation',()=>{
 const plan={shots:[{shotId:'motion',sourceStrategy:'authorized_digital_presenter',digitalHumanPlan:{method:'reenact'}}]} as any;
 assert.throws(()=>assertSocialPresenterRouteAvailable(plan),/presenter_speech_route_unavailable/);
 assert.doesNotThrow(()=>assertSocialPresenterRouteAvailable(plan,new Set(['motion'])));
 plan.shots[0].digitalHumanPlan.method='talking_head';
 assert.throws(()=>assertSocialPresenterRouteAvailable(plan,new Set(['motion'])),/presenter_speech_route_unavailable/);
});
