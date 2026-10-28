import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {mapMeasuredSceneTimeline} from './socialContentMeasuredSceneTimeline.js';
import {sealSocialSceneMediaCache,createSocialSceneReworkIntent} from './socialContentSceneRework.js';
import {prepareSceneReworkPresenterPlan,readSceneReworkPresenterAudio} from './socialContentSceneReworkPresenter.js';
import {productionBillingAccountRef} from './socialContentProductionBudgetRoutes.js';
import {socialPaidIntentOperation} from '../lib/socialContentTaskBudgetAuthority.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {reserveSceneReworkFilmBudget,sceneReworkOverageDecision} from './socialContentSceneReworkFilmBudget.js';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'presenter-repair-'));
 const scope={tenantId:'t',taskId:'task',runId:'original',planHash:'a'.repeat(64)},nativeVoice={provider:'heygen',model:'avatar_iv',physicalVoiceId:'voice'};
 const audio=path.join(root,'track.wav'),source=path.join(root,'source.json'),alignment=path.join(root,'alignment.json'),receiptRef=path.join(root,'prepared.json'),frame=path.join(root,'frame.png');
 execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','2','-ac','1','-c:a','pcm_s16le',audio],{stdio:'ignore'});
 const audioHash=sha(await readFile(audio)),cues=[{start:0,end:2,text:'Hello.'}],scenes=[{shotId:'s1',spokenText:'Hello.',startSeconds:0,endSeconds:1,durationSeconds:1}],timeline=mapMeasuredSceneTimeline({scenes,cues,durationSeconds:2});
 await writeFile(source,JSON.stringify({scope,provider:'heygen',model:'avatar_iv',voiceId:'voice',operationId:'paid-original-voice'}));
 await writeFile(alignment,JSON.stringify({state:'completed',scope:{audioSha256:audioHash},result:{transcripts:[{text:'Hello.',sentences:[{text:'Hello.',begin_time:0,end_time:2000}]}]}}));
 const voice={ok:true,localPath:audio,url:audio,duration:2,cues};
 const prepared={voice,inputHash:'prepared',receiptRef,wholeTrackSha256:audioHash,sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice,timingPolicy:'voice-driven-slots.v1',measuredSceneTimeline:timeline};
 await writeFile(receiptRef,JSON.stringify({status:'completed',inputHash:'prepared',scope,voice,wholeTrackSha256:audioHash,scenes,voiceDriven:true,measuredTimeline:timeline,proof:{sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice}}));
 await writeFile(frame,'owned frame bytes');
 const shot={shotId:'s1',sourceStrategy:'authorized_digital_presenter',fallbackSourceStrategy:null,digitalHumanPlan:{presenterAssetIds:['person']},approvedFirstFrame:{localPath:frame,sha256:sha(await readFile(frame)),approvalRecordHash:'c'.repeat(64),presenterGroupContractHash:'d'.repeat(64)}};
 const plan={materialRoutingPolicyVersion:'type-aware.v3',planVersion:'1',shots:[shot]};
 const cache=sealSocialSceneMediaCache({tenantId:'t',taskId:'task',runId:'original',parentArtifactId:'film',parentArtifactHash:'original-hash',planVersion:'1',planHash:paidProductionHash(plan),schemaVersion:'social-scene-media-cache.v1',measuredVoiceProof:{scope,prepared,scenes:[{sceneId:'s1',duration:{startSeconds:0,endSeconds:1}}]},scenes:[{sceneId:'s1',status:'failed',technicalReceiptId:'failed'}],renderInput:{voice:{localPath:audio,sha256:audioHash},bgm:null,manifest:{timeline:[{sceneId:'s1',targetStart:0,targetEnd:2}]}}} as any);
 const intent=createSocialSceneReworkIntent(cache,'actor',['s1'],'repair','user_selected');
 const actual:any={cache,intent,plan,baseline:{scenes:[{sceneId:'s1',voiceover:'Hello.'}]}};
 const repository:any={dataStore:{list:async()=>({items:[],totalItems:0})}};
 const binding:any={tenantId:'t',presenterAssetId:'person',assetVersion:1,avatarId:'avatar',voiceId:'voice',model:'avatar_iv',credentialSha256:sha('key'),accountRef:productionBillingAccountRef('heygen','https://api.heygen.com/v3/videos',sha('key')),avatarType:'photo_avatar',billingCurrency:'USD',billingEvidenceRef:'wallet',authorizationRef:'rights',consentRef:'consent',providerEvidenceRef:'live'};
 const readBinding:any=async()=>binding;
 const readTariff:any=async(intent:any)=>({provider:intent.provider,model:intent.model,accountRef:intent.accountRef,stage:intent.stage,currency:'CNY',verifiedAccountPrice:true,evidenceRef:'actual-contract',checkedAt:'2026-01-01',validUntil:'2099-01-01',meters:{providerSeconds:{priceCny:1,unitsPerPrice:2,minimumUnits:0,increment:.001}}});
 return {root,scope,actual,repository,binding,readBinding,readTariff,audio,clean:()=>rm(root,{recursive:true,force:true})};
}
test('presenter repair derives canonical video quote and exact audio from original measured slot without TTS',async()=>{
 const f=await fixture();try{
  const p=await prepareSceneReworkPresenterPlan(f),row=p.operations[0]!;
  assert.equal(p.totalUpperBoundCny,1);assert.equal(row.requirement.durationSeconds,2,'measured audio replaces one-second reference');
  assert.equal(row.intent.stage,'presenter_video');assert.equal(p.sourceVoiceScope.runId,'original');assert.equal(p.scope.runId,'repair');
  assert.equal(row.intent.operationId,'paid-plan:'+paidProductionHash({scope:p.scope,key:row.requirement.key,attempt:0}));
  const clip=await readSceneReworkPresenterAudio({...f,shotId:'s1',assertCurrent:async()=>{}});
  assert.deepEqual(clip.range,{start:0,end:2});assert.equal(clip.scope.runId,'original');assert.equal(clip.durationSeconds,2);
  assert.equal(clip.wholeTrackSha256,f.actual.cache.renderInput.voice.sha256);
  assert.deepEqual(await prepareSceneReworkPresenterPlan({...f,frozen:p}),p);
  assert.deepEqual(await prepareSceneReworkPresenterPlan({...f,readBinding:async()=>({...f.binding,billingEvidenceRef:'same-account-new-wallet-balance'})}),p,'mutable wallet balance cannot invalidate an unchanged canonical quote');
  await assert.rejects(readSceneReworkPresenterAudio({...f,shotId:'unselected',assertCurrent:async()=>{}}),/selection_changed/);
  await assert.rejects(prepareSceneReworkPresenterPlan({...f,readBinding:async()=>({...f.binding,voiceId:'different'})}),/bound_voice_changed/);
  await writeFile(f.audio,'changed');await assert.rejects(prepareSceneReworkPresenterPlan(f),/voice_bytes_changed/);
 }finally{await f.clean();}
});
test('single presenter quote uses one original-film entry and one exact overage grant, with no aggregate double charge',async()=>{
 for(const cost of [1,2]){const f=await fixture();try{
  const presenterPlan=await prepareSceneReworkPresenterPlan({...f,readTariff:async(intent:any)=>({...await f.readTariff(intent),meters:{providerSeconds:{priceCny:cost,unitsPerPrice:2,minimumUnits:0,increment:.001}}})}),quote:any={provider:'heygen',model:'avatar_iv',presenterPlan,
   totalUpperBoundCny:presenterPlan.totalUpperBoundCny,planHash:presenterPlan.scope.planHash,recordHash:'e'.repeat(64),tariffSourceRef:'contract',validUntil:'2099-01-01'};
  const policy:any={scope:{tenantId:'t',taskId:'task',runId:'repair',operationId:f.actual.intent.operationId,actorUserId:'actor'},quote,recordHash:'f'.repeat(64)};
  // Existing cost lineage reader requires the real root task row, not a caller-supplied budget ID.
  f.repository.dataStore.list=async(collection:string)=>collection==='starter_social_content_tasks'?{items:[{id:'task',tenant_id:'t',task_id:'task',created_at:'2026-10-28',brief:{}}],totalItems:1}:{items:[],totalItems:0};
  f.repository.list=(collection:string)=>f.repository.dataStore.list(collection);
  const ledgerRoot=path.join(f.root,'budget'),ledger=new SocialContentTaskBudget(ledgerRoot,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:15,productionDurationSeconds:2,authorizationRef:'original'}),quote:async()=>({upperBoundCny:14,quoteRef:'original',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
  await ledger.reserveBatch(f.scope,[{operationId:'original',fingerprint:'b'.repeat(64),provider:'heygen',model:'avatar_iv',accountRef:'account',stage:'tts',shotId:null}]);await ledger.markOutcome(f.scope,'original','completed','original-receipt');
  const input={repository:f.repository,policy,ledgerRoot,assertCurrent:async()=>{},voiceDriven:true};
  if(cost===2){const choice={...input,sourceRunId:'original',actorUserId:'actor'};const preview=await sceneReworkOverageDecision(choice);assert.equal(preview!.extraCny,1);await sceneReworkOverageDecision({...choice,previewHash:preview!.previewHash});}
  const funded=await reserveSceneReworkFilmBudget(input);await funded.beforeExecute();
  assert.equal(ledger.status(f.scope)!.retainedCny,14+cost);assert.equal(ledger.status(f.scope)!.entries.length,2);
  assert.equal(funded.operation.operationId,presenterPlan.operations[0]!.intent.operationId);
  assert.equal(funded.operation.fingerprint,socialPaidIntentOperation(presenterPlan.scope,presenterPlan.operations[0]!.intent).fingerprint);
  await funded.ledger.markOutcome(funded.scope,funded.operation.operationId,'accepted','accepted');
  await reserveSceneReworkFilmBudget(input);assert.equal(ledger.status(f.scope)!.retainedCny,14+cost,'recovery keeps original paid reservation');
 }finally{await f.clean();}}
});

test('presenter quote projection omits private raw pricing, account proofs and local media paths',async()=>{
 const {publicSceneReworkCostEvidence}=await import('./socialContentSceneReworkCostProjection.js');
 const f=await fixture();try{
  const plan=await prepareSceneReworkPresenterPlan(f);
  const result=publicSceneReworkCostEvidence({quote:{provider:'heygen',presenterPlan:plan},policy:{quote:{presenterPlan:plan}}}) as any;
  const json=JSON.stringify(result);
  assert.equal(json.includes(f.root),false);assert.equal(json.includes('credentialSha256'),false);
  assert.equal(json.includes('actual-contract'),false);assert.equal(json.includes('approvedFirstFrame'),false);
  assert.equal(result.quote.presenterPlan.operations[0].sceneId,'s1');assert.equal(result.quote.presenterPlan.totalUpperBoundCny,1);
  assert.equal(result.policy.quote.presenterPlan.recordHash,plan.recordHash);
 }finally{await f.clean();}
});

test('repair bridge consumes original ledger permit, preserves speech and recovers the same supplier task after restart',async()=>{
 const {createSceneReworkPresenterBridge}=await import('./socialContentSceneReworkPresenterBridge.js');
 const f=await fixture(),oldKey=process.env.HEYGEN_API_KEY,oldPermit=process.env.SOCIAL_CONTENT_PAID_PERMIT_DIR,originalFetch=global.fetch;
 process.env.HEYGEN_API_KEY='key';process.env.SOCIAL_CONTENT_PAID_PERMIT_DIR=path.join(f.root,'permits');
 try{
  const rows:any[]=[];let sequence=0;
  const presenter={id:'person',authorized:true,assetVersion:1,avatarId:'avatar',voiceId:'voice',rightsEvidence:{authorizationRef:'rights://owned',consentRef:'consent://owned',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}};
  const store:any={list:async(collection:string,q:any)=>{
   const items=collection==='studio_production_defaults'?[{tenant_id:'t',payload:{presenters:[presenter]}}]:collection==='starter_social_content_tasks'?[{tenant_id:'t',task_id:'task',brief:{},created_at:'2026-10-28'}]:rows.filter(row=>Object.entries(q?.where??{}).every(([key,value])=>row[key]===value));return {items,totalItems:items.length};},
   create:async(_collection:string,data:any)=>{const row={id:String(++sequence),...structuredClone(data)};rows.push(row);return row;},update:async(_collection:string,id:string,patch:any)=>{Object.assign(rows.find(row=>row.id===id),patch);return true;}};
  f.repository.dataStore=store;f.repository.list=(collection:string)=>store.list(collection,{});
  global.fetch=async(url:any)=>{
   if(String(url).includes('/avatars/looks/'))return Response.json({data:{id:'avatar',status:'completed',supported_api_engines:['avatar_iv'],avatar_type:'photo_avatar',default_voice_id:'voice'}});
   if(String(url).endsWith('/users/me'))return Response.json({data:{billing_type:'wallet',wallet:{currency:'USD',remaining_balance:20}}});
   throw Error('unexpected external read '+url);
  };
  const {readTrustedHeyGenRuntimeBinding}=await import('./socialContentHeyGenRuntimeBinding.js');
  const binding=(await readTrustedHeyGenRuntimeBinding({tenantId:'t',presenterAssetId:'person'},{store}))!;
  const presenterPlan=await prepareSceneReworkPresenterPlan({...f,readBinding:async()=>binding});
  const frame=presenterPlan.operations[0]!.approvedFirstFrame;
  Object.assign(frame,{approvalRecordId:'approved',url:'/owned/frame.png'});
  const policy:any={scope:{tenantId:'t',taskId:'task',runId:'repair',operationId:f.actual.intent.operationId,actorUserId:'actor'},quote:{provider:'heygen',model:'avatar_iv',presenterPlan,totalUpperBoundCny:1,planHash:presenterPlan.scope.planHash,recordHash:'e'.repeat(64),tariffSourceRef:'contract',validUntil:'2099-01-01'},recordHash:'f'.repeat(64)};
  const ledgerRoot=path.join(f.root,'ledger'),ledger=new SocialContentTaskBudget(ledgerRoot,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:15,productionDurationSeconds:2,authorizationRef:'original'}),quote:async()=>({upperBoundCny:14,quoteRef:'original',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
  await ledger.reserveBatch(f.scope,[{operationId:'original',fingerprint:'b'.repeat(64),provider:'heygen',model:'avatar_iv',accountRef:binding.accountRef,stage:'tts',shotId:null}]);await ledger.markOutcome(f.scope,'original','completed','voice-original');
  const budget=await reserveSceneReworkFilmBudget({repository:f.repository,policy,ledgerRoot,assertCurrent:async()=>{},voiceDriven:true});
  const mp4=path.join(f.root,'output.mp4');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','color=c=blue:s=180x320:r=30','-t','2','-c:v','libx264','-pix_fmt','yuv420p',mp4],{stdio:'ignore'});
  let posts=0,gets=0,uploads=0;
  const transport:typeof fetch=async(url:any,init:any)=>{
   if(String(url).endsWith('/assets')){uploads++;return Response.json({data:{asset_id:init.body.get('file').type.startsWith('image/')?'image':'audio'}});}
   if(init?.method==='POST'){posts++;const body=JSON.parse(init.body);assert.equal(body.audio_asset_id,'audio');assert.equal('script' in body,false);return Response.json({data:{video_id:'same-repair-video'}});}
   gets++;return Response.json({data:{status:'completed',video_url:'https://cdn.heygen.ai/result.mp4',duration:2}});
  };
  const options:any={repository:f.repository,actual:f.actual,job:{},policy,budget,assertCurrent:async()=>{},bridgeOptions:{root:path.join(f.root,'bridge'),transport,dependencies:{store,storageReady:()=>true,download:async()=>readFile(mp4),upload:async()=>{},head:async()=>({size:(await readFile(mp4)).length,etag:'verified'}),pollIntervalMs:0,maxPolls:1}}};
  const ports=createSceneReworkPresenterBridge(options);
  const request:any={tenantId:'t',taskId:'task',shotId:'s1',idempotencyKey:'repair-request',presenter:{presenterAssetId:'person',providerId:'heygen',assetVersion:1,providerPresenterId:'avatar',providerVoiceId:'voice',authorized:true,authorizationRef:'rights://owned',consentRef:'consent://owned'},approvedFirstFrame:frame,script:'Hello.',aspectRatio:'9:16',outputDirectory:path.join(f.root,'render'),maximumCostCny:1,visualControl:{timing:{startSeconds:0,endSeconds:1,durationSeconds:1},interaction:'talking'}};
  const originalExpiry=presenterPlan.operations[0]!.quote.validUntil;presenterPlan.operations[0]!.quote.validUntil='2000-01-01';
  await assert.rejects(ports.resolveSpeechAudio!(request),/quote_expired/);assert.equal(uploads,0);presenterPlan.operations[0]!.quote.validUntil=originalExpiry;
  const audio=await ports.resolveSpeechAudio!(request);const approved=await ports.authorizeBudget({...request,providerId:'heygen'});assert.equal(approved.allowed,true);if(!approved.allowed)throw Error('repair budget denied');
  assert.equal((await ports.execute({...request,speechAudio:audio,reservationRef:approved.reservationRef})).status,'completed');
  assert.equal(ledger.status(f.scope)!.retainedCny,15);assert.equal(ledger.status(f.scope)!.entries.length,2);
  assert.equal(ledger.status(f.scope)!.entries.find(entry=>entry.operationId===budget.operation.operationId)!.status,'completed');
  presenterPlan.operations[0]!.quote.validUntil='2000-01-01';
  assert.equal((await createSceneReworkPresenterBridge(options).recoverExisting!({...request,speechAudio:audio}))?.status,'completed','expired quote cannot prevent already accepted GET recovery');
  assert.deepEqual({posts,gets,uploads},{posts:1,gets:2,uploads:2});
  assert.equal(JSON.parse(await readFile(f.actual.cache.measuredVoiceProof.prepared.sourceReceiptRefs[0],'utf8')).scope.runId,'original');
 }finally{global.fetch=originalFetch;if(oldKey===undefined)delete process.env.HEYGEN_API_KEY;else process.env.HEYGEN_API_KEY=oldKey;if(oldPermit===undefined)delete process.env.SOCIAL_CONTENT_PAID_PERMIT_DIR;else process.env.SOCIAL_CONTENT_PAID_PERMIT_DIR=oldPermit;await f.clean();}
});

test('multiple presenter repairs keep fixed slot order and atomically share one film budget and overage choice',async()=>{
 const f=await fixture();try{
  const proof=f.actual.cache.measuredVoiceProof,prepared=proof.prepared;
  const state=JSON.parse(await readFile(prepared.receiptRef,'utf8'));
  const originals=[{shotId:'s1',spokenText:'Hello.',startSeconds:0,endSeconds:.5,durationSeconds:.5},{shotId:'s2',spokenText:'Goodbye.',startSeconds:.5,endSeconds:1,durationSeconds:.5}];
  const cues=[{start:0,end:1,text:'Hello.'},{start:1,end:2,text:'Goodbye.'}];
  const timeline=mapMeasuredSceneTimeline({scenes:originals,cues,durationSeconds:2});
  prepared.voice.cues=cues;prepared.measuredSceneTimeline=timeline;state.voice=prepared.voice;state.scenes=originals;state.measuredTimeline=timeline;
  proof.scenes=originals.map(row=>({sceneId:row.shotId,duration:{startSeconds:row.startSeconds,endSeconds:row.endSeconds}}));
  await writeFile(prepared.receiptRef,JSON.stringify(state));
  await writeFile(prepared.alignmentReceiptRef,JSON.stringify({state:'completed',scope:{audioSha256:prepared.wholeTrackSha256},result:{transcripts:[{text:'Hello. Goodbye.',sentences:[{text:'Hello.',begin_time:0,end_time:1000},{text:'Goodbye.',begin_time:1000,end_time:2000}]}]}}));
  f.actual.plan.shots.push({...structuredClone(f.actual.plan.shots[0]),shotId:'s2'});
  f.actual.baseline.scenes.push({sceneId:'s2',voiceover:'Goodbye.'});
  const {recordHash,...body}=f.actual.cache;
  f.actual.cache=sealSocialSceneMediaCache({...body,planHash:paidProductionHash(f.actual.plan),
   scenes:[body.scenes[0],{...body.scenes[0],sceneId:'s2'}],renderInput:{...body.renderInput,manifest:{timeline:timeline.map(row=>({sceneId:row.shotId,targetStart:row.start,targetEnd:row.end}))}}});
  f.actual.intent=createSocialSceneReworkIntent(f.actual.cache,'actor',['s1','s2'],'repair','user_selected');
  const plan=await prepareSceneReworkPresenterPlan({...f,readTariff:async(intent:any)=>({...await f.readTariff(intent),meters:{providerSeconds:{priceCny:1,unitsPerPrice:1,minimumUnits:0,increment:.001}}})});
  assert.deepEqual(plan.operations.map(row=>[row.requirement.shotId,row.requirement.durationSeconds]),[['s1',1],['s2',1]]);
  for(const shotId of ['s1','s2']){const clip=await readSceneReworkPresenterAudio({...f,shotId,assertCurrent:async()=>{}});assert.equal(clip.durationSeconds,1);}
  f.repository.dataStore.list=async(collection:string)=>collection==='starter_social_content_tasks'?{items:[{tenant_id:'t',task_id:'task',brief:{}}],totalItems:1}:{items:[],totalItems:0};f.repository.list=(collection:string)=>f.repository.dataStore.list(collection);
  const ledgerRoot=path.join(f.root,'budget'),ledger=new SocialContentTaskBudget(ledgerRoot,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:15,productionDurationSeconds:2,authorizationRef:'original'}),quote:async()=>({upperBoundCny:14,quoteRef:'original',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
  await ledger.reserveBatch(f.scope,[{operationId:'original',fingerprint:'b'.repeat(64),provider:'heygen',model:'avatar_iv',accountRef:'account',stage:'tts',shotId:null}]);await ledger.markOutcome(f.scope,'original','completed','original');
  const policy:any={scope:{tenantId:'t',taskId:'task',runId:'repair',operationId:f.actual.intent.operationId,actorUserId:'actor'},quote:{provider:'heygen',model:'avatar_iv',presenterPlan:plan,totalUpperBoundCny:2,planHash:plan.scope.planHash,recordHash:'e'.repeat(64),tariffSourceRef:'contract',validUntil:plan.validUntil},recordHash:'f'.repeat(64)};
  const input={repository:f.repository,policy,ledgerRoot,assertCurrent:async()=>{},voiceDriven:true};
  await assert.rejects(reserveSceneReworkFilmBudget(input),/production_budget_decision_required/);assert.equal(ledger.status(f.scope)!.entries.length,1);
  const choice={...input,sourceRunId:'original',actorUserId:'actor'},preview=await sceneReworkOverageDecision(choice);assert.equal(preview!.plannedCny,2);assert.equal(preview!.extraCny,1);
  await sceneReworkOverageDecision({...choice,previewHash:preview!.previewHash});
  const funded=await reserveSceneReworkFilmBudget(input);assert.equal(funded.operations.length,2);assert.equal(ledger.status(f.scope)!.entries.length,3);assert.equal(ledger.status(f.scope)!.retainedCny,16);
 }finally{await f.clean();}
});


test('partial batch acceptance survives missing job receipts but changed identities never authorize recovery',async()=>{
 const {hasSceneReworkPresenterAcceptedReceipt}=await import('./socialContentSceneReworkPresenter.js');
 const f=await fixture(),cwd=process.cwd();try{
  process.chdir(f.root);
  const plan=await prepareSceneReworkPresenterPlan(f),first=plan.operations[0]!;
  plan.operations.push({...structuredClone(first),intent:{...first.intent,operationId:'paid-plan:second'},requirement:{...first.requirement,shotId:'s2'}});
  const directory=path.join(f.root,'data/social-content-whole-heygen',sha(plan.scope.tenantId),sha(plan.scope.taskId),sha(plan.scope.runId));
  await mkdir(directory,{recursive:true});
  const file=path.join(directory,sha(first.intent.operationId)+'.accepted.json');
  const receipt={scope:plan.scope,operationId:first.intent.operationId,inputContractHash:first.intent.inputContractHash,providerTaskId:'actual-first-video',audio:{operationRole:'production_scene',shotId:'s1'},approvedFirstFrame:{approvalRecordHash:first.approvedFirstFrame.approvalRecordHash}};
  assert.equal(await hasSceneReworkPresenterAcceptedReceipt(plan),false);
  await writeFile(file,JSON.stringify(receipt));assert.equal(await hasSceneReworkPresenterAcceptedReceipt(plan),true,'second unsubmitted operation does not hide genuine first acceptance');
  await writeFile(file,JSON.stringify({...receipt,scope:{...plan.scope,runId:'foreign'}}));assert.equal(await hasSceneReworkPresenterAcceptedReceipt(plan),false);
 }finally{process.chdir(cwd);await f.clean();}
});
