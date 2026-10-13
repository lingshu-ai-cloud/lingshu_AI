import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundPresenterVoice, assertBoundPresenterAudio } from './socialContentBoundPresenterVoice';
import { resolveStudioVoiceExecutionPlan } from '../routes/studio';

test('selected presenter binds the physical voice and version into cache and budget identity', async () => {
 const person = { id:'sales', authorized:true, avatarId:'look', voiceId:'bound-voice', assetVersion:4, toolMappings:{heygen:{avatarId:'look',voiceId:'bound-voice'}} };
 const store:any = { list:async()=>({items:[{tenant_id:'tenant',payload:{presenters:[person]}}]}) };
 const binding = await readBoundPresenterVoice(store,'tenant',['sales']);
 assert.ok(binding);
 const plan = resolveStudioVoiceExecutionPlan({tenantId:'tenant',text:'Hello. Welcome.',voice:binding.logicalVoice,language:'en',env:{HEYGEN_API_KEY:'test-only',DASHSCOPE_API_KEY:'test-only',MINIMAX_API_KEY:'test-only'}});
 assert.equal(plan.primary?.provider,'heygen'); assert.equal(plan.primary?.voiceId,'bound-voice'); assert.equal(plan.fallback,null);
 assert.throws(()=>resolveStudioVoiceExecutionPlan({tenantId:'tenant',text:'Hello.',voice:binding.logicalVoice,nativeProvider:'qwen',env:{HEYGEN_API_KEY:'test-only'}}),/provider_mismatch/);
 const old = binding.fingerprint; person.assetVersion++;
 assert.notEqual((await readBoundPresenterVoice(store,'tenant',['sales']))?.fingerprint,old);
 assert.throws(()=>assertBoundPresenterAudio('bound-voice',{provider:'qwen',physicalVoiceId:'Cherry'}),/voice_mismatch/);
 assert.throws(()=>assertBoundPresenterAudio('bound-voice',{provider:'heygen',physicalVoiceId:'another-voice'}),/voice_mismatch/);
 assertBoundPresenterAudio('bound-voice',{provider:'heygen',physicalVoiceId:'bound-voice'});
 person.toolMappings.heygen.voiceId='different';
 await assert.rejects(readBoundPresenterVoice(store,'tenant',['sales']),/missing_or_conflicting/);
 await assert.rejects(readBoundPresenterVoice(store,'another-tenant',['sales']),/registry_missing/);
});
