import test from 'node:test';
import assert from 'node:assert/strict';
import {bindProductPaidStage, hasProductPaidStage, productPaidReservedCostCny, type ProductPaidContext, type ProductPaidStage} from './socialContentProductPaidContext.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';
const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
function fixture(stage:ProductPaidStage) {
 const requirement={key:`scene:S04:${stage}`,stage,shotId:'S04',sourceRef:null,durationSeconds:stage==='video'?3:null,text:null,frameCount:stage.endsWith('_qa')?5:null,inputContractHash:'b'.repeat(64)};
 const route: import('./socialContentPaidOperationPlan.js').BoundPaidRoute={provider:stage.endsWith('_qa')?'qwen':stage==='video'?'seedance':'seedream',model:'bound-model',accountRef:'actual-account',routeEvidenceRef:'actual-route',usageBoundRef:'actual-bounds',maximumAttempts:1,maximumUnits:stage.endsWith('_qa')?{inputTokens:32000,outputTokens:4096,frames:5}:stage==='video'?{providerSeconds:4,requests:1}:{images:2,requests:1}};
 const intent={operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage,shotId:'S04',inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};
 const calls:any[]=[];let providerChecks=0;
 const context:ProductPaidContext={scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[intent],readReservedCny:()=>1,assertRecovery:async()=>{},permit:{beforeSubmit:async req=>{calls.push(req);return {operationId:req.operationId,fingerprint:'bound'};},markOutcome:async()=>{},assertRecovery:async()=>{throw Error('unused');}},assertProviderBinding:async()=>{providerChecks++;},measureInputTokens:async body=>JSON.stringify(body).length};
 return {context,calls,providerChecks:()=>providerChecks};
}
test('attempt one binds only the separately reserved video and video QA intents',()=>{
 for(const stage of ['video','video_qa'] as const){const f=fixture(stage),r=f.context.requirements[0]!,route=f.context.routeBindings[r.key]!;f.context.intents.push({...f.context.intents[0]!,operationId:'paid-plan:'+paidProductionHash({scope,key:r.key,attempt:1}),inputContractHash:paidProductionHash({requirement:r,route,attempt:1})});assert.equal(bindProductPaidStage(f.context,'S04',stage,1).intent.operationId,f.context.intents[1]!.operationId);}
 const frame=fixture('first_frame');assert.throws(()=>bindProductPaidStage(frame.context,'S04','first_frame',1),/attempt_invalid/);
});
test('product shot audit includes both reserved retry operations without duplicating static stages',()=>{
 const f=fixture('video');
 f.context.requirements=[];f.context.routeBindings={};f.context.intents=[];f.context.readReservedCny=()=>.5;
 for(const stage of ['first_frame','first_frame_qa','video','video_qa'] as const){
  const part=fixture(stage),requirement=part.context.requirements[0]!,route=part.context.routeBindings[requirement.key]!;
  f.context.requirements.push(requirement);f.context.routeBindings[requirement.key]=route;
  f.context.intents.push(part.context.intents[0]!);
  if(stage==='video'||stage==='video_qa')f.context.intents.push({...part.context.intents[0]!,operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:1}),inputContractHash:paidProductionHash({requirement,route,attempt:1})});
 }
 assert.equal(productPaidReservedCostCny(f.context,'S04'),3);
});
test('funded-attempt discovery distinguishes a missing retry from malformed funding',()=>{
 const f=fixture('video');assert.equal(hasProductPaidStage(f.context,'S04','video',0),true);assert.equal(hasProductPaidStage(f.context,'S04','video',1),false);
 const r=f.context.requirements[0]!,route=f.context.routeBindings[r.key]!;f.context.intents.push({...f.context.intents[0]!,operationId:'paid-plan:'+paidProductionHash({scope,key:r.key,attempt:1}),inputContractHash:paidProductionHash({requirement:r,route,attempt:1})});
 assert.equal(hasProductPaidStage(f.context,'S04','video',1),true);f.context.intents[1]!.inputContractHash='bad';assert.throws(()=>hasProductPaidStage(f.context,'S04','video',1),/canonical_intent_changed/);
});
test('four actual request dimensions are derived from prepared supplier body rather than maximumUnits',async()=>{
 for(const stage of ['first_frame','first_frame_qa','video','video_qa'] as const){const f=fixture(stage),bound=bindProductPaidStage(f.context,'S04',stage);
 const body=stage.endsWith('_qa')?{model:'bound-model',max_tokens:4096,enable_thinking:false,messages:[{content:[{type:'image_url',image_url:{url:'data:image/png;base64,actual'}}]}]}:stage==='video'?{model:'bound-model',duration:4,resolution:'720p',generate_audio:false,content:[{type:'image_url',role:'first_frame',image_url:{url:'data:image/png;base64,actual'}}]}:{model:'bound-model',image:['actual-KB'],prompt:'frozen actual storyboard'};
 const result=await bound.beforeSubmit(body);assert.equal(f.calls.length,1);assert.equal(f.providerChecks(),1);assert.match(result.requestSha256,/^[a-f0-9]{64}$/);
 if(stage.endsWith('_qa')){assert.equal(f.calls[0].actualUnits.frames,1);assert.equal(f.calls[0].actualUnits.outputTokens,4096);assert.equal(f.calls[0].actualUnits.inputTokens,JSON.stringify(body).length);}
 else if(stage==='video')assert.equal(f.calls[0].actualUnits.providerSeconds,4);else assert.equal(f.calls[0].actualUnits.images,1);
 }
});
test('missing canonical routes, altered intent hash, model and omitted actual request units block before supplier claim',async()=>{
 const f=fixture('video');delete f.context.routeBindings['scene:S04:video'];assert.throws(()=>bindProductPaidStage(f.context,'S04','video'),/canonical_route_missing/);
 const g=fixture('video');g.context.intents[0]!.inputContractHash='bad';assert.throws(()=>bindProductPaidStage(g.context,'S04','video'),/canonical_intent_changed/);
 const h=fixture('video');await assert.rejects(bindProductPaidStage(h.context,'S04','video').beforeSubmit({model:'other'}),/model_changed/);await assert.rejects(bindProductPaidStage(h.context,'S04','video').beforeSubmit({model:'bound-model'}),/usage_invalid/);assert.equal(h.calls.length,0);
});

