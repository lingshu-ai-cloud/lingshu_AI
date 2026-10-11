import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {prepareSocialContentWholeVoice,readPreparedWholeVoiceScene} from './socialContentPreparedWholeVoice.js';
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
  const clip=await readPreparedWholeVoiceScene({prepared,scope,shotId:'s1',spokenText:'Hello world.',assertCurrent:async()=>{}});
  assert.ok(Math.abs(clip.durationSeconds-1.5)<.001);const decoded=execFileSync(ffmpeg||'ffmpeg',['-v','error','-i',clip.filePath,'-f','s16le','-ac','1','-ar','24000','pipe:1']);
  assert.equal(decoded.subarray(0,24000*2).every(byte=>byte===0),true,'one-second leading silence must stay aligned with global track');
  assert.equal(clip.sourceReceipts.length,1);assert.equal(clip.nativeVoice.physicalVoiceId,p.voiceId);
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
