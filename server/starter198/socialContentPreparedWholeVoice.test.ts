import { freezePresenterMotherSegments } from '../../shared/contracts/presenterMotherSegments.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {prepareSocialContentWholeVoice,readPreparedWholeVoiceScene,verifiedHeyGenNativeTiming} from './socialContentPreparedWholeVoice.js';
import {resolveStudioVoiceExecutionPlan} from '../routes/studio.js';
import {withStudioVoicePaidContext,submitStudioVoicePaidRequest} from '../lib/studioVoicePaidOperation.js';
import {alignQwenFile} from '../integrations/qwenAlignment.js';
import {productionBillingAccountRef} from './socialContentProductionBudgetRoutes.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';

test('one guarded full track and real alignment feed measured scene clips and resume without TTS or ASR POST',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-native-track-'));
 const originalFetch=global.fetch,keys=['DASHSCOPE_API_KEY','MINIMAX_API_KEY','MINIMAX_API_TOKEN','TTS_PREFER_EXPRESSIVE_PROVIDER'];
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{DASHSCOPE_API_KEY:'controlled-only',MINIMAX_API_KEY:'',MINIMAX_API_TOKEN:'',TTS_PREFER_EXPRESSIVE_PROVIDER:'false'});
 try {
  const voiceInput={tenantId:'tenant',text:'Hello world. Choose your product.',voice:'v1',language:'en'};
  const plan=resolveStudioVoiceExecutionPlan(voiceInput),p=plan.primary!;
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
  const endpoint='https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
  const requirements:any[]=[{key:'voice:0:tts',stage:'tts',text:voiceInput.text},{key:'voice:alignment',stage:'voice_alignment',text:voiceInput.text}].map(row=>({...row,shotId:null,sourceRef:null,durationSeconds:null,frameCount:null,inputContractHash:'b'.repeat(64)}));
  const routes:any={'voice:0:tts':{provider:p.provider,model:p.model,accountRef:productionBillingAccountRef(p.provider,p.endpoint,p.accountKeyHash),routeEvidenceRef:'real-resolver',usageBoundRef:'actual-characters',maximumUnits:{characters:100},maximumAttempts:1},'voice:alignment':{provider:'qwen',model:'qwen3-asr-flash-filetrans',accountRef:productionBillingAccountRef('qwen',endpoint,p.accountKeyHash),routeEvidenceRef:'same-live-key',usageBoundRef:'full-file-seconds',maximumUnits:{audioSeconds:300},maximumAttempts:1}};
  const intents=requirements.map(r=>({operationId:'paid-plan:'+paidProductionHash({scope,key:r.key,attempt:0}),provider:routes[r.key].provider,model:routes[r.key].model,accountRef:routes[r.key].accountRef,stage:r.stage,shotId:null,inputContractHash:paidProductionHash({requirement:r,route:routes[r.key],attempt:0}),maximumUnits:routes[r.key].maximumUnits}));
  const claims:any[]=[],receipts=new Map<string,any>();
  const permit:any={beforeSubmit:async(r:any)=>{assert.equal(receipts.has(r.operationId),false);claims.push(r);return {operationId:r.operationId};},markOutcome:async(id:string,status:string,receiptRef:string)=>receipts.set(id,{status,receiptRef}),assertRecovery:async(id:string)=>{const row=receipts.get(id);assert.ok(row);return row;}};
  const track=path.join(root,'input.wav');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-af','adelay=1000','-t','3','-ac','1','-c:a','pcm_s16le',track],{stdio:'ignore'});
  let tts=0,alignmentPosts=0;
  const raw={transcripts:[{text:voiceInput.text,sentences:[{begin_time:1000,end_time:1400,text:'Hello world.'},{begin_time:1600,end_time:2200,text:'Choose your product.'}]}]};
  global.fetch=async(url:any,init:any)=>{
   const u=String(url);if(init?.method==='POST'){alignmentPosts++;return new Response(JSON.stringify({output:{task_id:'controlled-original-alignment'}}));}
   if(u.endsWith('/tasks/controlled-original-alignment'))return new Response(JSON.stringify({output:{task_status:'SUCCEEDED',result:{transcription_url:'https://controlled.oss-cn-beijing.aliyuncs.com/result.json'}}}));
   if(u==='https://controlled.oss-cn-beijing.aliyuncs.com/result.json')return new Response(JSON.stringify(raw));
   throw Error('unexpected network '+u);
  };
  const alignmentRoot=path.join(root,'alignment');
  const options:any={funding:{scope,requirements,routeBindings:routes,intents,permit,voiceInput,root:path.join(root,'receipts'),assertCurrent:async()=>{}},targetDuration:3,scenes:[{shotId:'s1',spokenText:'Hello world.',durationSeconds:1.5,startSeconds:0,endSeconds:1.5},{shotId:'s2',spokenText:'Choose your product.',durationSeconds:1.5,startSeconds:1.5,endSeconds:3}],root:path.join(root,'prepared'),alignmentRoot,
   synthesize:async(input:any)=>{if(!tts){tts++;await withStudioVoicePaidContext(input.paidContext,()=>submitStudioVoicePaidRequest({stage:'tts',provider:p.provider,model:p.model,voiceId:p.voiceId,endpoint:p.endpoint,accountKeyHash:p.accountKeyHash,request:{model:p.model,input:{text:p.texts[0]}}},async()=>({request_id:'controlled-tts'})));}return {ok:true,localPath:track,url:'https://owned.example/track.wav',duration:3,text:voiceInput.text,cues:[],source:'qwen_tts'};},
   align:async(input:any)=>({source:'audio_ai' as const,cues:await withStudioVoicePaidContext(input.paidContext,()=>alignQwenFile(input.url,input.text,input.duration,path.join(root,'ignored-workspace.json'),{audioSha256:createHash('sha256').update(fs.readFileSync(input.preparedTrack.filePath)).digest('hex'),durableRoot:alignmentRoot}))})};
  const prepared=await prepareSocialContentWholeVoice(options);
  assert.equal(tts,1);assert.equal(alignmentPosts,1);assert.equal(claims.length,2);assert.equal(claims[1].actualUnits.audioSeconds,3);
  const mappedOptions={...options,voiceDriven:true,sentenceScenes:options.scenes.map((scene:any,index:number)=>({shotId:scene.shotId,spokenText:scene.spokenText,lines:[{lineId:`line-${index+1}`,text:scene.spokenText,sourceStartSeconds:scene.startSeconds,sourceEndSeconds:scene.endSeconds,narrationOwnerShotId:scene.shotId,visualShotIds:[scene.shotId],isNarrationOwner:true}]}))};
  const mapped=await prepareSocialContentWholeVoice(mappedOptions);
  assert.deepEqual(mapped.measuredSentenceSlots?.map(row=>[row.lineId,row.startSeconds,row.endSeconds]),[['line-1',1,1.4],['line-2',1.6,2.2]]);
  const recovered=await prepareSocialContentWholeVoice({...mappedOptions,synthesize:async()=>assert.fail('duplicate TTS'),align:async()=>assert.fail('duplicate alignment')});
  assert.deepEqual(recovered.measuredSentenceSlots,mapped.measuredSentenceSlots);assert.equal(tts,1);assert.equal(alignmentPosts,1);
  await assert.rejects(prepareSocialContentWholeVoice({...mappedOptions,sentenceScenes:mappedOptions.sentenceScenes.map((scene:any)=>({...scene,lines:scene.lines.map((line:any)=>({...line,lineId:line.lineId+'-changed'}))}))}),/sentence_slot_contract_changed/);

  const clip=await readPreparedWholeVoiceScene({prepared,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  assert.ok(Math.abs(clip.durationSeconds-1.5)<.001);const decoded=execFileSync(ffmpeg||'ffmpeg',['-v','error','-i',clip.filePath,'-f','s16le','-ac','1','-ar','24000','pipe:1']);
  assert.equal(decoded.subarray(0,24000*2).every(byte=>byte===0),true,'one-second leading silence must stay aligned with global track');
  assert.equal(clip.sourceReceipts.length,1);assert.equal(clip.nativeVoice.physicalVoiceId,p.voiceId);
  const crossCut={...options,scenes:[{...options.scenes[0],durationSeconds:1.2,endSeconds:1.2},{...options.scenes[1],durationSeconds:1.8,startSeconds:1.2}]};
  const continuous=await prepareSocialContentWholeVoice(crossCut);
  const first=await readPreparedWholeVoiceScene({prepared:continuous,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  const second=await readPreparedWholeVoiceScene({prepared:continuous,scope,shotId:'s2',spokenText:'Choose your product.',assertCurrent:async()=>{}});
  const decode=(file:string)=>execFileSync(ffmpeg||'ffmpeg',['-v','error','-i',file,'-f','s16le','-ac','1','-ar','24000','pipe:1']);
  assert.ok(Buffer.concat([decode(first.filePath),decode(second.filePath)]).equals(decode(continuous.voice.localPath)),'visual cut inside a sentence must preserve every original PCM sample');
  assert.equal(continuous.wholeTrackSha256,prepared.wholeTrackSha256);assert.equal(tts,1);assert.equal(alignmentPosts,1);
  const lateWindow=await prepareSocialContentWholeVoice({...options,targetDuration:5,scenes:[...options.scenes,{shotId:'silent-presenter',spokenText:'',durationSeconds:1,startSeconds:4,endSeconds:5}]});
  const silentClip=await readPreparedWholeVoiceScene({prepared:lateWindow,scope,shotId:'silent-presenter',spokenText:'',assertCurrent:async()=>{}});
  assert.equal(decode(silentClip.filePath).length,48000);assert.ok(decode(silentClip.filePath).every(x=>x===0));
  await assert.rejects(prepareSocialContentWholeVoice({...options,targetDuration:2.5}), (error:any)=>error.code==='director_whole_voice_duration_revision_required'&&error.actualDurationSeconds===3&&fs.existsSync(error.proofRef));
  const alignedProof=JSON.parse(fs.readFileSync(prepared.receiptRef,'utf8'));
  assert.equal(alignedProof.status,'audio_aligned');assert.ok(alignedProof.proof.sourceReceiptRefs.length);
  await assert.rejects(prepareSocialContentWholeVoice({...options,targetDuration:2.5,synthesize:async()=>assert.fail('duplicate TTS'),align:async()=>assert.fail('duplicate alignment')}), (error:any)=>error.code==='director_whole_voice_duration_revision_required');
  assert.equal(tts,1);assert.equal(alignmentPosts,1);
  // Orphan stable WAV from a crash before manifest fsync is reused only when
  // its bytes match the original accepted native-cache output.
  fs.rmSync(prepared.receiptRef);
  const orphanRecovered=await prepareSocialContentWholeVoice(options);
  assert.equal(orphanRecovered.wholeTrackSha256,prepared.wholeTrackSha256);assert.equal(tts,1);assert.equal(alignmentPosts,1);
  // Alignment was accepted, but its completion and source native file were
  // lost before the full-track manifest finished. Recover the original task
  // via the stable copied WAV; do not need the old URL-backed local file.
  const manifest=JSON.parse(fs.readFileSync(prepared.receiptRef,'utf8'));manifest.status='audio_prepared';fs.writeFileSync(prepared.receiptRef,JSON.stringify(manifest));
  const acceptedAlignment=JSON.parse(fs.readFileSync(prepared.alignmentReceiptRef,'utf8'));delete acceptedAlignment.result;acceptedAlignment.state='accepted';fs.writeFileSync(prepared.alignmentReceiptRef,JSON.stringify(acceptedAlignment));
  fs.rmSync(track);await prepareSocialContentWholeVoice({...options,synthesize:async()=>assert.fail('duplicate TTS')});
  assert.equal(alignmentPosts,1);
  const restored=await prepareSocialContentWholeVoice({...options,synthesize:async()=>assert.fail('duplicate TTS'),align:async()=>assert.fail('duplicate alignment POST')});
  assert.equal(restored.wholeTrackSha256,prepared.wholeTrackSha256);assert.equal(tts,1);assert.equal(alignmentPosts,1);
  await assert.rejects(readPreparedWholeVoiceScene({prepared,scope:{...scope,runId:'other'},shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}}),/scene_receipt_changed/);
  await assert.rejects(readPreparedWholeVoiceScene({prepared,scope,shotId:'s1',spokenText:'Different speech.',assertCurrent:async()=>{}}),/scene_not_frozen/);
 } finally {global.fetch=originalFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}fs.rmSync(root,{recursive:true,force:true});}
});

 test('HeyGen native words preserve measured pauses after speed conversion and reject changed copy or track',()=>{
 const response={duration:4,word_timestamps:[{word:'<start>',start:0,end:0},{word:'Hello',start:.5,end:1},{word:'world.',start:2,end:3.8},{word:'<end>',start:4,end:4}]};
 const timing=verifiedHeyGenNativeTiming(response,'Hello world.',2,5,2.15);
 assert.deepEqual(timing.cues,[{start:.25,end:.5,text:'Hello'},{start:1,end:1.9,text:'world.'}]);
 assert.throws(()=>verifiedHeyGenNativeTiming(response,'Different world.',2,5,2.15),/口播文本不一致/);
 assert.throws(()=>verifiedHeyGenNativeTiming(response,'Hello world.',2,5,3),/transform_changed/);
 });

