import {objectStorageEnabled,objectStorageUpload,objectStorageHead} from '../storage/objectStorage.js';
import type {DataStore} from '../storage/datastore.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {HeyGenClient} from '../lib/heygen.js';
import {withPaidOperationLock} from '../lib/paidOperationLock.js';
import {createSocialHeyGenBridgePorts,defaultDownload,type SocialHeyGenBridgeDependencies} from './socialContentHeyGenBridge.js';
import {readPreparedWholeVoiceScene,type PreparedWholeVoice} from './socialContentPreparedWholeVoice.js';
import {paidProductionHash,presenterGroupContractHash,type BoundPaidRoute,type PaidStageRequirement} from './socialContentPaidOperationPlan.js';
import {productionBillingAccountRef} from './socialContentProductionBudgetRoutes.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import type {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import type {DigitalPresenterExecutionRequest} from './socialContentDigitalPresenterAdapter.js';
import type {WholeTrackPresenterSpeech} from './socialContentWholeTrackPresenterAudio.js';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export interface WholeTrackHeyGenFunding {
 scope:SocialTaskBudgetScope;requirements:PaidStageRequirement[];routeBindings:Record<string,BoundPaidRoute>;
 intents:SocialPaidOperationIntent[];permit:ReturnType<typeof createSocialContentPaidOperationPermit>;
 readReservedCny(operationId:string):number;assertCurrent():Promise<void>;
 assertLivePresenter(route:BoundPaidRoute,input:DigitalPresenterExecutionRequest,credentialSha256:string):Promise<void>;
}
/** Normal existing-stack factory. Audio is the already-paid full-track slice;
 * every video POST consumes its canonical whole-film operation exactly once. */
