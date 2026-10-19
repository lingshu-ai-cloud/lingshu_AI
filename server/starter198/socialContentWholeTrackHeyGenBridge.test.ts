import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {createWholeTrackSocialHeyGenBridge} from './socialContentWholeTrackHeyGenBridge.js';
import {paidProductionHash,presenterGroupContractHash} from './socialContentPaidOperationPlan.js';
import {productionBillingAccountRef} from './socialContentProductionBudgetRoutes.js';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whole-heygen-consumer-')),oldCwd=process.cwd();process.chdir(root);
 const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)},key='controlled-no-live-key';
 const nativeVoice={provider:'heygen' as const,model:'starfish',physicalVoiceId:'historical-person-voice'};
 const wave=path.join(root,'track.wav');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','1','-ac','1','-c:a','pcm_s16le',wave],{stdio:'ignore'});
 const mp4=path.join(root,'controlled.mp4');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','color=c=blue:s=180x320:r=30','-t','1','-c:v','libx264','-pix_fmt','yuv420p',mp4],{stdio:'ignore'});
 const approvedFrame=path.join(root,'approved.jpg');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','color=c=green:s=720x1280','-frames:v','1',approvedFrame],{stdio:'ignore'});
 const source=path.join(root,'source.json'),alignment=path.join(root,'alignment.json'),receiptRef=path.join(root,'prepared.json');
 fs.writeFileSync(source,JSON.stringify({scope,operationId:'original-voice0',provider:nativeVoice.provider,model:nativeVoice.model,voiceId:nativeVoice.physicalVoiceId}));
 const wholeTrackSha256=sha(fs.readFileSync(wave)),cues=[{start:.1,end:.8,text:'Hello.'}];
 fs.writeFileSync(alignment,JSON.stringify({state:'completed',scope:{audioSha256:wholeTrackSha256},result:{transcripts:[{text:'Hello.',sentences:[{text:'Hello.',begin_time:100,end_time:800}]}]}}));
 const voice={ok:true as const,localPath:wave,duration:1,cues,text:'Hello.',url:'https://controlled.test/track.wav'};
 const prepared={voice,inputHash:'b'.repeat(64),receiptRef,wholeTrackSha256,sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice};
 fs.writeFileSync(receiptRef,JSON.stringify({status:'completed',inputHash:prepared.inputHash,scope,voice,scenes:[{shotId:'s1',spokenText:'Hello.',startSeconds:0,endSeconds:1,durationSeconds:1}],wholeTrackSha256,proof:{sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice}}));
 const requirement={key:'scene:s1:authorized_digital_presenter:presenter',stage:'presenter_video',shotId:'s1',sourceRef:null,durationSeconds:1,text:'Hello.',frameCount:null,inputContractHash:'c'.repeat(64)};
 const route={provider:'heygen',model:'avatar_iv',accountRef:productionBillingAccountRef('heygen','https://api.heygen.com/v3/videos',sha(key)),routeEvidenceRef:'controlled-live-presenter-type',usageBoundRef:'actual-window-audio',maximumUnits:{providerSeconds:1},maximumAttempts:1};
 const intent={operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage:requirement.stage,shotId:'s1',inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};
 const rows:any[]=[],claims:any[]=[],receipts=new Map<string,any>();let seq=0,acceptCrash=false,postError=false,uploads=0,posts=0,gets=0;
 const store:any={list:async(_c:string,q:any)=>{const items=rows.filter(row=>Object.entries(q.where||{}).every(([k,v])=>row[k]===v));return{items,totalItems:items.length,page:1,perPage:200,totalPages:1};},create:async(_c:string,row:any)=>{const saved={id:String(++seq),...structuredClone(row)};rows.push(saved);return saved;},update:async(_c:string,id:string,patch:any)=>{Object.assign(rows.find(row=>row.id===id),patch);return true;}};
 const permit:any={beforeSubmit:async(row:any)=>{assert.equal(claims.some(x=>x.operationId===row.operationId),false,'no repeated paid claim');claims.push(row);receipts.set(row.operationId,{status:'unknown',receiptRef:null});return {operationId:row.operationId};},assertRecovery:async(id:string)=>{assert.ok(receipts.has(id));return receipts.get(id);},markOutcome:async(id:string,status:string,ref:string)=>{if(status==='accepted'&&acceptCrash){acceptCrash=false;throw Error('crash after real original receipt');}receipts.set(id,{status,receiptRef:ref});}};
 const transport:typeof fetch=async(url:any,opts:any)=>{
  if(String(url)==='https://api.heygen.com/v3/assets'){uploads++;const type=opts.body.get('file').type;return Response.json({data:{asset_id:type.startsWith('image/')?'uploaded-approved-frame':'uploaded-same-track'}});}
  if(opts?.method==='POST'){posts++;const body=JSON.parse(opts.body);assert.equal(body.type,'image');assert.deepEqual(body.image,{type:'asset_id',asset_id:'uploaded-approved-frame'});assert.equal('avatar_id' in body,false);assert.equal(body.audio_asset_id,'uploaded-same-track');assert.equal('engine' in body,false);assert.equal('script' in body,false);assert.equal('voice_id' in body,false);if(postError)throw Error('ambiguous vendor create');return Response.json({data:{video_id:'original-video',credits:0.0805}});}
  gets++;assert.equal(String(url),'https://api.heygen.com/v3/videos/original-video');return Response.json({data:{status:'completed',video_url:'https://cdn.heygen.ai/original.mp4',duration:1}});
 };
 const request:any={tenantId:'tenant',taskId:'task',shotId:'s1',idempotencyKey:'final-video-idempotency',presenter:{presenterAssetId:'person',assetVersion:4,providerId:'heygen',providerPresenterId:'original-avatar',providerVoiceId:'historical-person-voice',authorized:true,authorizationRef:'owned-person',consentRef:'consent'},approvedFirstFrame:{approvalRecordId:'approval:1',approvalRecordHash:'d'.repeat(64),presenterGroupContractHash:'e'.repeat(64),url:'/media/approved.jpg',localPath:approvedFrame,sha256:sha(fs.readFileSync(approvedFrame))},script:'Hello.',aspectRatio:'9:16',outputDirectory:path.join(root,'nested-output'),maximumCostCny:2,visualControl:{timing:{startSeconds:0,endSeconds:.4,durationSeconds:.4},interaction:'talking'}};
 const options:any={funding:{scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[intent],permit,readReservedCny:()=>1,assertCurrent:async()=>{},assertLivePresenter:async(r:any,req:any,hash:string)=>{assert.equal(hash,sha(key));assert.equal(req.presenter.assetVersion,4);assert.deepEqual(r,route);}},prepared,taskVersion:'1',apiKey:key,store,transport,root:path.join(root,'durable'),dependencies:{store,storageReady:()=>true,download:async()=>fs.readFileSync(mp4),upload:async()=>{},head:async()=>({size:fs.statSync(mp4).size,etag:'controlled'}),pollIntervalMs:0,maxPolls:1}};
 const execute=async(ports:any)=>{const audio=await ports.resolveSpeechAudio(request);const budget=await ports.authorizeBudget({...request,providerId:'heygen'});assert.equal(budget.allowed,true);return ports.execute({...request,speechAudio:audio,reservationRef:budget.reservationRef});};
 return {root,scope,key,request,options,rows,claims,receipts,intent,execute,counters:()=>({uploads,posts,gets}),setUnknown:()=>{postError=true;},setAcceptCrash:()=>{acceptCrash=true;},cleanup:()=>{process.chdir(oldCwd);fs.rmSync(root,{recursive:true,force:true});}};
}
test('normal bridge consumes same whole-film permit and original audio-window bytes; restart is GET-only',async()=>{
 const f=fixture();try{const ports=createWholeTrackSocialHeyGenBridge(f.options);const output=await f.execute(ports);assert.equal(output.status,'completed');assert.deepEqual(f.request.visualControl.timing,{startSeconds:0,endSeconds:1,durationSeconds:1,actionPeakSeconds:.58},'final funded scene window overrides source-reference edit timing');assert.equal(f.claims.length,1);assert.deepEqual(f.claims[0].actualUnits,{providerSeconds:1});assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:1});
 const restartedAudio=await createWholeTrackSocialHeyGenBridge({...f.options,taskVersion:'2'}).resolveSpeechAudio!({...f.request,visualControl:{...f.request.visualControl,timing:{startSeconds:0,endSeconds:.4,durationSeconds:.4}}});assert.equal(restartedAudio.taskVersion,'1','task bookkeeping retries reuse the original paid audio binding and request identity');
 const lockRoot=path.join(f.options.root,'.provider-locks');fs.mkdirSync(lockRoot,{recursive:true});fs.writeFileSync(path.join(lockRoot,sha(sha(f.intent.operationId))+'.lock'),JSON.stringify({owner:'crashed-worker'}));
 const recovered=await createWholeTrackSocialHeyGenBridge(f.options).recoverExisting!(f.request);assert.equal(recovered?.status,'completed');assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:2});const receipt=JSON.parse(fs.readFileSync(f.receipts.get(f.intent.operationId).receiptRef,'utf8'));assert.equal(receipt.response.credits,.0805);assert.equal(receipt.actualInvoiceCny,null);
 await assert.rejects(createWholeTrackSocialHeyGenBridge({...f.options,apiKey:'other-account'}).resolveSpeechAudio!(f.request),/live_account_changed/);
 }finally{f.cleanup();}
});
test('weekly CTA recheck fences new HeyGen upload while an accepted video remains GET-recoverable',async()=>{
 const stopped=fixture();try{
  stopped.options.funding.assertNewSubmit=async()=>{throw Error('weekly_production_cta_evidence_required');};
  await assert.rejects(createWholeTrackSocialHeyGenBridge(stopped.options).resolveSpeechAudio!(stopped.request),/weekly_production_cta_evidence_required/);
  assert.deepEqual(stopped.counters(),{uploads:0,posts:0,gets:0});
  assert.equal(stopped.claims.length,0);
 }finally{stopped.cleanup();}
 const accepted=fixture();try{
  assert.equal((await accepted.execute(createWholeTrackSocialHeyGenBridge(accepted.options))).status,'completed');
  accepted.options.funding.assertNewSubmit=async()=>{throw Error('weekly_production_cta_evidence_required');};
  const recovered=await createWholeTrackSocialHeyGenBridge(accepted.options).recoverExisting!(accepted.request);
  assert.equal(recovered?.status,'completed');
  assert.deepEqual(accepted.counters(),{uploads:2,posts:1,gets:2});
 }finally{accepted.cleanup();}
});
test('unknown paid POST remains fenced; missing upload proof cannot upload again',async()=>{
 const f=fixture();try{f.setUnknown();assert.equal((await f.execute(createWholeTrackSocialHeyGenBridge(f.options))).status,'uncertain');await assert.rejects(createWholeTrackSocialHeyGenBridge(f.options).recoverExisting!(f.request));assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:0});
 const audio=f.rows[0].visual_control.speechAudio;fs.rmSync(audio.receiptRef);await assert.rejects(createWholeTrackSocialHeyGenBridge(f.options).resolveSpeechAudio!(f.request),/upload_proof_missing_no_repost/);assert.equal(f.counters().uploads,2);
 }finally{f.cleanup();}
});
test('lost local mother bytes recover only by the original accepted operation; unknown POST never retries',async()=>{
 const completed=fixture();try{
  const output=await completed.execute(createWholeTrackSocialHeyGenBridge(completed.options));
  assert.equal(output.status,'completed');
  if(output.status!=='completed')throw Error('fixture_output_missing');
  fs.rmSync(output.localPath);
  const recovered=await createWholeTrackSocialHeyGenBridge(completed.options).recoverExisting!(completed.request);
  assert.equal(recovered?.status,'completed');
  assert.deepEqual(completed.counters(),{uploads:2,posts:1,gets:2},'missing local cache bytes must use original provider GET, not a second POST');
 }finally{completed.cleanup();}
 const unknown=fixture();try{
  unknown.setUnknown();
  assert.equal((await unknown.execute(createWholeTrackSocialHeyGenBridge(unknown.options))).status,'uncertain');
  await assert.rejects(createWholeTrackSocialHeyGenBridge(unknown.options).recoverExisting!(unknown.request));
  assert.deepEqual(unknown.counters(),{uploads:2,posts:1,gets:0},'unknown submission without an accepted receipt must remain fenced');
 }finally{unknown.cleanup();}
});
test('completed bound receipt survives supplier GET outage but rejects changed identity',async()=>{
 const f=fixture();try{
  assert.equal((await f.execute(createWholeTrackSocialHeyGenBridge(f.options))).status,'completed');
  f.options.funding.assertLivePresenter=async()=>{throw Object.assign(new Error('fetch failed'),{code:'ECONNRESET'});};
  const cached=createWholeTrackSocialHeyGenBridge(f.options);
  const audio=await cached.resolveSpeechAudio!(f.request);
  assert.equal(audio.voiceId,f.request.presenter.providerVoiceId);
  assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:1});
  await assert.rejects(cached.resolveSpeechAudio!({...f.request,presenter:{...f.request.presenter,providerPresenterId:'changed'}}),/completed_receipt_scope_changed/);
 }finally{f.cleanup();}
});
test('accepted raw receipt restores original task despite crash before ledger acceptance or datastore task ID',async()=>{
 const f=fixture();try{f.setAcceptCrash();assert.equal((await f.execute(createWholeTrackSocialHeyGenBridge(f.options))).status,'uncertain');assert.equal(f.rows[0].provider_task_id,undefined);
 const restored=await createWholeTrackSocialHeyGenBridge(f.options).recoverExisting!(f.request);assert.equal(restored?.status,'completed');assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:1});
 }finally{f.cleanup();}
});
test('changed approved first-frame bytes are rejected before image upload or video POST',async()=>{
 const f=fixture();try{fs.appendFileSync(f.request.approvedFirstFrame.localPath,'changed');await assert.rejects(f.execute(createWholeTrackSocialHeyGenBridge(f.options)),/approved_first_frame_bytes_changed/);assert.deepEqual(f.counters(),{uploads:1,posts:0,gets:0});assert.equal(f.claims.length,0);}finally{f.cleanup();}
});
test('approved correction selects attempt one and never reuses completed attempt zero identity',async()=>{
 const f=fixture();try{const requirement=f.options.funding.requirements[0],route=f.options.funding.routeBindings[requirement.key];const correction={attempt:1 as const,cause:'approved_first_frame_not_consumed' as const,authorizationRef:'correction-grant',presenterGroupId:'s1',approvalRecordHash:f.request.approvedFirstFrame.approvalRecordHash};
 const retry={...f.intent,operationId:'paid-plan:'+paidProductionHash({scope:f.scope,key:requirement.key,attempt:1,correction}),inputContractHash:paidProductionHash({requirement,route,attempt:1,correction}),correction};f.options.funding.intents.push(retry);
 const output=await f.execute(createWholeTrackSocialHeyGenBridge(f.options));assert.equal(output.status,'completed');assert.equal(f.claims[0].operationId,retry.operationId);assert.notEqual(f.claims[0].operationId,f.intent.operationId);
 }finally{f.cleanup();}
});
test('group request uses one canonical mother-segment operation and rejects changed member contract hash',async()=>{
 const configure=(f:ReturnType<typeof fixture>)=>{
  const groupId='presenter-group-a',shotIds=['s1','s2'];
  const value={groupId,shotIds,durationSeconds:1,spokenText:'Hello.',presenterAssetId:'person'};
  const requirement={key:`presenter-group:${groupId}:presenter`,stage:'presenter_video',shotId:null,sourceRef:null,durationSeconds:1,text:'Hello.',frameCount:null,presenterGroupId:groupId,presenterGroupShotIds:shotIds,presenterAssetId:'person',presenterGroupContractHash:presenterGroupContractHash(value),inputContractHash:'d'.repeat(64)};
  const route=Object.values(f.options.funding.routeBindings)[0] as any;
  const intent={operationId:'paid-plan:'+paidProductionHash({scope:f.scope,key:requirement.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage:requirement.stage,shotId:null,inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};
  f.options.funding.requirements=[
   {...requirement,key:`presenter-group:${groupId}:first-frame`,stage:'first_frame'},
   {...requirement,key:`presenter-group:${groupId}:first-frame-qa`,stage:'first_frame_qa'},
   requirement,
  ];f.options.funding.routeBindings={[requirement.key]:route};f.options.funding.intents=[intent];f.request.shotId=groupId;
  const prepared=JSON.parse(fs.readFileSync(f.options.prepared.receiptRef,'utf8'));prepared.scenes=[{shotId:groupId,spokenText:'Hello.',startSeconds:0,endSeconds:1,durationSeconds:1}];fs.writeFileSync(f.options.prepared.receiptRef,JSON.stringify(prepared));
  f.request.approvedFirstFrame.presenterGroupContractHash=requirement.presenterGroupContractHash;return {requirement,intent};
 };
 const f=fixture();try{const {intent}=configure(f);const output=await f.execute(createWholeTrackSocialHeyGenBridge(f.options));assert.equal(output.status,'completed');assert.equal(f.claims.length,1);assert.equal(f.claims[0].operationId,intent.operationId);assert.equal(f.claims[0].shotId,null);assert.deepEqual(f.counters(),{uploads:2,posts:1,gets:1});}finally{f.cleanup();}
 const changed=fixture();try{const {requirement}=configure(changed);requirement.presenterGroupShotIds=['s1','s3'];await assert.rejects(createWholeTrackSocialHeyGenBridge(changed.options).resolveSpeechAudio!(changed.request),/group_contract_changed/);assert.deepEqual(changed.counters(),{uploads:0,posts:0,gets:0});}finally{changed.cleanup();}
});