test('37 visual cuts preserve the three frozen presenter groups with silent members and cross-cut phrase speech',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-37-group-contract-'));
 try{
  const scope={tenantId:'fixture',taskId:'task',runId:'run',planHash:'a'.repeat(64)},file=path.join(root,'whole.wav');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=4','-ac','1','-c:a','pcm_s16le',file]);
  const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const scenes=Array.from({length:37},(_,index)=>({shotId:'shot-'+(index+1),spokenText:index===0?'Hello  world.':index===29?'Build with care.':index===34?'Send a note.':'',durationSeconds:.1,startSeconds:index/10,endSeconds:(index+1)/10}));
  const groups=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'b'.repeat(64),slots:scenes.map((scene,index)=>({slotId:scene.shotId,referenceShotId:scene.shotId,startSeconds:scene.startSeconds,endSeconds:scene.endSeconds,spokenText:scene.spokenText,materialType:[0,1,29,34,35].includes(index)?'talking_head':'product',frontFacing:true,lipSyncRequired:true}))});
  assert.deepEqual(groups.groups.map(group=>group.memberSlotIds),[['shot-1','shot-2'],['shot-30'],['shot-35','shot-36']]);
  const cues=[{start:0,end:.3,text:'Hello'},{start:.3,end:.9,text:'world.'},{start:.9,end:2.5,text:'Build with care.'},{start:2.5,end:3.7,text:'Send a note.'}];
  const voice:any={ok:true,source:'heygen',localPath:file,url:'https://fixture/whole.wav',duration:4,cues};
  const source=path.join(root,'source.json'),alignment=path.join(root,'alignment.json'),receipt=path.join(root,'prepared.json'),nativeVoice={provider:'heygen' as const,model:'avatar_iv',physicalVoiceId:'original'};
  fs.writeFileSync(source,JSON.stringify({scope,provider:'heygen',model:'avatar_iv',voiceId:'original',operationId:'original-paid-fixture'}));
  fs.writeFileSync(alignment,JSON.stringify({state:'completed',scope:{audioSha256:hash},source:'heygen_native_subtitles',precision:'phrase',independentAsr:false,result:{transcripts:[{text:'Hello world. Build with care. Send a note.',sentences:cues.map(cue=>({text:cue.text,begin_time:cue.start*1000,end_time:cue.end*1000}))}]}}));
  const prepared:any={voice,inputHash:'fixture-input',receiptRef:receipt,wholeTrackSha256:hash,sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice};
  fs.writeFileSync(receipt,JSON.stringify({status:'completed',inputHash:prepared.inputHash,scope,voice,wholeTrackSha256:hash,scenes,proof:{sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice}}));
  const read=(group:any)=>readPreparedWholeVoiceScene({prepared,scope,shotId:group.segmentId,memberShotIds:group.memberSlotIds,spokenText:group.mergedSpokenText,assertCurrent:async()=>{}});
  for(const group of groups.groups){const clip=await read(group);assert.ok(Math.abs(clip.durationSeconds-group.durationSeconds)<.001);assert.equal(clip.spokenText,group.mergedSpokenText);assert.equal((await read(group)).clipSha256,clip.clipSha256);}
  await assert.rejects(read({...groups.groups[0],mergedSpokenText:'Hello other.'}),/scene_not_frozen:text_mismatch:presenter-mother-1/);
  await assert.rejects(read({...groups.groups[0],memberSlotIds:['shot-1','missing']}),/scene_not_frozen:member_missing/);
  await assert.rejects(read({...groups.groups[0],memberSlotIds:['shot-1','shot-3']}),/scene_not_frozen:window_noncontiguous/);
  await assert.rejects(read({...groups.groups[0],memberSlotIds:['shot-2','shot-1']}),/scene_not_frozen:window_noncontiguous/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('voice-driven receipt clips real audio with calibrated fixed-slot windows and rejects changed policy',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'measured-fixed-slot-'));
 try{
  const scope={tenantId:'fixture',taskId:'task',runId:'run',planHash:'a'.repeat(64)},file=path.join(root,'whole.wav');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=4','-ac','1','-c:a','pcm_s16le',file]);
  const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const scenes=[{shotId:'a',spokenText:'Hello.',durationSeconds:1,startSeconds:0,endSeconds:1},{shotId:'b',spokenText:'Buy.',durationSeconds:1,startSeconds:1,endSeconds:2}];
  const cues=[{start:0,end:3,text:'Hello.'},{start:3,end:4,text:'Buy.'}];
  const voice={ok:true,localPath:file,url:'https://owned.test/audio',duration:4,cues};
  const source=path.join(root,'source.json'),alignment=path.join(root,'alignment.json'),receipt=path.join(root,'prepared.json'),nativeVoice={provider:'heygen',model:'avatar_iv',physicalVoiceId:'original'};
  fs.writeFileSync(source,JSON.stringify({scope,...nativeVoice,voiceId:nativeVoice.physicalVoiceId}));
  fs.writeFileSync(alignment,JSON.stringify({state:'completed',scope:{audioSha256:hash},source:'heygen_native_subtitles',precision:'phrase',independentAsr:false,result:{transcripts:[{text:'Hello. Buy.',sentences:cues.map(cue=>({text:cue.text,begin_time:cue.start*1000,end_time:cue.end*1000}))}]}}));
  const {mapMeasuredSceneTimeline}=await import('./socialContentMeasuredSceneTimeline.js');
  const measuredSceneTimeline=mapMeasuredSceneTimeline({scenes,cues,durationSeconds:4});
  const proof={sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice};
  const {measureSentenceSlots}=await import('./socialContentSentenceSlotMapping.js');
  const sentenceLines=[{lineId:'line-1',text:'Hello.',sourceStartSeconds:0,sourceEndSeconds:1,narrationOwnerShotId:'a',visualShotIds:['a'],isNarrationOwner:true},{lineId:'line-2',text:'Buy.',sourceStartSeconds:1,sourceEndSeconds:2,narrationOwnerShotId:'b',visualShotIds:['b'],isNarrationOwner:true}];
  const measuredSentenceSlots=measureSentenceSlots(sentenceLines,cues);
  const prepared:any={voice,inputHash:'fixture-input',receiptRef:receipt,wholeTrackSha256:hash,...proof,timingPolicy:'voice-driven-slots.v1',measuredSceneTimeline,measuredSentenceSlots};
  fs.writeFileSync(receipt,JSON.stringify({status:'completed',inputHash:prepared.inputHash,scope,voice,wholeTrackSha256:hash,scenes,proof,voiceDriven:true,measuredTimeline:measuredSceneTimeline,sentenceLines,measuredSentenceSlots}));
  const clip=await readPreparedWholeVoiceScene({prepared,scope,shotId:'a',spokenText:'Hello.',assertCurrent:async()=>{}});
  assert.deepEqual(clip.range,{start:0,end:3});assert.equal(clip.durationSeconds,3);
  await assert.rejects(readPreparedWholeVoiceScene({prepared:{...prepared,measuredSentenceSlots:[]},scope,shotId:'a',spokenText:'Hello.',assertCurrent:async()=>{}}),/sentence_slot_measurement_changed/);
  await assert.rejects(readPreparedWholeVoiceScene({prepared:{...prepared,timingPolicy:undefined},scope,shotId:'a',spokenText:'Hello.',assertCurrent:async()=>{}}),/timing_policy_changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('v3 single-sentence whole track reaches existing synthesis with trusted policy; legacy keeps its fence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'single-whole-voice-')),old=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='controlled-only';
 try{
  const {VOICE_DRIVEN_SLOTS_AUDIO_POLICY}=await import('../lib/studioVoiceAutomationPolicy.js');
  const funding:any={scope:{tenantId:'fixture',taskId:'task',runId:'run',planHash:'a'.repeat(64)},voiceInput:{tenantId:'fixture',text:'Hello world.',language:'en',voice:'v1'},routeBindings:{'voice:0:tts':{provider:'qwen'}},requirements:[],intents:[],permit:{},assertCurrent:async()=>{}};
  let calls=0;const input={funding,targetDuration:2,scenes:[{shotId:'a',spokenText:'Hello world.',durationSeconds:2,startSeconds:0,endSeconds:2}],root,synthesize:async(request:any)=>{calls++;assert.equal(request.audioPolicy,VOICE_DRIVEN_SLOTS_AUDIO_POLICY);throw Error('controlled_synthesis_reached');}};
  await assert.rejects(prepareSocialContentWholeVoice(input),/continuous_native_voice_required/);assert.equal(calls,0);
  await assert.rejects(prepareSocialContentWholeVoice({...input,voiceDriven:true}),/controlled_synthesis_reached/);assert.equal(calls,1);
 }finally{if(old===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=old;fs.rmSync(root,{recursive:true,force:true});}
});
