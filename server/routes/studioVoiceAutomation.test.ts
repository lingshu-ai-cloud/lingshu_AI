import assert from 'node:assert/strict';
import test from 'node:test';
import {VOICE_DRIVEN_SLOTS_AUDIO_POLICY} from '../lib/studioVoiceAutomationPolicy.js';
import { createStudioVoiceAutomation } from './studioVoiceAutomation.js';
import type { createStudioTtsProviderRuntime } from './studioTtsProviderRuntime.js';
import type { createStudioTtsGeneration } from './studioTtsGeneration.js';

test('automation voice plan freezes physical provider before any synthesis', async () => {
  let providerCalls = 0;
  const automation = createStudioVoiceAutomation({
    runTenant: (_tenantId, run) => run(),
    tenantTtsDir: () => { throw new Error('tenant files must not be touched'); },
    ttsUrl: file => `/tts/${file}`,
    persistPrivateTtsAsset: async () => { throw new Error('storage must not be touched'); },
    execFileAsync: async () => { throw new Error('ffmpeg must not run'); },
    ffmpegBin: 'unused',
    providers: {
      minimaxEndpoint: () => 'https://api.minimax.io/v1/t2a_v2',
      qwenTtsLanguageType: () => 'English',
      voiceSamplePathFromId: () => null,
      minimaxVoiceCacheKey: () => '',
      readMinimaxVoiceCache: () => ({}),
    } as unknown as ReturnType<typeof createStudioTtsProviderRuntime>,
    generation: {
      readStudioNativeTtsCache: () => null,
      generateTtsAudio: async () => { providerCalls++; throw new Error('provider must not run'); },
      proportionalCues: () => [],
    } as unknown as ReturnType<typeof createStudioTtsGeneration>,
  });
  const plan = automation.resolveStudioVoiceExecutionPlan({
    tenantId: 'tenant-a', text: 'Exact English speech.', voice: 'v1', language: 'en', nativeProvider: 'qwen',
    env: { DASHSCOPE_API_KEY: 'offline-test-key', QWEN_TTS_MODEL: 'qwen3-tts-flash' },
  });
  assert.equal(plan.primary?.provider, 'qwen');
  assert.deepEqual(plan.primary?.texts, ['Exact English speech.']);
  assert.equal(plan.fallback, null);
  assert.equal(providerCalls, 0);
  assert.equal((await automation.synthesizeStudioVoiceForAutomation({ tenantId: 'tenant-a', text: '' })).ok, false);
  assert.equal(providerCalls, 0);
});

test('voice-driven worker capability preserves actual readable audio without acoustic or ASR quality gates',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {execFile:exec}=await import('node:child_process'),{promisify}=await import('node:util');
 const {default:ffmpeg}=await import('ffmpeg-static');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-policy-'));
 const oldQa=process.env.TTS_ASR_QA_ENABLED;process.env.TTS_ASR_QA_ENABLED='false';
 try{
  const run=promisify(exec),source=path.join(root,'silent.wav');
  await run(ffmpeg!,['-y','-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t','1','-c:a','pcm_s16le',source]);
  const automation=createStudioVoiceAutomation({runTenant:(_tenant,fn)=>fn(),tenantTtsDir:()=>root,ttsUrl:file=>'/tts/'+file,persistPrivateTtsAsset:async()=>'/owned/voice.wav',ffmpegBin:ffmpeg!,execFileAsync:async(bin,args)=>{await run(bin,args);return '';},providers:{} as never,generation:{generateTtsAudio:async()=>({ok:true,url:'/tts/silent.wav',source:'qwen_tts'}),readStudioNativeTtsCache:()=>null} as never});
  const input={tenantId:'fixture',text:'Hello world. Buy now.',language:'en',style:{speed:1}};
  const legacy=await automation.synthesizeStudioVoiceForAutomation(input);
  assert.equal(legacy.ok,false);assert.ok(legacy.qualityReport?.failures.length);
  const result=await automation.synthesizeStudioVoiceForAutomation({...input,targetDuration:.2,audioPolicy:VOICE_DRIVEN_SLOTS_AUDIO_POLICY});
  assert.equal(result.ok,true);assert.ok(result.duration!>1);assert.ok(fs.existsSync(result.localPath!));
  assert.equal(result.qualityReport,undefined,'no synthetic passed score and no optional ASR request');
  const single=await automation.synthesizeStudioVoiceForAutomation({...input,text:'Hello world.',audioPolicy:VOICE_DRIVEN_SLOTS_AUDIO_POLICY});assert.equal(single.ok,true);assert.ok(single.duration!>0);
  const untrusted=await automation.synthesizeStudioVoiceForAutomation({...input,audioPolicy:'voice-driven-slots-audio.v1' as never});
  assert.equal(untrusted.ok,false,'HTTP/JSON strings cannot enable the policy');
  const empty=await automation.synthesizeStudioVoiceForAutomation({...input,text:'',audioPolicy:VOICE_DRIVEN_SLOTS_AUDIO_POLICY});assert.equal(empty.ok,false);
 }finally{if(oldQa===undefined)delete process.env.TTS_ASR_QA_ENABLED;else process.env.TTS_ASR_QA_ENABLED=oldQa;fs.rmSync(root,{recursive:true,force:true});}
});
