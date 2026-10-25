import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { withStudioVoicePaidContext } from './studioVoicePaidOperation';
import { synthesizeBoundHeyGenVoice } from './studioBoundHeyGenVoice';

for (const engine of ['starfish','orca'] as const) test(engine + ' bound voice recovers an accepted audio download without a second paid call', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'bound-voice-'));
 try {
  const mp3 = path.join(root,'fixture.mp3');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame',mp3]);
  const bytes = await fs.readFile(mp3); let posts=0, submits=0, downloads=0, completed=false;
  const call:any = {intent:{operationId:'bound-paid-operation',stage:'tts',provider:'heygen',model:engine,maximumUnits:{audioSeconds:2}},assertProviderBinding:async (r:any)=>assert.equal(r.voiceId,'bound'),measureUsage:async()=>({audioSeconds:2}),persistProviderReceipt:async()=> 'original-proof',permit:{beforeSubmit:async()=>{submits++;},markOutcome:async()=>{completed=true;},assertRecovery:async()=>{assert.equal(completed,true);}}};
  const context:any = {primaryProvider:'heygen',forRequest:async()=>call};
  const fetcher:any = async (url:any, init:any) => {
   if (String(url).endsWith('/v3/voices/bound')) return Response.json({data:{voice_id:'bound',available_engines:[engine]}});
   if (init?.method==='POST') {posts++;const body=JSON.parse(init.body);assert.equal(body.voice_id,'bound');assert.equal(body.engine,engine);assert.equal(body.force_regenerate,false);return Response.json({data:{audio_url:'https://files.heygen.ai/actual.mp3',engine,duration:1,request_id:'vendor-1'}});}
   if (++downloads===1) return new Response('temporary failure',{status:503});
   return new Response(bytes);
  };
  const input={text:'Hello.',voiceId:'bound',engine,language:'en',output:path.join(root,'final.wav')};
  await assert.rejects(withStudioVoicePaidContext(context,()=>synthesizeBoundHeyGenVoice(input,{key:'test-key',root,fetch:fetcher})),/audio_download_failed/);
  const result=await withStudioVoicePaidContext(context,()=>synthesizeBoundHeyGenVoice(input,{key:'test-key',root,fetch:fetcher}));
  assert.equal(result.voiceId,'bound');assert.ok(result.duration>.9);assert.equal(posts,1);assert.equal(submits,1);
  await assert.rejects(synthesizeBoundHeyGenVoice(input,{key:'test-key',root,fetch:fetcher}),/paid_route_required/);
  const receipt = (await fs.readdir(root)).find(file=>file.endsWith('.json'))!;
  await fs.writeFile(path.join(root,receipt), '{broken');
  await assert.rejects(withStudioVoicePaidContext(context,()=>synthesizeBoundHeyGenVoice(input,{key:'test-key',root,fetch:fetcher})),/receipt_corrupt_no_repost/);
  assert.equal(posts,1);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('an engine-filtered catalogue cannot authorize an incompatible or unverified voice', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'bound-voice-capability-'));
 try {
  for (const candidate of [
   {voice_id:'bound',available_engines:['orca'],default_engine:'orca'},
   {voice_id:'bound'},
   {voice_id:'another',available_engines:['starfish']},
  ]) {
   let submissions=0,posts=0;
   const call:any={intent:{operationId:'unsubmitted',maximumUnits:{audioSeconds:2}},assertProviderBinding:async()=>{}};
   const context:any={primaryProvider:'heygen',forRequest:async()=>call};
   const fetcher:any=async(_url:any,init:any)=>{
    if(init?.method==='POST'){posts++;throw Error('unexpected_paid_post');}
    return Response.json({data:candidate});
   };
   call.permit={beforeSubmit:async()=>{submissions++;}};
   await assert.rejects(withStudioVoicePaidContext(context,()=>synthesizeBoundHeyGenVoice(
    {text:'Hello.',voiceId:'bound',language:'en',output:path.join(root,'out.wav')},
    {key:'test-key',root,fetch:fetcher})),/presenter_narration_capability_unavailable|voice_metadata_invalid/);
   assert.equal(submissions,0);assert.equal(posts,0);
   assert.deepEqual((await fs.readdir(root)).filter(name=>name!=='.locks'),[],'no unknown submission marker may be written for a read-only capability rejection');
  }
 } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('Orca engine evidence mismatch retains an unknown submission and never retries a paid POST',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bound-orca-evidence-'));
 try {
  let posts=0;
  const call:any={intent:{operationId:'orca-unknown',stage:'tts',provider:'heygen',model:'orca',maximumUnits:{audioSeconds:2}},
   assertProviderBinding:async(r:any)=>assert.equal(r.model,'orca'),measureUsage:async()=>({audioSeconds:2}),
   permit:{beforeSubmit:async()=>{}},persistProviderReceipt:async()=>{throw Error('invalid response must not be accepted');}};
  const context:any={primaryProvider:'heygen',forRequest:async()=>call};
  const fetcher:any=async(_url:any,init:any)=>{
   if(init?.method==='POST'){posts++;return Response.json({data:{engine:'starfish',audio_url:'https://files.heygen.ai/wrong.mp3',duration:1}});}
   return Response.json({data:{voice_id:'bound',available_engines:['orca'],default_engine:'orca'}});
  };
  const run=()=>withStudioVoicePaidContext(context,()=>synthesizeBoundHeyGenVoice({text:'Hello.',voiceId:'bound',engine:'orca',language:'en',output:path.join(root,'out.wav')},{key:'test',root,fetch:fetcher}));
  await assert.rejects(run(),/provider_evidence_invalid/);
  await assert.rejects(run(),/submission_unknown_no_repost/);
  assert.equal(posts,1);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
