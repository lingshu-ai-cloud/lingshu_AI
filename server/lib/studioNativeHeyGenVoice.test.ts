import { runWithContentExecutionContext } from '../contentExecution/context.js';
import type { DataStore } from '../storage/datastore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { withStudioVoicePaidContext } from './studioVoicePaidOperation';
import { synthesizeNativeHeyGenVoice } from './studioNativeHeyGenVoice';
import { resolveStudioVoiceExecutionPlan } from '../routes/studio';
test('native funded TTS keeps original avatar and voice, stores real video/SRT and recovers one paid operation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-funded-voice-'));const queue=queueStore();
 try {
  const fixture=path.join(root,'fixture.mp4');execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',fixture]);
  const video=await fs.readFile(fixture);let posts=0,claims=0,completed=0,statuses=0,accepted=0;const receiptRows:any[]=[];
  const call:any={intent:{operationId:'native-funded-operation',stage:'tts',provider:'heygen',model:'avatar_iv',maximumUnits:{providerSeconds:76}},
   assertProviderBinding:async(request:any)=>{assert.equal(request.model,'avatar_iv');assert.equal(request.endpoint,'https://api.heygen.com/v3/videos');assert.equal(request.voiceId,'original');},
   measureUsage:async()=>({providerSeconds:76}),persistProviderReceipt:async(row:any)=>{receiptRows.push(row);return 'canonical-original-receipt';},
   permit:{beforeSubmit:async()=>{claims++;},markOutcome:async(_id:string,state:string)=>{if(state==='completed')completed++;else if(state==='accepted')accepted++;},assertRecovery:async()=>{}}};
  const context:any={primaryProvider:'heygen',primaryModel:'avatar_iv',nativeSpeech:{scope:{tenantId:'tenant',taskId:'task',runId:'run'},avatarId:'Brody',maximumDurationSeconds:76},forRequest:async()=>call};
  const transport=(async(url:any,init:any)=>{
   if(init?.method==='POST'){posts++;const body=JSON.parse(init.body);assert.equal(body.avatar_id,'Brody');assert.equal(body.voice_id,'original');assert.equal(body.script,'Hello.');assert.deepEqual(body.caption,{file_format:'srt'});return Response.json({data:{video_id:'original-video'}});}
   if(String(url).endsWith('/v3/videos/original-video')){statuses++;return Response.json({data:{status:'completed',video_url:'https://files.heygen.ai/original.mp4',subtitle_url:'https://files.heygen.ai/original.srt',duration:1}});}
   if(String(url).endsWith('.srt'))return new Response('1\n00:00:00,000 --> 00:00:01,000\nHello.\n');
   return new Response(video);
  }) as typeof fetch;
  const input={text:'Hello.',voiceId:'original',output:path.join(root,'out.wav')};
  const run=()=>runWithContentExecutionContext({dataStore:queue.store,jobId:'job',providerReceipts:queue.job().provider_receipts,action:()=>withStudioVoicePaidContext(context,()=>synthesizeNativeHeyGenVoice(input,{root,key:'fixture',fetch:transport}))});
  const result=await run();assert.ok(result.duration>0.9);assert.equal(result.voiceId,'original');assert.match(result.nativeSpeechTrack.subtitleSha256!,/^[a-f0-9]{64}$/);
  assert.equal(queue.job().provider_state,'completed');assert.equal(queue.job().provider_receipts[0].providerTaskId,'original-video');
  await queue.store.update('content_execution_jobs','job',{provider_receipts:[],provider_state:'none'});
  await run();assert.equal(queue.job().provider_state,'completed');assert.equal(posts,1);assert.equal(claims,1);assert.equal(statuses,1);assert.equal(accepted,1);assert.equal(completed,2);
  assert.deepEqual(receiptRows[0],receiptRows[1],'canonical completion evidence is stable on recovery');
  assert.equal(receiptRows[0].response.nativeSpeechTrack.providerTaskId,'original-video');
  assert.ok(receiptRows[0].response.subtitlePath.endsWith('.srt'));
  await assert.rejects(synthesizeNativeHeyGenVoice(input,{root,key:'fixture',fetch:transport}),/funded_context_required/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('native video route is an explicit trusted mode and leaves logical Orca voice unchanged',()=>{
 const input={tenantId:'tenant',text:'Hello.',voice:'heygen:original:hash:orca',env:{HEYGEN_API_KEY:'fixture'}};
 const independent=resolveStudioVoiceExecutionPlan(input);
 assert.equal(independent.primary?.model,'orca');
 const native=resolveStudioVoiceExecutionPlan({...input,heygenSpeechMode:'native_video'});
 assert.equal(native.primary?.model,'avatar_iv');assert.equal(native.primary?.endpoint,'https://api.heygen.com/v3/videos');assert.equal(native.logicalVoice,input.voice);assert.equal(native.fallback,null);
});

function queueStore() {
 let sequence=0;const rows=new Map<string,any>([
  ['content_execution_jobs:job',{id:'job',tenant_id:'tenant',task_id:'task',run_id:'run',status:'running',provider_state:'none',provider_receipts:[]}],
  ['workflow_runs:run',{id:'run',tenant_id:'tenant',status:'running',current_controller:'system'}],
 ]);
 const store:any={getById:async(c:string,id:string)=>structuredClone(rows.get(c+':'+id)||null),
  list:async(c:string,o:any={})=>{const items=[...rows.entries()].filter(([key])=>key.startsWith(c+':')).map(([,row])=>row).filter(row=>Object.entries(o.where||{}).every(([key,value])=>row[key]===value));return{items:structuredClone(items),page:1,perPage:100,totalItems:items.length,totalPages:1};},
  create:async(c:string,v:any)=>{const id='row-'+ ++sequence;const row={id,...structuredClone(v)};rows.set(c+':'+id,row);return structuredClone(row);},
  update:async(c:string,id:string,v:any)=>{const row=rows.get(c+':'+id);if(!row)return false;Object.assign(row,structuredClone(v));return true;},
  delete:async(c:string,id:string)=>rows.delete(c+':'+id)};
 return {store:store as DataStore,job:()=>structuredClone(rows.get('content_execution_jobs:job'))};
}
test('native provider receipts synchronize accepted, failed and unknown states into the original durable job on recovery',async()=>{
 for(const outcome of ['pending','failed','unknown'] as const){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-job-sync-'));const queue=queueStore();let posts=0;
  try{
   const call:any={intent:{operationId:'native-sync-'+outcome,stage:'tts',provider:'heygen',model:'avatar_iv',maximumUnits:{providerSeconds:76}},assertProviderBinding:async()=>{},measureUsage:async()=>({providerSeconds:76}),persistProviderReceipt:async()=>{throw Error('not completed');},permit:{beforeSubmit:async()=>{},markOutcome:async()=>{},assertRecovery:async()=>{}}};
   const context:any={primaryProvider:'heygen',primaryModel:'avatar_iv',nativeSpeech:{scope:{tenantId:'tenant',taskId:'task',runId:'run'},avatarId:'Brody',maximumDurationSeconds:76},forRequest:async()=>call};
   const transport=(async(_url,init)=>{
    if(init?.method==='POST'){posts++;if(outcome==='unknown')throw Error('network_unknown');return Response.json({data:{video_id:'original-'+outcome}});}
    return Response.json({data:outcome==='failed'?{status:'failed',failure_code:'MOVIO_PAYMENT_INSUFFICIENT_CREDIT'}:{status:'pending'}});
   }) as typeof fetch;
   const run=()=>runWithContentExecutionContext({dataStore:queue.store,jobId:'job',providerReceipts:queue.job().provider_receipts,
    action:()=>withStudioVoicePaidContext(context,()=>synthesizeNativeHeyGenVoice({text:'Hello.',voiceId:'original',output:path.join(root,'out.wav')},{root,key:'fixture',fetch:transport}))});
   await assert.rejects(run());
   let receipt=queue.job().provider_receipts[0];assert.equal(receipt.requestId,call.intent.operationId);assert.equal(receipt.provider,'heygen');
   assert.equal(receipt.state,outcome==='pending'?'accepted':outcome);assert.equal(receipt.providerTaskId,outcome==='unknown'?null:'original-'+outcome);
   if(outcome==='failed'){assert.equal(queue.job().provider_state,'failed');assert.equal(receipt.metadata.failureCode,'MOVIO_PAYMENT_INSUFFICIENT_CREDIT');}
   // Simulate a historical worker which persisted local supplier evidence but
   // missed the job projection. Recovery backfills the same operation receipt.
   await queue.store.update('content_execution_jobs','job',{provider_receipts:[],provider_state:'none'});
   await assert.rejects(run());assert.equal(posts,1);
   receipt=queue.job().provider_receipts[0];assert.equal(receipt.state,outcome==='pending'?'accepted':outcome);
   if(outcome==='failed')assert.equal(receipt.metadata.failureCode,'MOVIO_PAYMENT_INSUFFICIENT_CREDIT');
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('local paid permit rejection never creates a supplier submission receipt',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-permit-rejected-'));const queue=queueStore();let posts=0,permits=0;
 try{
  const call:any={intent:{operationId:'native-permit-rejected',stage:'tts',provider:'heygen',model:'avatar_iv',maximumUnits:{providerSeconds:76}},assertProviderBinding:async()=>{},measureUsage:async()=>({providerSeconds:76}),
   permit:{beforeSubmit:async()=>{permits++;throw Error('budget_reservation_missing');}},persistProviderReceipt:async()=>{throw Error('never completed');}};
  const context:any={primaryProvider:'heygen',primaryModel:'avatar_iv',nativeSpeech:{scope:{tenantId:'tenant',taskId:'task',runId:'run'},avatarId:'Brody',maximumDurationSeconds:76},forRequest:async()=>call};
  await assert.rejects(runWithContentExecutionContext({dataStore:queue.store,jobId:'job',providerReceipts:[],action:()=>withStudioVoicePaidContext(context,()=>synthesizeNativeHeyGenVoice({text:'Hello.',voiceId:'original',output:path.join(root,'out.wav')},{root,key:'fixture',fetch:(async()=>{posts++;throw Error('unexpected_post');}) as typeof fetch}))}),/budget_reservation_missing/);
  assert.equal(permits,1);assert.equal(posts,0);assert.equal(queue.job().provider_state,'none');assert.deepEqual(queue.job().provider_receipts,[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
