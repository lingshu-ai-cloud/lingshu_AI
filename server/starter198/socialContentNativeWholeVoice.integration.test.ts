import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { createWholeTrackPresenterAudioPort } from './socialContentWholeTrackPresenterAudio.js';
import { prepareSocialContentWholeVoice, readPreparedWholeVoiceScene } from './socialContentPreparedWholeVoice.js';
import { synthesizeNativeHeyGenVoice } from '../lib/studioNativeHeyGenVoice.js';
import { createNativeStudioVoicePaidContext, nativeStudioVoiceReceiptPath } from '../lib/studioNativeVoicePaidContext.js';
import { withStudioVoicePaidContext } from '../lib/studioVoicePaidOperation.js';
import { resolveStudioVoiceExecutionPlan } from '../routes/studio.js';
import { resolveActiveVoiceIntent } from '../lib/socialContentVoiceRouteRevision.js';
import { productionBillingAccountRef } from './socialContentProductionBudgetRoutes.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';
import { wavDurationFromBytes } from '../lib/wavDuration.js';

test('revised native paid TTS prepares one exact-identity whole track from supplier SRT and recovers without POST or ASR',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-whole-integration-'));
 const oldKey=process.env.HEYGEN_API_KEY;process.env.HEYGEN_API_KEY='offline-native-integration-fixture';
 try {
  const fixture=path.join(root,'fixture.mp4');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1',
   '-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',fixture]);
  const video=fs.readFileSync(fixture),script='Hello world. Choose your product.';
  const srt='1\n00:00:00,000 --> 00:00:00,200\nHello\n\n2\n00:00:00,200 --> 00:00:00,400\nworld. Choose\n\n3\n00:00:00,400 --> 00:00:00,600\nyour\n\n4\n00:00:00,600 --> 00:00:00,950\nproduct.\n';
  const voiceInput={tenantId:'tenant',text:script,voice:'heygen:original:identity-hash:orca',language:'en',style:{speed:0.95}};
  const plan=resolveStudioVoiceExecutionPlan({...voiceInput,heygenSpeechMode:'native_video'}),primary=plan.primary!;
  assert.equal(primary.model,'avatar_iv');assert.equal(primary.endpoint,'https://api.heygen.com/v3/videos');assert.equal(primary.voiceId,'original');
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
  const requirement={key:'voice:0:tts',stage:'tts',shotId:null,sourceRef:null,durationSeconds:null,text:script,frameCount:null,inputContractHash:'b'.repeat(64)};
  const route={provider:'heygen',model:'avatar_iv',accountRef:productionBillingAccountRef('heygen',primary.endpoint,primary.accountKeyHash),
   routeEvidenceRef:'explicit-native-mother-clip-fixture',usageBoundRef:'frozen-provider-seconds-fixture',maximumUnits:{providerSeconds:76},maximumAttempts:1};
  const originalOperationId='paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0});
  const revision={schema:'social-content-voice-route-revision.v1',key:requirement.key,revisionHash:'c'.repeat(64),supersedesOperationId:originalOperationId};
  const operationId='paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0,routeRevision:revision});
  const intent={operationId,provider:'heygen',model:'avatar_iv',accountRef:route.accountRef,stage:'tts',shotId:null,
   inputContractHash:paidProductionHash({requirement,route,attempt:0,routeRevision:revision}),maximumUnits:route.maximumUnits,routeRevision:revision};
  let posts=0,syntheses=0,asr=0;const claims:any[]=[],outcomes=new Map<string,any>();
  const permit:any={beforeSubmit:async(claim:any)=>{assert.equal(claim.operationId,operationId);assert.equal(claim.model,'avatar_iv');assert.deepEqual(claim.actualUnits,{providerSeconds:76});claims.push(claim);},
   markOutcome:async(id:string,status:string,receiptRef:string)=>outcomes.set(id,{status,receiptRef}),
   assertRecovery:async(id:string)=>{assert.equal(id,operationId);assert.ok(outcomes.has(id));return outcomes.get(id);}};
  const presenterBinding={provider:'heygen' as const,engine:'orca' as const,voiceId:'original',logicalVoice:voiceInput.voice,fingerprint:'identity-hash',
   presenters:[{id:'selected',assetVersion:1,avatarId:'Brody',voiceId:'original'}]};
  const funding:any={scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[intent],permit,voiceInput,presenterBinding,
   root:path.join(root,'canonical'),assertCurrent:async()=>{}};
  assert.equal(resolveActiveVoiceIntent(funding,requirement.key).operationId,operationId);assert.notEqual(operationId,originalOperationId);
  const context=createNativeStudioVoicePaidContext(funding);
  assert.equal(context.primaryModel,'avatar_iv');assert.equal(context.nativeSpeech!.avatarId,'Brody');assert.equal(context.nativeSpeech!.maximumDurationSeconds,76);
  const transport=(async(url:any,init:any)=>{
   if(init?.method==='POST'){posts++;const body=JSON.parse(init.body);assert.equal(String(url),primary.endpoint);assert.equal(body.avatar_id,'Brody');assert.equal(body.voice_id,'original');assert.equal(body.script,script);assert.equal(body.engine.type,'avatar_iv');return Response.json({data:{video_id:'native-original-task'}});}
   if(String(url).endsWith('/v3/videos/native-original-task'))return Response.json({data:{status:'completed',video_url:'https://files.heygen.ai/native.mp4',subtitle_url:'https://files.heygen.ai/native.srt',duration:1}});
   if(String(url).endsWith('.srt'))return new Response(srt);
   if(String(url).endsWith('.mp4'))return new Response(video);
   throw Error('unexpected_real_network_attempt');
  }) as typeof fetch;
  const options:any={funding,targetDuration:2,scenes:[{shotId:'s1',spokenText:'Hello world.',durationSeconds:1,startSeconds:0,endSeconds:1},{shotId:'s2',spokenText:'Choose your product.',durationSeconds:1,startSeconds:1,endSeconds:2}],
   root:path.join(root,'whole'),alignmentRoot:path.join(root,'align'),
   synthesize:async(input:any)=>{
    syntheses++;const raw=path.join(root,'raw.wav'),processed=path.join(root,'processed.wav');
    const result=await withStudioVoicePaidContext(input.paidContext,()=>synthesizeNativeHeyGenVoice({text:input.text,voiceId:'original',output:raw},{root:path.join(root,'supplier'),fetch:transport}));
    // Match the established automation's speed, acoustic filters and tail pad. A real
    // media transformation; no measured timestamps are manufactured here.
    execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-y','-i',raw,'-af','atempo=0.95,highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=7,alimiter=limit=0.95,apad=pad_dur=0.15','-ar','24000','-ac','1','-c:a','pcm_s16le',processed]);
    return {ok:true,source:'heygen',text:script,localPath:processed,url:'https://owned.fixture/processed.wav',duration:wavDurationFromBytes(fs.readFileSync(processed)),cues:[]};
   },
   align:async()=>{asr++;throw Error('native_subtitles_must_not_invoke_asr');}};
  const prepared=await prepareSocialContentWholeVoice(options);
  assert.equal(posts,1);assert.equal(syntheses,1);assert.equal(asr,0);assert.equal(claims.length,1);
  assert.equal(prepared.voice.alignmentSource,'heygen_native_subtitles');
  assert.equal(prepared.nativeVoice.model,'avatar_iv');assert.equal(prepared.nativeVoice.physicalVoiceId,'original');
  assert.equal(prepared.sourceReceiptRefs[0],nativeStudioVoiceReceiptPath(scope,operationId,funding.root));
  const source=JSON.parse(fs.readFileSync(prepared.sourceReceiptRefs[0]!,'utf8'));
  assert.equal(source.operationId,operationId);assert.equal(source.response.nativeSpeechTrack.providerTaskId,'native-original-task');
  assert.equal(source.response.nativeSpeechTrack.input.avatarId,'Brody');assert.equal(source.response.nativeSpeechTrack.input.voiceId,'original');
  const alignment=JSON.parse(fs.readFileSync(prepared.alignmentReceiptRef,'utf8'));
  assert.equal(alignment.precision,'phrase');assert.equal(alignment.independentAsr,false);assert.equal(alignment.source,'heygen_native_subtitles');
  assert.equal(prepared.voice.cues.map(row=>row.text).join(' '),script);assert.equal(prepared.voice.cues.length,4);
  // Historical manifests called every measured alignment audio_ai. The real
  // immutable provider proof, not that cached label, determines the projection.
  const legacyState=JSON.parse(fs.readFileSync(prepared.receiptRef,'utf8'));
  legacyState.voice.alignmentSource='audio_ai';fs.writeFileSync(prepared.receiptRef,JSON.stringify(legacyState));
  const legacyPrepared={...prepared,voice:{...prepared.voice,alignmentSource:'audio_ai'}};
  const legacyClip=await readPreparedWholeVoiceScene({prepared:legacyPrepared,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  assert.equal(legacyClip.alignmentReceiptRef,prepared.alignmentReceiptRef);
  const restored=await prepareSocialContentWholeVoice(options);
  assert.equal(restored.voice.alignmentSource,'heygen_native_subtitles');assert.equal(restored.wholeTrackSha256,prepared.wholeTrackSha256);
  assert.equal(posts,1);assert.equal(syntheses,1);assert.equal(asr,0);
  const clip = await readPreparedWholeVoiceScene({prepared,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  assert.ok(Math.abs(clip.durationSeconds-1)<.001);assert.equal(clip.nativeVoice.physicalVoiceId,'original');
  const recoveredClip = await readPreparedWholeVoiceScene({prepared,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  assert.equal(recoveredClip.clipSha256,clip.clipSha256);
  let uploads=0;
  const audioPort=createWholeTrackPresenterAudioPort({scope,taskVersion:'1',filePath:prepared.voice.localPath,
   wholeTrackSha256:prepared.wholeTrackSha256,durationSeconds:prepared.voice.duration,scenes:options.scenes,cues:prepared.voice.cues,
   nativeVoice:prepared.nativeVoice,sourceReceiptRef:prepared.sourceReceiptRefs[0]!,alignmentReceiptRef:prepared.alignmentReceiptRef,
   assertCurrent:async()=>{},root:path.join(root,'presenter-audio'),client:{uploadAudio:async bytes=>{assert.ok(bytes.length>44);uploads++;return 'fixture-scene-audio';}}});
  const request:any={tenantId:'tenant',taskId:'task',shotId:'s1',script:'Hello world.',presenter:{presenterAssetId:'selected',assetVersion:1,providerPresenterId:'Brody'}};
  const sceneAudio=await audioPort.resolve(request);
  assert.ok(Math.abs(sceneAudio.durationSeconds-1)<.001);assert.equal(sceneAudio.voiceId,'original');assert.equal(sceneAudio.providerAvatarId,'Brody');
  assert.equal(sceneAudio.sourceReceiptRef,prepared.sourceReceiptRefs[0]);
  assert.deepEqual(await audioPort.resolve(request),sceneAudio);assert.equal(uploads,1);assert.equal(posts,1);assert.equal(asr,0);

  const subtitlePath=source.response.subtitlePath;
  fs.appendFileSync(subtitlePath,'tampered');await assert.rejects(prepareSocialContentWholeVoice(options),/native_subtitle_evidence_changed/);
  fs.writeFileSync(subtitlePath,srt);
  const canonical=fs.readFileSync(prepared.sourceReceiptRefs[0]!);
  source.response.subtitleSha256='0'.repeat(64);fs.writeFileSync(prepared.sourceReceiptRefs[0]!,JSON.stringify(source));
  await assert.rejects(prepareSocialContentWholeVoice(options),/native_subtitle_evidence_changed/);
  fs.writeFileSync(prepared.sourceReceiptRefs[0]!,canonical);
  assert.equal(posts,1);assert.equal(asr,0);
 } finally {if(oldKey===undefined)delete process.env.HEYGEN_API_KEY;else process.env.HEYGEN_API_KEY=oldKey;fs.rmSync(root,{recursive:true,force:true});}
});
