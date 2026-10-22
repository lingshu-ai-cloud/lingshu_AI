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
