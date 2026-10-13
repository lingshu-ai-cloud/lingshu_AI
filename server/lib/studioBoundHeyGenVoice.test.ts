import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { withStudioVoicePaidContext } from './studioVoicePaidOperation';
import { synthesizeBoundHeyGenVoice } from './studioBoundHeyGenVoice';

test('bound voice POST is exact and a failed audio download recovers without a second paid call', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'bound-voice-'));
 try {
  const mp3 = path.join(root,'fixture.mp3');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame',mp3]);
  const bytes = await fs.readFile(mp3); let posts=0, submits=0, downloads=0, completed=false;
  const call:any = {intent:{operationId:'bound-paid-operation',stage:'tts',provider:'heygen',model:'starfish',maximumUnits:{audioSeconds:2}},assertProviderBinding:async (r:any)=>assert.equal(r.voiceId,'bound'),measureUsage:async()=>({audioSeconds:2}),persistProviderReceipt:async()=> 'original-proof',permit:{beforeSubmit:async()=>{submits++;},markOutcome:async()=>{completed=true;},assertRecovery:async()=>{assert.equal(completed,true);}}};
  const context:any = {primaryProvider:'heygen',forRequest:async()=>call};
  const fetcher:any = async (url:any, init:any) => {
   if (String(url).includes('?type=private')) return Response.json({data:[{voice_id:'bound'}],has_more:false});
   if (init?.method==='POST') {posts++;const body=JSON.parse(init.body);assert.equal(body.voice_id,'bound');assert.equal(body.engine,'starfish');assert.equal(body.force_regenerate,false);return Response.json({data:{audio_url:'https://files.heygen.ai/actual.mp3',engine:'starfish',duration:1,request_id:'vendor-1'}});}
   if (++downloads===1) return new Response('temporary failure',{status:503});
   return new Response(bytes);
  };
  const input={text:'Hello.',voiceId:'bound',language:'en',output:path.join(root,'final.wav')};
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
