import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Starter198Repository} from './repository.js';
import type {StoredSocialSceneCache} from './socialContentSceneReworkService.js';
import type {SocialSceneReworkIntent} from './socialContentSceneRework.js';
import type {ApprovedPresenterFirstFrame} from './socialContentDigitalPresenterAdapter.js';
import {verifyStoredSceneReworkMeasuredVoice} from './socialContentSceneReworkMeasuredVoice.js';
import {readPreparedWholeVoiceScene} from './socialContentPreparedWholeVoice.js';
import {readTrustedHeyGenRuntimeBinding,heyGenRuntimeRouteEvidence,type TrustedHeyGenRuntimeBinding} from './socialContentHeyGenRuntimeBinding.js';
import {readHeyGenPublishedTariff} from '../lib/heygenPublishedPricing.js';
import {quoteSocialPaidOperationTariff,type SocialPaidOperationIntent,type SocialVerifiedAccountTariff} from '../lib/socialContentTaskBudgetAuthority.js';
import {paidProductionHash,type PaidStageRequirement,type BoundPaidRoute} from './socialContentPaidOperationPlan.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';

export interface SceneReworkPresenterOperation {
 requirement:PaidStageRequirement;route:BoundPaidRoute;intent:SocialPaidOperationIntent;
 binding:TrustedHeyGenRuntimeBinding;approvedFirstFrame:ApprovedPresenterFirstFrame;
 tariff:SocialVerifiedAccountTariff;quote:ReturnType<typeof quoteSocialPaidOperationTariff>;
}
const tariffCache=new Map<string,SocialVerifiedAccountTariff>();
const bindingCache=new Map<string,TrustedHeyGenRuntimeBinding>();
export interface SceneReworkPresenterPlan {
 scope:SocialTaskBudgetScope;sourceVoiceScope:SocialTaskBudgetScope;operations:SceneReworkPresenterOperation[];
 totalUpperBoundCny:number;validUntil:string;recordHash:string;
}
/** Existing canonical whole-track provider plan, with the original paid audio
 * identity retained separately from this repair's paid video operation. */
export async function prepareSceneReworkPresenterPlan(input:{repository:Starter198Repository;
 actual:StoredSocialSceneCache & {intent:SocialSceneReworkIntent};env?:NodeJS.ProcessEnv;
 readBinding?:typeof readTrustedHeyGenRuntimeBinding;
 readTariff?:(intent:SocialPaidOperationIntent,binding:TrustedHeyGenRuntimeBinding)=>Promise<SocialVerifiedAccountTariff|null>;
 frozen?:SceneReworkPresenterPlan;knownRecovery?:boolean;
}) {
 const {actual,repository}=input,{cache,intent,plan,baseline}=actual,store=repository.dataStore;
 if(!store)throw Error('scene_rework_persistent_store_required');
 const timing=await verifyStoredSceneReworkMeasuredVoice(repository,cache),proof=cache.measuredVoiceProof!;
 const scope={tenantId:intent.tenantId,taskId:intent.taskId,runId:intent.executionRunId,planHash:intent.planHash};
 if(scope.tenantId!==cache.tenantId||scope.taskId!==cache.taskId||intent.cacheHash!==cache.recordHash)
  throw Error('scene_rework_presenter_scope_changed');
 const selected=plan.shots.filter(shot=>intent.affectedSceneIds.includes(shot.shotId)&&shot.sourceStrategy==='authorized_digital_presenter');
 if(!selected.length)throw Error('scene_rework_presenter_selection_missing');
 const operations:SceneReworkPresenterOperation[]=[];
 for(const shot of selected){
  const presenterIds=shot.digitalHumanPlan?.presenterAssetIds??[];
  const frame=(shot as typeof shot & {approvedFirstFrame?:ApprovedPresenterFirstFrame}).approvedFirstFrame;
  if(presenterIds.length!==1||!frame||!/^[a-f0-9]{64}$/.test(frame.sha256)||!frame.approvalRecordHash||!frame.presenterGroupContractHash)
   throw Error('scene_rework_presenter_first_frame_or_identity_missing');
  if(createHash('sha256').update(await readFile(frame.localPath)).digest('hex')!==frame.sha256)
   throw Error('scene_rework_presenter_first_frame_bytes_changed');
  const recovered=input.knownRecovery?input.frozen?.operations.find(row=>row.requirement.shotId===shot.shotId):undefined;
  const binding=recovered?.binding??await (input.readBinding??readTrustedHeyGenRuntimeBinding)({tenantId:scope.tenantId,presenterAssetId:presenterIds[0]!},
   {store,env:()=>input.env??process.env});
  if(!binding||binding.tenantId!==scope.tenantId||binding.presenterAssetId!==presenterIds[0]
   ||proof.prepared.nativeVoice.provider!=='heygen'||binding.voiceId!==proof.prepared.nativeVoice.physicalVoiceId)
   throw Error('scene_rework_presenter_bound_voice_changed');
  const scene=baseline.scenes.find(scene=>scene.sceneId===shot.shotId),time=timing.timeline.find(time=>time.shotId===shot.shotId);
  if(!scene||!time)throw Error('scene_rework_presenter_measured_slot_missing');
  const requirement:PaidStageRequirement={key:`scene:${shot.shotId}:authorized_digital_presenter:presenter`,stage:'presenter_video',
   shotId:shot.shotId,sourceRef:binding.presenterAssetId,durationSeconds:time.end-time.start,text:scene.voiceover||scene.narration||'',frameCount:null,
   inputContractHash:paidProductionHash({operationId:intent.operationId,cacheHash:cache.recordHash,shot,time,
    wholeTrackSha256:timing.wholeTrackSha256,preparedReceiptSha256:timing.preparedReceiptSha256,approvalRecordHash:frame.approvalRecordHash})};
  const route:BoundPaidRoute={provider:'heygen',model:'avatar_iv',accountRef:binding.accountRef,routeEvidenceRef:heyGenRuntimeRouteEvidence(binding),
   usageBoundRef:`original-measured-slot:${timing.preparedReceiptSha256}:${shot.shotId}`,maximumAttempts:1,maximumUnits:{providerSeconds:requirement.durationSeconds!}};
  const operation:SocialPaidOperationIntent={operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0}),
   provider:route.provider,model:route.model,accountRef:route.accountRef,stage:requirement.stage,shotId:shot.shotId,
   inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};
  const prior=input.frozen?.operations.find(row=>row.intent.operationId===operation.operationId);
  const tariffKey=paidProductionHash({intent:operation,binding:heyGenRuntimeRouteEvidence(binding)});
  let tariff=prior?.tariff??tariffCache.get(tariffKey);
  if(tariff&&Date.parse(tariff.validUntil)<=Date.now()&&!input.knownRecovery){tariff=undefined;bindingCache.delete(tariffKey);}
  tariff??=await (input.readTariff??((operation,binding)=>readHeyGenPublishedTariff(operation,{readBinding:async()=>binding})))(operation,binding)??undefined;
  const quote=input.knownRecovery&&prior?prior.quote:quoteSocialPaidOperationTariff(operation,tariff??null);
  if(!tariff)throw Error('scene_rework_presenter_tariff_missing');
  tariffCache.set(tariffKey,tariff);
  if(prior&&(paidProductionHash(prior.requirement)!==paidProductionHash(requirement)||paidProductionHash(prior.route)!==paidProductionHash(route)
   ||heyGenRuntimeRouteEvidence(prior.binding)!==heyGenRuntimeRouteEvidence(binding)))throw Error('scene_rework_presenter_frozen_route_changed');
  const frozenBinding=prior?.binding??bindingCache.get(tariffKey)??binding;bindingCache.set(tariffKey,frozenBinding);
  operations.push({requirement,route,intent:operation,binding:frozenBinding,approvedFirstFrame:frame,tariff,quote});
 }
 const body={scope,sourceVoiceScope:proof.scope,operations,totalUpperBoundCny:operations.reduce((sum,row)=>sum+Math.round(row.quote.upperBoundCny*1e6),0)/1e6,
  validUntil:operations.map(row=>row.quote.validUntil).sort()[0]!};
 return {...body,recordHash:paidProductionHash(body)} satisfies SceneReworkPresenterPlan;
}

