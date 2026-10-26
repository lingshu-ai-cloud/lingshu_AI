import { resolveCatalogPresenterVoice } from '../lib/presenterVoiceResolution.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import {validateHeyGenPresenterRecord} from '../lib/presenterAssetTrust.js';
import {createPresenterFirstFrameApproval,listPresenterFirstFrameApprovalsForReview,type PresenterFirstFrameApprovalContract} from './socialContentPresenterFirstFrameApproval.js';
import type {SocialContentAutoProductionRuntime} from './socialContentProductionExecution.js';

type Input=Parameters<NonNullable<SocialContentAutoProductionRuntime['preparePresenterMotherFirstFrames']>>[0];
type Presenter=Record<string,unknown>;
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
/** A provider-owned catalogue portrait is sent only back to HeyGen. It is not
 * an Ark face replacement or a reproduction of the reference composition.
 * The source check below attests bytes/catalogue identity, never visual/lip QA. */
export async function prepareNativeHeyGenCatalogueFrames(store:DataStore,input:Pick<Input,'scope'|'groups'>,options:{mediaRoot:string;presenters:Presenter[];load:(presenter:Presenter)=>Promise<{bytes:Buffer;mimeType:string;sha256:string}>}):Promise<PresenterFirstFrameApprovalContract[]|null>{
 const selected=await Promise.all(input.groups.map(async group=>{
  const matches=options.presenters.filter(p=>p.id===group.presenterAssetId);
  if(matches.length!==1)return null;
  const presenter=matches[0]!,checked=validateHeyGenPresenterRecord(presenter);
  if(!checked.ok||!checked.rights.authorizationRef.startsWith('license://heygen/public-catalog/')||group.executionKind==='seedance_motion')return null;
  const resolved=await resolveCatalogPresenterVoice(presenter); const resolvedCheck=validateHeyGenPresenterRecord(resolved);
  if(!resolvedCheck.ok)return null;return {group,presenter:resolved,checked:resolvedCheck};
 }));
 if(selected.some(p=>!p))return null;
 const rows=await store.list<Record<string,unknown>>('starter_social_content_tasks',{where:{tenant_id:input.scope.tenantId,task_id:input.scope.taskId},perPage:2});
 if(rows.totalItems!==1||rows.items.length!==1)return null;
 const row=rows.items[0]!,brief=typeof row.brief==='string'?JSON.parse(row.brief):row.brief as Record<string,unknown>;
 if(brief?.presenterSpeechReviewPolicy!=='heygen_native_human_review')return null;
 if(row.run_id!==input.scope.runId)throw Error('heygen_native_frame_run_changed');
 const existing=await listPresenterFirstFrameApprovalsForReview(store,{tenantId:input.scope.tenantId,taskId:input.scope.taskId,runId:input.scope.runId});
 const approvals:PresenterFirstFrameApprovalContract[]=[];
 for(const item of selected){
  const {group,presenter,checked}=item!;
  if(!checked.ok)throw Error('heygen_native_frame_identity_changed');
  const prior=existing.find(a=>a.groupId===group.groupId);
  if(prior){if(prior.sourceMode!=='heygen_catalog_native'||prior.planHash!==input.scope.planHash||prior.presenterGroupContractHash!==group.presenterGroupContractHash||prior.presenter.assetId!==group.presenterAssetId||prior.presenter.assetVersion!==checked.assetVersion||prior.presenter.providerPresenterId!==checked.avatarId||prior.presenter.providerVoiceId!==checked.voiceId)throw Error('heygen_native_frame_existing_contract_changed');approvals.push(prior);continue;}
  const source=await options.load(presenter);
  if(hash(source.bytes)!==source.sha256)throw Error('heygen_native_frame_source_hash_changed');
  const report={schema:'heygen-catalogue-source-check.v1',avatarId:checked.avatarId,voiceId:checked.voiceId,presenterAssetId:group.presenterAssetId,assetVersion:checked.assetVersion,sourceSha256:source.sha256,referenceCompositionReproduced:false,independentVisualQaPassed:false,lipSyncStatus:'pending_human_review'};
  const reportHash=hash(JSON.stringify(report)),extension=source.mimeType==='image/png'?'png':source.mimeType==='image/webp'?'webp':'jpg';
  const relative=path.join('tenants',input.scope.tenantId,'heygen-native-reference',source.sha256+'.'+extension),file=path.resolve(options.mediaRoot,relative);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,source.bytes,{mode:0o600});await fs.writeFile(file+'.source-check.json',JSON.stringify(report,null,2),{mode:0o600});
  approvals.push(await createPresenterFirstFrameApproval(store,{...input.scope,groupId:group.groupId,presenterGroupContractHash:group.presenterGroupContractHash,sourceMode:'heygen_catalog_native',
   referenceCompositionHashes:group.compositions.map(c=>hash(JSON.stringify(c))),backgroundPlateSha256:source.sha256,
   personRemovalEvidence:{receiptRef:'not_applicable:heygen_catalog_native:'+reportHash,sourceSha256:source.sha256,outputSha256:source.sha256},
   presenter:{assetId:group.presenterAssetId,assetVersion:checked.assetVersion,authorizationRef:checked.rights.authorizationRef,consentRef:checked.rights.consentRef,providerId:'heygen',identityMode:'provider_avatar',providerPresenterId:checked.avatarId,providerVoiceId:checked.voiceId},
   compositeFirstFrameSha256:source.sha256,compositeFirstFrameUrl:'/media/'+relative.split(path.sep).join('/'),
   qa:{scope:'provider_catalog_source_only',passed:true,receiptRef:'local_catalogue_source:'+reportHash,reportHash},createdAt:new Date().toISOString()}));
 }
 return approvals;
}

