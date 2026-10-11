import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {resolveStudioVoiceExecutionPlan,synthesizeStudioVoiceForAutomation} from '../routes/studio.js';
import {transcribeAudioWithQwen} from '../agents/qwen.js';
import {withStudioVoicePaidContext,type StudioVoicePaidContext} from './studioVoicePaidOperation.js';
function configure(){const keys=['MINIMAX_API_KEY','MINIMAX_API_TOKEN','DASHSCOPE_API_KEY','QWEN_TTS_VOICE_V1','TTS_PREFER_EXPRESSIVE_PROVIDER','TTS_ASR_QA_ENABLED'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{MINIMAX_API_KEY:'',MINIMAX_API_TOKEN:'',DASHSCOPE_API_KEY:'controlled-fixture-only',QWEN_TTS_VOICE_V1:'LockedVoice',TTS_PREFER_EXPRESSIVE_PROVIDER:'false',TTS_ASR_QA_ENABLED:'true'});return()=>{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}};}
test('same runtime resolver and real native TTS POST preparation use actual physical voice/text/model, permit gap blocks all network',async()=>{
 const restore=configure(),tenantId='voice-paid-test-'+process.pid,root=path.resolve('data/tts',tenantId);const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('external network forbidden');};
 try{const text='First sentence. Second sentence.';const plan=resolveStudioVoiceExecutionPlan({tenantId,text,voice:'v1',language:'en'});assert.equal(plan.mode,'continuous');assert.equal(plan.primary?.provider,'qwen');assert.equal(plan.primary?.voiceId,'LockedVoice');assert.deepEqual(plan.primary?.texts,[text]);assert.equal(plan.fallback,null);
 const context:StudioVoicePaidContext={primaryProvider:'qwen',forRequest:async actual=>{assert.equal(actual.voiceId,'LockedVoice');assert.equal((actual.request.input as any).text,text);assert.equal(actual.model,plan.primary!.model);assert.equal(actual.accountKeyHash,plan.primary!.accountKeyHash);throw Error('frozen_paid_intent_missing');}};
 await assert.rejects(synthesizeStudioVoiceForAutomation({tenantId,text,voice:'v1',language:'en',paidContext:context}),/frozen_paid_intent_missing/);assert.equal(network,0);
 const sentences=resolveStudioVoiceExecutionPlan({tenantId,text,voice:'v1',language:'en',measuredSentenceTiming:true});assert.equal(sentences.mode,'sentences');assert.equal(sentences.primary?.texts.length,2);
 }finally{globalThis.fetch=originalFetch;restore();fs.rmSync(root,{recursive:true,force:true});}
});
test('real Qwen ASR request boundary carries actual audio SHA/probed seconds before SDK call',async()=>{const restore=configure();const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('external network forbidden');};try{const context:StudioVoicePaidContext={primaryProvider:'qwen',forRequest:async request=>{assert.equal(request.stage,'voice_asr');assert.equal(request.audioSeconds,1.25);assert.match(request.audioSha256!,/^[a-f0-9]{64}$/);assert.ok(Array.isArray(request.request.messages));throw Error('canonical_asr_intent_missing');}};await assert.rejects(withStudioVoicePaidContext(context,()=>transcribeAudioWithQwen({audio:Buffer.from('RIFFcontrolled'),audioSeconds:1.25,fileName:'controlled.wav'})),/canonical_asr_intent_missing/);assert.equal(network,0);}finally{globalThis.fetch=originalFetch;restore();}});
test('trusted frozen native Qwen choice overrides global expressive preference only inside paid context',async()=>{
 const restore=configure(),tenantId='voice-choice-test-'+process.pid,root=path.resolve('data/tts',tenantId),originalFetch=globalThis.fetch;let sends=0;
 process.env.MINIMAX_API_KEY='controlled-minimax-only';process.env.TTS_PREFER_EXPRESSIVE_PROVIDER='true';globalThis.fetch=async()=>{sends++;throw Error('network forbidden');};
 try {
  const text='A new native voice plan.';
  assert.equal(resolveStudioVoiceExecutionPlan({tenantId,text,language:'en'}).primary?.provider,'minimax');
  const selected=resolveStudioVoiceExecutionPlan({tenantId,text,language:'en',nativeProvider:'qwen'});assert.equal(selected.primary?.provider,'qwen');
  const paidContext:StudioVoicePaidContext={primaryProvider:'qwen',forRequest:async request=>{assert.equal(request.provider,'qwen');assert.equal(request.voiceId,selected.primary!.voiceId);throw Error('controlled_frozen_boundary');}};
  await assert.rejects(synthesizeStudioVoiceForAutomation({tenantId,text,language:'en',paidContext}),/controlled_frozen_boundary/);assert.equal(sends,0);
 }finally {globalThis.fetch=originalFetch;restore();fs.rmSync(root,{recursive:true,force:true});}
});