/** No TTS, alignment or upload: cut the original verified track at its measured
 * slot and retain the original paid scope across every repair generation. */
export async function readSceneReworkPresenterAudio(input:{repository:Starter198Repository;
 actual:StoredSocialSceneCache & {intent:SocialSceneReworkIntent};shotId:string;assertCurrent:()=>Promise<void>}){
 await input.assertCurrent();
 const timing=await verifyStoredSceneReworkMeasuredVoice(input.repository,input.actual.cache),proof=input.actual.cache.measuredVoiceProof!;
 const shot=input.actual.plan.shots.find(shot=>shot.shotId===input.shotId),scene=input.actual.baseline.scenes.find(scene=>scene.sceneId===input.shotId);
 if(!input.actual.intent.affectedSceneIds.includes(input.shotId)||shot?.sourceStrategy!=='authorized_digital_presenter'||!scene)
  throw Error('scene_rework_presenter_audio_selection_changed');
 const clip=await readPreparedWholeVoiceScene({prepared:proof.prepared,scope:proof.scope,shotId:input.shotId,
  spokenText:scene.voiceover||scene.narration||'',assertCurrent:input.assertCurrent});
 const time=timing.timeline.find(time=>time.shotId===input.shotId);
 if(!time||clip.range.start!==time.start||clip.range.end!==time.end)throw Error('scene_rework_presenter_audio_timeline_changed');
 return clip;
}

/** An immutable native bridge acceptance can survive a later job/ledger write
 * crash. It permits original-task recovery, never a new supplier submission. */
export async function hasSceneReworkPresenterAcceptedReceipt(plan:SceneReworkPresenterPlan){
 if(!plan.operations.length)return false;let found=false;
 for(const row of plan.operations){
 const root=path.resolve('data/social-content-whole-heygen',...['tenantId','taskId','runId'].map(key=>createHash('sha256').update(String(plan.scope[key as keyof typeof plan.scope])).digest('hex')));
 try{
  const receipt=JSON.parse(await readFile(path.join(root,createHash('sha256').update(row.intent.operationId).digest('hex')+'.accepted.json'),'utf8'));
  const verified=receipt.operationId===row.intent.operationId&&receipt.inputContractHash===row.intent.inputContractHash
   &&paidProductionHash(receipt.scope)===paidProductionHash(plan.scope)&&typeof receipt.providerTaskId==='string'&&Boolean(receipt.providerTaskId)
   &&receipt.audio?.operationRole==='production_scene'&&receipt.audio.shotId===row.requirement.shotId
   &&receipt.approvedFirstFrame?.approvalRecordHash===row.approvedFirstFrame.approvalRecordHash;
  if(!verified)return false;found=true;
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return false;}
 }return found;
}