export function createWholeTrackSocialHeyGenBridge(input:{
 funding:WholeTrackHeyGenFunding;prepared:PreparedWholeVoice;taskVersion:string;apiKey:string;
 store:DataStore;dependencies?:Omit<SocialHeyGenBridgeDependencies,'client'|'speechAudio'|'wholeBudget'|'budget'>;
 transport?:typeof fetch;root?:string;
}) {
 const dependencies=input.dependencies||{store:input.store,storageReady:objectStorageEnabled,download:defaultDownload,upload:objectStorageUpload,head:objectStorageHead};
 const funding=input.funding,keyHash=sha(input.apiKey);
 if(!input.apiKey||!dependencies.storageReady())throw Error('whole_track_heygen_configuration_missing');
 const root=path.join(input.root||path.resolve('data/social-content-whole-heygen'),sha(funding.scope.tenantId),sha(funding.scope.taskId),sha(funding.scope.runId));
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const writes=(file:string,value:unknown,exclusive=false)=>{
  if(exclusive&&fs.existsSync(file)){if(paidProductionHash(JSON.parse(fs.readFileSync(file,'utf8')))!==paidProductionHash(value))throw Error('whole_track_heygen_original_receipt_conflict');return;}
  const temporary=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(exclusive){try{fs.linkSync(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||paidProductionHash(JSON.parse(fs.readFileSync(file,'utf8')))!==paidProductionHash(value))throw Error('whole_track_heygen_original_receipt_conflict');}finally{fs.unlinkSync(temporary);}}
  else fs.renameSync(temporary,file);
  const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 };
 const canonical=(request:Pick<DigitalPresenterExecutionRequest,'tenantId'|'taskId'|'shotId'>)=>{
  if(request.tenantId!==funding.scope.tenantId||request.taskId!==funding.scope.taskId)throw Error('whole_track_heygen_scope_changed');
  const grouped=funding.requirements.filter(r=>r.presenterGroupId===request.shotId);
  if(grouped.length>1)throw Error('whole_track_heygen_group_ambiguous');
  const group=grouped[0];
  if(group){
   if(group.key!==`presenter-group:${request.shotId}:presenter`||group.shotId!==null||!group.presenterGroupShotIds?.length
    ||new Set(group.presenterGroupShotIds).size!==group.presenterGroupShotIds.length||!group.presenterAssetId
    ||!group.presenterGroupContractHash||group.presenterGroupContractHash!==presenterGroupContractHash({groupId:group.presenterGroupId!,shotIds:group.presenterGroupShotIds,durationSeconds:Number(group.durationSeconds),spokenText:String(group.text),presenterAssetId:group.presenterAssetId}))
    throw Error('whole_track_heygen_group_contract_changed');
  }
  const key=group?.key||`scene:${request.shotId}:authorized_digital_presenter:presenter`;
  const requirements=funding.requirements.filter(r=>r.key===key),requirement=requirements[0],route=funding.routeBindings[key];
  const operationId='paid-plan:'+paidProductionHash({scope:funding.scope,key,attempt:0});
  const intents=funding.intents.filter(i=>i.operationId===operationId),intent=intents[0];
  if(requirements.length!==1||!requirement||!route||intents.length!==1||!intent||intent.stage!=='presenter_video'||intent.inputContractHash!==paidProductionHash({requirement,route,attempt:0})||intent.provider!=='heygen'||intent.provider!==route.provider||intent.model!==route.model||intent.accountRef!==route.accountRef||paidProductionHash(intent.maximumUnits)!==paidProductionHash(route.maximumUnits))throw Error('whole_track_heygen_canonical_operation_changed');
  if(route.accountRef!==productionBillingAccountRef('heygen','https://api.heygen.com/v3/videos',keyHash))throw Error('whole_track_heygen_live_account_changed');
  return {requirement,route,intent};
 };
 const audioRequests=new Map<string,{request:DigitalPresenterExecutionRequest;audio:WholeTrackPresenterSpeech}>();
 const requestIds=new Map<string,{request:DigitalPresenterExecutionRequest;audio:WholeTrackPresenterSpeech}>();
 const requestBodies=new Map<string,Record<string,unknown>>();
 const providerCompletions=new Map<string,Record<string,unknown>>();
 const providerClient=new HeyGenClient(input.apiKey,input.transport||fetch,{
  async beforeSubmit(body,requestId){
   const bound=audioRequests.get(String(body.audio_asset_id||''));
   if(!bound||!requestIds.has(requestId)||paidProductionHash(requestIds.get(requestId)?.audio)!==paidProductionHash(bound.audio))throw Error('whole_track_heygen_audio_request_unbound');
   const {request,audio}=bound,{intent,route}=canonical(request);
   await funding.assertCurrent();await funding.assertLivePresenter(route,request,keyHash);
   if(body.type!=='avatar'||body.avatar_id!==request.presenter.providerPresenterId||(body.engine as any)?.type!=='avatar_iv'||body.aspect_ratio!=='9:16'||body.resolution!=='720p'||body.output_format!=='mp4'||'script' in body||'voice_id' in body)throw Error('whole_track_heygen_actual_request_changed');
   const actualUnits:Record<string,number>={};
   for(const meter of Object.keys(intent.maximumUnits)){
    if(meter==='providerSeconds'||meter==='audioSeconds')actualUnits[meter]=audio.durationSeconds;
    else if(meter==='requests')actualUnits[meter]=1;
    else throw Error('whole_track_heygen_usage_dimension_unverified:'+meter);
   }
   const {maximumUnits:_,...binding}=intent;
   await funding.permit.beforeSubmit({...binding,actualUnits});
   requestBodies.set(requestId,structuredClone(body));
   writes(path.join(root,sha(intent.operationId)+'.prepared.json'),{scope:funding.scope,operationId:intent.operationId,inputContractHash:intent.inputContractHash,requestId,body,requestSha256:sha(JSON.stringify(body)),audio},true);
   await funding.assertCurrent();
  },
  async onStatus(providerTaskId,response){providerCompletions.set(providerTaskId,structuredClone(response));},
  async onAccepted(providerTaskId,requestId,response){
   const bound=requestIds.get(requestId);if(!bound)throw Error('whole_track_heygen_accepted_request_unbound');
   const {intent}=canonical(bound.request),body=requestBodies.get(requestId);
   if(!body)throw Error('whole_track_heygen_original_body_missing');
   const receiptRef=path.join(root,sha(intent.operationId)+'.accepted.json');
   writes(receiptRef,{scope:funding.scope,operationId:intent.operationId,inputContractHash:intent.inputContractHash,requestId,providerTaskId,body,requestSha256:sha(JSON.stringify(body)),audio:bound.audio,response:response||null,actualInvoiceCny:null,humanApproved:false},true);
   await funding.permit.markOutcome(intent.operationId,'accepted',receiptRef);
  },
 });
 const resolve=async(request:DigitalPresenterExecutionRequest):Promise<WholeTrackPresenterSpeech>=>{
  await funding.assertCurrent();const {requirement,route,intent}=canonical(request);await funding.assertLivePresenter(route,request,keyHash);
  if(requirement.presenterGroupId&&(request.shotId!==requirement.presenterGroupId||request.presenter.presenterAssetId!==requirement.presenterAssetId||request.script!==requirement.text))throw Error('whole_track_heygen_group_request_changed');
  const frozenDuration=Number(requirement.durationSeconds);
  if(!(frozenDuration>0))throw Error('whole_track_heygen_frozen_window_missing');
  // The reference clip timing describes the source video's edit. Paid scene
  // execution must use the final whole-film slot frozen by budget preflight.
  // Normalize the shared request before hashing, audio upload, and provider
  // submission so every downstream receipt records the same authority.
  request.visualControl.timing={
   startSeconds:0,
   endSeconds:frozenDuration,
   durationSeconds:frozenDuration,
   actionPeakSeconds:Math.min(frozenDuration,Math.max(0,frozenDuration*.58)),
  };
  const clip=await readPreparedWholeVoiceScene({prepared:input.prepared,scope:funding.scope,shotId:request.shotId,spokenText:request.script,
   ...(requirement.presenterGroupShotIds?{memberShotIds:requirement.presenterGroupShotIds}:{}),assertCurrent:funding.assertCurrent});
  if(Math.abs(clip.durationSeconds-frozenDuration)>.02)throw Error('whole_track_heygen_frozen_window_changed');
  const completedReceiptRef=path.join(root,sha(intent.operationId)+'.completed.json');
  if(fs.existsSync(completedReceiptRef)){
   const completed=JSON.parse(fs.readFileSync(completedReceiptRef,'utf8')),audio=completed.audio as WholeTrackPresenterSpeech;
   if(completed.operationId!==intent.operationId||completed.inputContractHash!==intent.inputContractHash
    ||paidProductionHash(completed.scope)!==paidProductionHash(funding.scope)||completed.providerTaskId!==completed.output?.providerTaskId
    ||audio?.tenantId!==request.tenantId||audio.taskId!==request.taskId||audio.runId!==funding.scope.runId||audio.planHash!==funding.scope.planHash
    ||audio.shotId!==request.shotId||audio.presenterAssetId!==request.presenter.presenterAssetId||audio.presenterAssetVersion!==request.presenter.assetVersion
    ||audio.providerAvatarId!==request.presenter.providerPresenterId||audio.scriptSha256!==sha(request.script)
    ||audio.clipSha256!==clip.clipSha256||audio.durationSeconds!==clip.durationSeconds||audio.frozenSceneDurationSeconds!==frozenDuration)
    throw Error('whole_track_heygen_completed_receipt_scope_changed');
   audioRequests.set(audio.audioAssetId,{request,audio});
   return audio;
  }
  const identity={scope:funding.scope,shotId:request.shotId,presenter:request.presenter,visualControl:request.visualControl,clipSha256:clip.clipSha256,sourceReceipts:clip.sourceReceipts,alignmentReceiptSha256:clip.alignmentReceiptSha256};
  const identityHash=paidProductionHash(identity),file=path.join(root,identityHash+'.upload.json');
  const audio=await withPaidOperationLock(path.join(root,'.locks'),identityHash,async()=>{
   let previous:any;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
   if(previous&&previous.identityHash!==identityHash)throw Error('whole_track_heygen_upload_scope_changed');
   if(previous&&!previous.audioAssetId)throw Error('whole_track_heygen_upload_unknown_no_repost');
   if(!previous){
    const rows=await input.store.list<any>('studio_social_presenter_jobs',{where:{tenant_id:request.tenantId,task_id:request.taskId,shot_id:request.shotId},perPage:200});
    if(rows.totalItems!==rows.items.length)throw Error('whole_track_heygen_recovery_rows_unbounded');
    const saved=rows.items.filter((row:any)=>row.visual_control?.speechAudio?.operationRole==='production_scene'&&row.visual_control.speechAudio.runId===funding.scope.runId&&row.visual_control.speechAudio.planHash===funding.scope.planHash);
    if(saved.length>1)throw Error('whole_track_heygen_recovery_ambiguous');
    if(saved[0])throw Error('whole_track_heygen_upload_proof_missing_no_repost');
    writes(file,{identityHash,status:'uploading'},true);
    await funding.assertCurrent();const audioAssetId=await providerClient.uploadAudio(clip.bytes,'whole-track:'+identityHash,'audio/wav');
    previous={identityHash,status:'uploaded',audioAssetId};writes(file,previous);
   }
   return {tenantId:request.tenantId,taskId:request.taskId,taskVersion:input.taskVersion,runId:funding.scope.runId,planHash:funding.scope.planHash,shotId:request.shotId,presenterAssetId:request.presenter.presenterAssetId,presenterAssetVersion:request.presenter.assetVersion,providerAvatarId:request.presenter.providerPresenterId,voiceId:clip.nativeVoice.physicalVoiceId,scriptSha256:sha(request.script),clipSha256:clip.clipSha256,durationSeconds:clip.durationSeconds,frozenSceneDurationSeconds:request.visualControl.timing.durationSeconds,wholeTrackSha256:clip.wholeTrackSha256,nativeVoice:clip.nativeVoice,sourceReceiptRef:clip.sourceReceipts[0]!.receiptRef,sourceReceiptSha256:clip.sourceReceipts[0]!.sha256,alignmentReceiptRef:clip.alignmentReceiptRef,alignmentReceiptSha256:clip.alignmentReceiptSha256,receiptRef:file,receiptHash:sha(fs.readFileSync(file)),audioAssetId:previous.audioAssetId,engine:'avatar_iv' as const,operationRole:'production_scene' as const};
  });
  audioRequests.set(audio.audioAssetId,{request,audio});return audio;
 };
 const ports=createSocialHeyGenBridgePorts({...dependencies,client:providerClient,
  budget:{status:()=>({allowed:false,reservationCny:null,reason:'whole-film-permit-only'}) as any,reserve:async()=>{throw Error('whole_track_must_not_reserve_legacy_budget');}},
  speechAudio:{resolve,async verify(request,audio){const actual=await resolve(request);return paidProductionHash(actual)===paidProductionHash(audio);}},
  wholeBudget:{maximumCostCny:Math.max(...funding.intents.filter(i=>i.stage==='presenter_video').map(i=>funding.readReservedCny(i.operationId)),0),
   async authorize(request){
    try{await funding.assertCurrent();const {intent}=canonical(request),bound=[...audioRequests.values()].find(item=>item.request.shotId===request.shotId);
     if(!bound)throw Error('whole_track_heygen_audio_not_resolved');
     const reservation=funding.readReservedCny(intent.operationId);
     if(!(reservation>0)||reservation>request.maximumCostCny)throw Error('whole_track_heygen_reservation_exceeds_plan');
     requestIds.set(request.idempotencyKey,bound);return {allowed:true,reservationRef:intent.operationId};
    }catch(error){return {allowed:false,reason:String(error instanceof Error?error.message:error)};}
   },
   async recover(request,record){
    const {intent}=canonical(request),proof=await funding.permit.assertRecovery(intent.operationId);
    const receipt=JSON.parse(fs.readFileSync(proof.receiptRef||path.join(root,sha(intent.operationId)+'.accepted.json'),'utf8'));
    const providerTaskId=String(record.provider_task_id||receipt.providerTaskId||'');
    if(!providerTaskId||receipt.operationId!==intent.operationId||receipt.inputContractHash!==intent.inputContractHash||paidProductionHash(receipt.scope)!==paidProductionHash(funding.scope)||receipt.providerTaskId!==providerTaskId||receipt.requestId!==request.idempotencyKey||paidProductionHash(receipt.audio)!==paidProductionHash(request.speechAudio))throw Error('whole_track_heygen_original_receipt_unverified');
    return providerTaskId;
   },
   async completed(request,output){
    const {intent}=canonical(request),accepted=path.join(root,sha(intent.operationId)+'.accepted.json');
    const original=JSON.parse(fs.readFileSync(accepted,'utf8'));
    if(original.providerTaskId!==output.providerTaskId||paidProductionHash(original.audio)!==paidProductionHash(request.speechAudio)||Math.abs(output.duration-original.audio.durationSeconds)>.12)throw Error('whole_track_heygen_completed_audio_binding_changed');
    const receiptRef=path.join(root,sha(intent.operationId)+'.completed.json');
    if(fs.existsSync(receiptRef)){
      const prior=JSON.parse(fs.readFileSync(receiptRef,'utf8'));
      // A refreshed signed supplier URL may change. Keep the first raw GET
      // receipt immutable, while revalidating the same output bytes and scope.
      if(prior.operationId!==intent.operationId||prior.inputContractHash!==intent.inputContractHash||paidProductionHash(prior.scope)!==paidProductionHash(funding.scope)||paidProductionHash(prior.audio)!==paidProductionHash(request.speechAudio)||paidProductionHash(prior.output)!==paidProductionHash(output)||prior.acceptedReceiptSha256!==sha(fs.readFileSync(accepted)))throw Error('whole_track_heygen_original_completed_output_changed');
    }else writes(receiptRef,{...original,output,providerCompletionReceipt:providerCompletions.get(output.providerTaskId)||null,acceptedReceiptRef:accepted,acceptedReceiptSha256:sha(fs.readFileSync(accepted)),actualInvoiceCny:null,humanApproved:false},true);
    await funding.permit.markOutcome(intent.operationId,'completed',receiptRef);
   },
  }});
 const completedAlready=(request:DigitalPresenterExecutionRequest)=>fs.existsSync(path.join(root,sha(canonical(request).intent.operationId)+'.completed.json'));
 return {...ports,
  // A canonical completed receipt proves that the paid POST finished. Recovery
  // performs GET/download verification only, so a lock orphaned by a killed
  // worker cannot permanently block this task or trigger another paid POST.
  execute:(request:Parameters<typeof ports.execute>[0])=>completedAlready(request)?ports.execute(request):withPaidOperationLock(path.join(root,'.provider-locks'),sha(canonical(request).intent.operationId),()=>ports.execute(request)),
  recoverExisting:(request:DigitalPresenterExecutionRequest)=>completedAlready(request)?ports.recoverExisting!(request):withPaidOperationLock(path.join(root,'.provider-locks'),sha(canonical(request).intent.operationId),()=>ports.recoverExisting!(request)),
 };
}
