import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveStudioVoiceExecutionPlan} from '../routes/studio.js';
import {createNativeStudioVoicePaidContext} from './studioNativeVoicePaidContext.js';
import {withStudioVoicePaidContext,submitStudioVoicePaidRequest} from './studioVoicePaidOperation.js';
import {paidProductionHash} from '../starter198/socialContentPaidOperationPlan.js';
import {productionBillingAccountRef} from '../starter198/socialContentProductionBudgetRoutes.js';
function fixture(){const keys=['DASHSCOPE_API_KEY','MINIMAX_API_KEY','MINIMAX_API_TOKEN','TTS_PREFER_EXPRESSIVE_PROVIDER'];const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{DASHSCOPE_API_KEY:'controlled-fixture-only',MINIMAX_API_KEY:'',MINIMAX_API_TOKEN:'',TTS_PREFER_EXPRESSIVE_PROVIDER:'false'});const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};const voiceInput={tenantId:'tenant',text:'First sentence. Second sentence.',voice:'v1',language:'en'};const voice=resolveStudioVoiceExecutionPlan(voiceInput);const primary=voice.primary!;const requirement={key:'voice:0:tts',stage:'tts',shotId:null,sourceRef:null,durationSeconds:null,text:voiceInput.text,frameCount:null,inputContractHash:'b'.repeat(64)};const route={provider:primary.provider,model:primary.model,accountRef:productionBillingAccountRef(primary.provider,primary.endpoint,primary.accountKeyHash),routeEvidenceRef:'actual-native-runtime',usageBoundRef:'actual-text-chars',maximumUnits:{characters:100},maximumAttempts:1};const intent={operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage:'tts',shotId:null,inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};const claims:any[]=[];const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-voice-paid-context-'));const context=createNativeStudioVoicePaidContext({scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[intent],voiceInput,root,assertCurrent:async()=>{},permit:{beforeSubmit:async r=>{claims.push(r);return {operationId:r.operationId,fingerprint:'frozen'};},markOutcome:async()=>{},assertRecovery:async()=>{throw Error('unused');}}});const request={stage:'tts' as const,provider:primary.provider,model:primary.model,voiceId:primary.voiceId,endpoint:primary.endpoint,accountKeyHash:primary.accountKeyHash,request:{model:primary.model,input:{text:primary.texts[0]}}};return{context,request,claims,primary,voiceInput,scope,root,requirement,route,intent,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}}};}
test('default native factory consumes canonical whole intent and automatically persists real receipt and audio cache proof',async()=>{const f=fixture();try{await withStudioVoicePaidContext(f.context,()=>submitStudioVoicePaidRequest(f.request,async()=>({request_id:'controlled-provider',output:{audio:{url:'https://controlled.test/audio.wav'}}})));assert.equal(f.claims.length,1);assert.equal(f.claims[0].actualUnits.characters,f.voiceInput.text.length);const proof={tenantId:'tenant',text:f.voiceInput.text,logicalVoice:'v1',language:'en',provider:'qwen_tts',audioSha256:'c'.repeat(64),durationSeconds:2};await f.context.persistAudioCacheProof!(proof);assert.equal(await f.context.verifyCachedAudio!(proof),true);assert.equal(await f.context.verifyCachedAudio!({...proof,audioSha256:'d'.repeat(64)}),false);assert.equal(await f.context.verifyCachedAudio!({...proof,tenantId:'other'}),false);}finally{f.cleanup();}});
test('rewritten narrator text and same-voice-unproven fallback cannot consume original intent or invoke provider',async()=>{const f=fixture();let sends=0;try{await assert.rejects(withStudioVoicePaidContext(f.context,()=>submitStudioVoicePaidRequest({...f.request,request:{model:f.primary.model,input:{text:'New compressed narration.'}}},async()=>{sends++;})),/requires_budget_replan/);await assert.rejects(withStudioVoicePaidContext(f.context,()=>submitStudioVoicePaidRequest({...f.request,provider:'minimax'},async()=>{sends++;})),/fallback_route_not_frozen/);assert.equal(f.claims.length,0);assert.equal(sends,0);}finally{f.cleanup();}});

test('native provider receipt is immutable and conflicting second result cannot overwrite original', async () => {
 const f=fixture();try {
  const call=await f.context.forRequest(f.request);
  const original={requestSha256:'e'.repeat(64),response:{request_id:'original'}};
  await call.persistProviderReceipt(original);
  await call.persistProviderReceipt(original);
  await assert.rejects(call.persistProviderReceipt({...original,response:{request_id:'different'}}), /original_receipt_conflict/);
 } finally {f.cleanup();}
});
test('changed-run cache reuse retains original same-task receipt and rejects cross-task proof', async () => {
 const f=fixture();try {
  await withStudioVoicePaidContext(f.context,()=>submitStudioVoicePaidRequest(f.request,async()=>({request_id:'original'})));
  const proof={tenantId:'tenant',text:f.voiceInput.text,logicalVoice:'v1',language:'en',provider:'qwen_tts',audioSha256:'c'.repeat(64),durationSeconds:2};
  await f.context.persistAudioCacheProof!(proof);
  const create=(taskId:string)=>createNativeStudioVoicePaidContext({scope:{...f.scope,taskId,runId:'new-run'},requirements:[f.requirement],routeBindings:{[f.requirement.key]:f.route},intents:[f.intent],voiceInput:f.voiceInput,root:f.root,assertCurrent:async()=>{},permit:{beforeSubmit:async()=>{throw Error('cache must not submit');},markOutcome:async()=>{},assertRecovery:async()=>{throw Error('unused');}}});
  assert.equal(await create('task').verifyCachedAudio!(proof),true);
  assert.equal(await create('another-task').verifyCachedAudio!(proof),false);
  assert.equal(f.claims.length,1);
 } finally {f.cleanup();}
});
