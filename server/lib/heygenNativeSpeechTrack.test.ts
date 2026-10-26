import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { prepareHeyGenNativeSpeechTrack, type NativeSpeechTrackInput, type NativeSpeechTrackReceipt } from './heygenNativeSpeechTrack';
const input: NativeSpeechTrackInput = {scope:{tenantId:'tenant',taskId:'task',runId:'run'},avatarId:'Brody',voiceId:'original',script:'Hello, original voice.',ratio:'9:16',maximumDurationSeconds:2,operationId:'native-operation'};
async function fixture(root: string, audio=true) {
 const file=path.join(root,audio?'fixture.mp4':'silent.mp4');
 execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1',
  ...(audio?['-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','aac']:[]),'-c:v','libx264','-pix_fmt','yuv420p','-shortest',file]);
 return fs.readFile(file);
}
function ports(root: string, bytes: Buffer, options: {unknown?: boolean;failDownload?: boolean; wrongIdentity?: boolean; duration?: number}={}) {
 let state:NativeSpeechTrackReceipt|null=null,posts=0,downloads=0,permits=0;
 return {read:()=>state,posts:()=>posts,permits:()=>permits,config:{root,key:'fixture',
  receipts:{read:async()=>state&&structuredClone(state),write:async(_id:string,value:NativeSpeechTrackReceipt)=>{state=structuredClone(value);}},
  gate:{beforeSubmit:async(request:Record<string,unknown>,id:string)=>{permits++;assert.equal(id,input.operationId);assert.equal(request.avatar_id,'Brody');assert.equal(request.voice_id,'original');assert.equal(request.script,input.script);},
   onAccepted:async()=>{},assertRecovery:async()=>{}},
  fetch:(async(url:any,init:any)=>{
   if(init?.method==='POST'){posts++;if(options.unknown)throw Error('network outcome unknown');return Response.json({data:{video_id:'vendor-original'}});}
   if(String(url).endsWith('/v3/videos/vendor-original'))return Response.json({data:{status:'completed',video_url:'https://files.heygen.ai/native.mp4',duration:options.duration||1,...(options.wrongIdentity?{avatar_id:'different-person'}:{})}});
   downloads++;if(options.failDownload&&downloads===1)return new Response('',{status:503});return new Response(bytes);
  }) as typeof fetch,
 }};
}
test('full-script original avatar/voice mother clip yields verified media and recovers without a new generation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-'));
 try {
  const p=ports(root,await fixture(root),{failDownload:true});
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/download_failed/);
  assert.equal(p.read()?.providerTaskId,'vendor-original');
  const result=await prepareHeyGenNativeSpeechTrack(input,p.config);
  assert.equal(result.status,'completed');
  if(result.status!=='completed')throw Error('expected_complete');
  assert.equal(result.voiceId,'original');assert.equal(result.avatarId,'Brody');assert.equal(result.humanReviewRequired,true);
  assert.match(result.videoSha256,/^[a-f0-9]{64}$/);assert.match(result.audioSha256,/^[a-f0-9]{64}$/);assert.ok(result.duration>0.9);
  await prepareHeyGenNativeSpeechTrack(input,p.config);assert.equal(p.posts(),1);assert.equal(p.permits(),1);
  await assert.rejects(prepareHeyGenNativeSpeechTrack({...input,voiceId:'other'},p.config),/identity_changed/);
  await fs.appendFile(result.videoPath,'tamper');
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/video_hash_changed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('unknown submission is retained and does not retry POST',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-unknown-'));
 try {
  const p=ports(root,Buffer.from('unused'),{unknown:true});
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/network outcome unknown/);
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/submission_unknown_no_repost/);assert.equal(p.posts(),1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('silent mother video cannot be treated as a complete narration track',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-silent-'));
 try {
  const p=ports(root,await fixture(root,false));
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/audio_missing_or_invalid/);
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/audio_missing_or_invalid/);assert.equal(p.posts(),1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('wrong provider identity and over-budget duration stop before audio is accepted',async()=>{
 for(const options of [{wrongIdentity:true},{duration:3}]){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-evidence-'));
  try{
   const p=ports(root,await fixture(root),options);
   await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/provider_identity_changed|duration_exceeded/);
   await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/provider_identity_changed|duration_exceeded/);
   assert.equal(p.posts(),1);assert.notEqual(p.read()?.status,'completed');
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('explicit supplier rejection retains status and code without releasing or reposting the original hold',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-rejected-'));
 try {
  const p=ports(root,Buffer.from('unused'));let posts=0;
  p.config.fetch=(async(_url,init)=>{if(init?.method==='POST'){posts++;return Response.json({error:{code:'insufficient_balance',message:'Insufficient balance'}},{status:402});}throw Error('unexpected_get');}) as typeof fetch;
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/native_speech_track_provider_rejected:402:insufficient_balance/);
  assert.equal(p.read()?.status,'failed');assert.deepEqual(p.read()?.rejection,{status:402,code:'insufficient_balance'});
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/native_speech_track_provider_rejected:402:insufficient_balance/);
  assert.equal(posts,1);assert.equal(p.permits(),1);assert.equal(p.read()?.providerTaskId,undefined);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('accepted supplier credit failure keeps its original failure code after recovery without another POST',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-track-credit-failed-'));
 try {
  const p=ports(root,Buffer.from('unused'));let posts=0,statusReads=0;
  p.config.fetch=(async(_url,init)=>{
   if(init?.method==='POST'){posts++;return Response.json({data:{video_id:'accepted-credit-task'}});}
   statusReads++;return Response.json({data:{status:'failed',failure_code:'MOVIO_PAYMENT_INSUFFICIENT_CREDIT',failure_message:'requires plan_credit or api credits'}});
  }) as typeof fetch;
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/native_speech_track_provider_failed:MOVIO_PAYMENT_INSUFFICIENT_CREDIT/);
  assert.equal(p.read()?.providerTaskId,'accepted-credit-task');assert.equal(p.read()?.status,'failed');
  assert.equal(p.read()?.providerStatus?.failure_code,'MOVIO_PAYMENT_INSUFFICIENT_CREDIT');
  await assert.rejects(prepareHeyGenNativeSpeechTrack(input,p.config),/native_speech_track_provider_failed:MOVIO_PAYMENT_INSUFFICIENT_CREDIT/);
  assert.equal(posts,1);assert.equal(statusReads,1);assert.equal(p.permits(),1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
