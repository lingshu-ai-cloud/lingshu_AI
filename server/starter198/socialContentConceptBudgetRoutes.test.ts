import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createProductionBudgetRouteReaders,type FrozenConceptVideoBudgetInputs} from './socialContentProductionBudgetRoutes.js';
import type {PaidStageRequirement} from './socialContentPaidOperationPlan.js';

test('concept quote requires an independently frozen account-bound usage ceiling; absent/changed evidence blocks',async()=>{
 const env={SEEDANCE_API_KEY:'fixture-only-key',SEEDANCE_MODEL:'fixture-model',SEEDANCE_BASE_URL:'https://ark.cn-beijing.volces.com/api/v3'};
 const r:PaidStageRequirement={key:'concept',stage:'concept_video',shotId:'scene',sourceRef:null,durationSeconds:5,text:null,frameCount:null,inputContractHash:'a'.repeat(64)};
 let bound:FrozenConceptVideoBudgetInputs|null={inputContractHash:r.inputContractHash,model:env.SEEDANCE_MODEL,baseUrl:env.SEEDANCE_BASE_URL,
  credentialSha256:createHash('sha256').update(env.SEEDANCE_API_KEY).digest('hex'),providerDurationSeconds:5,maximumOutputTokens:100000,usageBoundRef:'fixture:independent-account-contract'};
 const reader=createProductionBudgetRouteReaders({env:()=>env,readFrozenConceptVideo:async()=>bound});
 const result=await reader.resolveBoundRoute(r);assert.equal(result?.provider,'seedance');assert.deepEqual(result?.maximumUnits,{outputTokens:100000});
 for(const patch of [{usageBoundRef:''},{model:'other'},{credentialSha256:'b'.repeat(64)},{providerDurationSeconds:6},{maximumOutputTokens:NaN}]){
  const saved:FrozenConceptVideoBudgetInputs|null=bound;bound={...bound!,...patch};assert.equal(await reader.resolveBoundRoute(r),null);bound=saved;
 }
 bound=null;assert.equal(await reader.resolveBoundRoute(r),null);
});