export async function verifyNativeHeyGenCatalogueApprovalCurrent(store:DataStore,scope:Input['scope'],approval:PresenterFirstFrameApprovalContract,mediaRoot=path.resolve(process.env.SOCIAL_CONTENT_MEDIA_ROOT||'data/media')){
 if(approval.sourceMode!=='heygen_catalog_native'||approval.qa.scope!=='provider_catalog_source_only'||approval.tenantId!==scope.tenantId||approval.taskId!==scope.taskId||approval.runId!==scope.runId||approval.planHash!==scope.planHash)return false;
 const tasks=await store.list<Record<string,unknown>>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,task_id:scope.taskId},perPage:2}),row=tasks.items[0];
 if(tasks.totalItems!==1||!row||row.run_id!==scope.runId)return false;
 const brief=typeof row.brief==='string'?JSON.parse(row.brief):row.brief as Record<string,unknown>;
 if(brief?.presenterSpeechReviewPolicy!=='heygen_native_human_review')return false;
 const defaults=await store.list<{payload?:{presenters?:Presenter[]}}>('studio_production_defaults',{where:{tenant_id:scope.tenantId},perPage:2});
 if(defaults.totalItems!==1||defaults.items.length!==1)return false;
 const matches=defaults.items[0]!.payload?.presenters?.filter(p=>p.id===approval.presenter.assetId)||[];
 if(matches.length!==1)return false;const checked=validateHeyGenPresenterRecord(await resolveCatalogPresenterVoice(matches[0]!));
 if(!checked.ok||!checked.rights.authorizationRef.startsWith('license://heygen/public-catalog/')||checked.avatarId!==approval.presenter.providerPresenterId||checked.voiceId!==approval.presenter.providerVoiceId||checked.assetVersion!==approval.presenter.assetVersion||checked.rights.authorizationRef!==approval.presenter.authorizationRef||checked.rights.consentRef!==approval.presenter.consentRef)return false;
 const prefix='/media/tenants/'+scope.tenantId+'/heygen-native-reference/';
 if(!approval.compositeFirstFrameUrl.startsWith(prefix))return false;
 const file=path.resolve(mediaRoot,approval.compositeFirstFrameUrl.slice(7)),root=path.resolve(mediaRoot,'tenants',scope.tenantId,'heygen-native-reference');
 if(!file.startsWith(root+path.sep))return false;
 const bytes=await fs.readFile(file);return hash(bytes)===approval.compositeFirstFrameSha256;
}

/** Recover a missing *free source* check after an interrupted funded run.
 * This never consumes static supplier permits or generates a replacement. */
export async function recoverNativeHeyGenCatalogueFrame(store:DataStore,scope:Input['scope'],group:{groupId:string;contractHash:string;presenterAssetId:string;durationSeconds:number;shotIds:string[];executionKind?:'seedance_motion'},options:{mediaRoot:string;load:(presenter:Presenter)=>Promise<{bytes:Buffer;mimeType:string;sha256:string}>}){
 const defaults=await store.list<{payload?:{presenters?:Presenter[]}}>('studio_production_defaults',{where:{tenant_id:scope.tenantId},perPage:2});
 if(defaults.totalItems!==1||defaults.items.length!==1)return null;
 const presenters=defaults.items[0]!.payload?.presenters||[];
 return prepareNativeHeyGenCatalogueFrames(store,{scope,groups:[{groupId:group.groupId,presenterGroupContractHash:group.contractHash,presenterAssetId:group.presenterAssetId,executionKind:group.executionKind,
  compositions:[{referenceSourceId:'heygen-catalogue',referenceShotId:group.shotIds[0]||group.groupId,startSeconds:0,endSeconds:group.durationSeconds,referenceFirstFrameUrl:String(presenters.find(p=>p.id===group.presenterAssetId)?.imageUrl||''),background:'HeyGen 人物原场景',framing:'供应商原构图',camera:'原生口播',composition:'人物目录原图；不声明参考构图复现'}]}]}, {...options,presenters});
}
