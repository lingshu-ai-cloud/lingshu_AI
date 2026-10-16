import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedancePresenterFunding } from './socialContentSeedancePresenterFunding.js';
import { paidProductionHash, type BoundPaidRoute } from './socialContentPaidOperationPlan.js';
test('motion runtime consumes exact reserved whole-film intent and measured usage, then records actual receipt', async () => {
  const scope = { tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64) };
  const calls:any[]=[];
  const requirements = ['presenter_video','video_qa'].map(stage=>({key:`motion:${stage}`,stage,shotId:stage==='video_qa'?'presenter-motion:s1':null,sourceRef:null,durationSeconds:3,text:null,frameCount:stage==='video_qa'?4:null,presenterGroupId:'presenter-motion:s1',inputContractHash:'b'.repeat(64)}));
  const routes:Record<string,BoundPaidRoute>=Object.fromEntries(requirements.map(r=>[r.key,{provider:r.stage==='presenter_video'?'seedance':'qwen',model:r.stage==='presenter_video'?'controlled-seedance':'qwen3-vl-plus',accountRef:'real-account',routeEvidenceRef:'real-route',usageBoundRef:'enforced-billing',maximumAttempts:1,maximumUnits:(r.stage==='presenter_video'?{providerSeconds:4}:{inputTokens:100,outputTokens:4096}) as Record<string,number>}]));
  const intents=requirements.map(requirement=>{const route=routes[requirement.key]!;return{operationId:`paid-plan:${paidProductionHash({scope,key:requirement.key,attempt:0})}`,provider:route.provider,model:route.model,accountRef:route.accountRef,stage:requirement.stage,shotId:requirement.shotId,inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};});
  const funding=createSeedancePresenterFunding({scope,requirements,routes,intents,
    ports:{assertProviderBinding:async()=>{},measureInputTokens:async()=>80},
    permit:{beforeSubmit:async (value:unknown)=>{calls.push(value);},markOutcome:async(...args:unknown[])=>{calls.push(args);}} as any,
    readReservedCny:()=>1,persistReceipt:async()=> 'actual-provider-receipt',
  });
  await assert.rejects(funding.authorize('s1',.5),/reservation_exceeds_allowance/);
  assert.equal((await funding.authorize('s1',2)).allowed,true);
  const body={model:'controlled-seedance',generate_audio:false,resolution:'720p',duration:4,content:[{role:'first_frame'}]};
  await funding.beforeSubmit('s1','presenter_video',body);
  assert.deepEqual(calls[0].actualUnits,{providerSeconds:4});
  await assert.rejects(funding.beforeSubmit('s1','presenter_video',{...body,model:'other'}),/paid_model_changed/);
  await funding.beforeSubmit('s1','video_qa',{model:'qwen3-vl-plus',enable_thinking:false,max_tokens:4096,messages:[{content:Array.from({length:4},()=>({type:'image_url'}))}]});
  assert.deepEqual(calls[1].actualUnits,{inputTokens:80,outputTokens:4096});
  await funding.receipt('s1','presenter_video',{providerTaskId:'actual-task'});
  assert.equal(calls[2][1],'completed');assert.equal(calls[2][2],'actual-provider-receipt');
});