test('formal Ark units count real reference inputs and delegate actual video token measurement, never max_tokens or maximumUnits',async()=>{
 const image=fixture('first_frame'), key='scene:S04:first_frame', route=image.context.routeBindings[key]!;
 route.maximumUnits={inputImages:2,outputImages:1};image.context.intents[0]!.maximumUnits=route.maximumUnits;
 image.context.intents[0]!.inputContractHash=paidProductionHash({requirement:image.context.requirements[0],route,attempt:0});
 await bindProductPaidStage(image.context,'S04','first_frame').beforeSubmit({model:'bound-model',image:['actual-KB-1','actual-KB-2'],prompt:'actual frozen director scene'});
 assert.deepEqual(image.calls[0].actualUnits,{inputImages:2,outputImages:1});
 const video=fixture('video'), vk='scene:S04:video', vr=video.context.routeBindings[vk]!;vr.maximumUnits={outputTokens:100000};video.context.intents[0]!.maximumUnits=vr.maximumUnits;video.context.intents[0]!.inputContractHash=paidProductionHash({requirement:video.context.requirements[0],route:vr,attempt:0});
 const body={model:'bound-model',duration:4,resolution:'720p',generate_audio:false,content:[{role:'first_frame',type:'image_url'}]};
 await assert.rejects(bindProductPaidStage(video.context,'S04','video').beforeSubmit(body),/video_token_measurement_missing/);
 video.context.measureVideoOutputTokens=async actual=>{assert.equal(actual.duration,4);assert.equal(actual.resolution,'720p');return 87300;};
 await bindProductPaidStage(video.context,'S04','video').beforeSubmit(body);assert.deepEqual(video.calls[0].actualUnits,{outputTokens:87300});
});
test('real prepared Wan request consumes exactly frozen silent seconds and rejects paid audio changes',async()=>{
 const {prepareWanImageVideoRequest}=await import('../lib/wanImageVideo.js');const {createHash}=await import('node:crypto');const frame=Buffer.from('actual licensed KB frame');
 const f=fixture('video'),key='scene:S04:video',route=f.context.routeBindings[key]!;Object.assign(route,{provider:'wan',model:'wan2.6-i2v-flash',maximumUnits:{providerSeconds:3}});Object.assign(f.context.intents[0]!,{provider:route.provider,model:route.model,maximumUnits:route.maximumUnits,inputContractHash:paidProductionHash({requirement:f.context.requirements[0],route,attempt:0})});
 const prepared=prepareWanImageVideoRequest({model:'wan2.6-i2v-flash',firstFrame:frame,mimeType:'image/png',prompt:'Preserve actual package',durationSeconds:3,firstFrameSha256:createHash('sha256').update(frame).digest('hex'),inputContractHash:'a'.repeat(64)});
 const bound=bindProductPaidStage(f.context,'S04','video');await bound.beforeSubmit(prepared.body);assert.deepEqual(f.calls[0].actualUnits,{providerSeconds:3});
 await assert.rejects(bound.beforeSubmit({...prepared.body,parameters:{...prepared.body.parameters,audio:true}}),/wan_i2v_request_changed/);assert.equal(f.calls.length,1);
});
