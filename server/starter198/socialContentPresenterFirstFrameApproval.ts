import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import {isPresenterFirstFrameAssetProvenance,isOriginalScenePresenterAssetProvenance,type PresenterFirstFrameAssetProvenance,type OriginalScenePresenterAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';
import {isPresenterBackgroundFirstEvidence,isPresenterOriginalSceneFirstEvidence,type PresenterBackgroundFirstEvidence,type PresenterOriginalSceneFirstEvidence} from '../../shared/contracts/presenterBackgroundFirst.js';

const CONTRACTS='social_presenter_first_frame_approvals',DECISIONS='social_presenter_first_frame_decisions';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
const text=(value:unknown)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=1000;
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const iso=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const tenantMediaRef=(value:string,tenantId:string)=>{try{const url=new URL(value,'http://local.invalid');return url.origin==='http://local.invalid'&&!url.search&&!url.hash&&url.pathname.startsWith(`/media/tenants/${encodeURIComponent(tenantId)}/`)&&!decodeURIComponent(url.pathname).includes('..');}catch{return false;}};

export interface LegacyPresenterFirstFrameApprovalContract {
 schemaVersion:'social-presenter-first-frame-approval.v1'|'social-presenter-first-frame-approval.v2';tenantId:string;taskId:string;runId:string;planHash:string;groupId:string;presenterGroupContractHash:string;
 sourceMode?:'heygen_catalog_native';
 targetAspectRatio?:'9:16'|'16:9'|'1:1';
 referenceCompositionHashes:string[];backgroundPlateSha256:string;personRemovalEvidence:{receiptRef:string;sourceSha256:string;outputSha256:string};
 assetProvenance?:PresenterFirstFrameAssetProvenance;
 backgroundFirst?:PresenterBackgroundFirstEvidence;
 presenter:{assetId:string;assetVersion:number;authorizationRef:string;consentRef:string;providerId:string;identityMode?:'provider_avatar'|'enterprise_asset_first_frame';providerPresenterId:string|null;providerVoiceId:string|null};
 compositeFirstFrameSha256:string;compositeFirstFrameUrl:string;qa:{scope?:'provider_catalog_source_only';passed:boolean;receiptRef:string;reportHash:string};createdAt:string;recordHash:string;
}
export interface OriginalScenePresenterFirstFrameApprovalContract extends Omit<LegacyPresenterFirstFrameApprovalContract,'schemaVersion'|'sourceMode'|'personRemovalEvidence'|'assetProvenance'|'backgroundFirst'> {
 schemaVersion:'social-presenter-first-frame-approval.v3';sourceMode:'original_scene';
 personRemovalEvidence?:never;assetProvenance?:never;backgroundFirst?:never;
 originalScene:PresenterOriginalSceneFirstEvidence;
 originalSceneProvenance:OriginalScenePresenterAssetProvenance;
}
export type PresenterFirstFrameApprovalContract=LegacyPresenterFirstFrameApprovalContract|OriginalScenePresenterFirstFrameApprovalContract;
export interface PresenterFirstFrameDecisionReceipt {schemaVersion:'social-presenter-first-frame-decision.v1';decisionVersion:1;tenantId:string;taskId:string;runId:string;planHash:string;groupId:string;approvalRecordHash:string;actorId:string;idempotencyKey:string;decision:'confirmed';decidedAt:string;confirmedHash:string;recordHash:string;}
export const presenterFirstFrameApprovalHash=(input:Omit<PresenterFirstFrameApprovalContract,'recordHash'>|PresenterFirstFrameApprovalContract)=>{const {recordHash:_,...body}=input as PresenterFirstFrameApprovalContract;return hash(body);};
export const presenterFirstFrameDecisionHash=(input:Omit<PresenterFirstFrameDecisionReceipt,'recordHash'>|PresenterFirstFrameDecisionReceipt)=>{const {recordHash:_,...body}=input as PresenterFirstFrameDecisionReceipt;return hash(body);};
function validContract(value:PresenterFirstFrameApprovalContract){
 if(value.schemaVersion==='social-presenter-first-frame-approval.v3')return validOriginalContract(value);
 if('originalScene' in value||'originalSceneProvenance' in value)return false;
 let preview=false;try{const url=new URL(value.compositeFirstFrameUrl,'http://local.invalid'),tenantPrefix=`/media/tenants/${encodeURIComponent(value.tenantId)}/`;preview=!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname.startsWith(tenantPrefix)||/^\/api\/overseas\/starter-198\/social-content\//.test(url.pathname));}catch{}
 const assetOnly=value.presenter?.identityMode==='enterprise_asset_first_frame';
 const providerIdentity=assetOnly?value.presenter.providerId==='seedance'&&value.presenter.providerPresenterId===null&&value.presenter.providerVoiceId===null:text(value.presenter?.providerPresenterId)&&text(value.presenter?.providerVoiceId);
 if(value.sourceMode==='heygen_catalog_native'&&(value.presenter.providerId!=='heygen'||value.presenter.identityMode!=='provider_avatar'||value.qa.scope!=='provider_catalog_source_only'||!value.qa.receiptRef.startsWith('local_catalogue_source:')||!value.personRemovalEvidence.receiptRef.startsWith('not_applicable:heygen_catalog_native:')||value.assetProvenance))return false;
 if(value.targetAspectRatio!==undefined&&(!['9:16','16:9','1:1'].includes(value.targetAspectRatio)||value.sourceMode==='heygen_catalog_native'))return false;
 if(value.schemaVersion==='social-presenter-first-frame-approval.v2'){
  const evidence=value.backgroundFirst;
  if(!isPresenterBackgroundFirstEvidence(evidence)||value.sourceMode||!value.targetAspectRatio||value.targetAspectRatio!==evidence.aspectRatio||!value.assetProvenance
   ||evidence.background.sha256!==value.backgroundPlateSha256||evidence.sourceFirstFrameSha256!==value.assetProvenance.background.referenceFirstFrameSha256
   ||evidence.background.receiptRef!==value.personRemovalEvidence.receiptRef||evidence.sourceFirstFrameSha256!==value.personRemovalEvidence.sourceSha256||evidence.background.sha256!==value.personRemovalEvidence.outputSha256
   ||evidence.composite.sha256!==value.compositeFirstFrameSha256||evidence.composite.artifactRef!==value.compositeFirstFrameUrl||evidence.composite.presenterAssetId!==value.presenter.assetId||evidence.composite.presenterAssetVersion!==value.presenter.assetVersion
   ||!value.qa.passed||evidence.composite.qa.receiptRef!==value.qa.receiptRef||evidence.composite.qa.reportHash!==value.qa.reportHash
   ||!tenantMediaRef(evidence.background.artifactRef,value.tenantId)||!tenantMediaRef(evidence.composite.artifactRef,value.tenantId))return false;
 }else if(value.schemaVersion!=='social-presenter-first-frame-approval.v1'||value.backgroundFirst!==undefined)return false;
 return preview&&providerIdentity&&(!value.assetProvenance||isPresenterFirstFrameAssetProvenance(value.assetProvenance))&&[value.tenantId,value.taskId,value.runId,value.groupId,value.personRemovalEvidence?.receiptRef,value.presenter?.assetId,value.presenter?.authorizationRef,value.presenter?.consentRef,value.presenter?.providerId,value.qa?.receiptRef].every(text)&&[value.planHash,value.presenterGroupContractHash,value.backgroundPlateSha256,value.personRemovalEvidence?.sourceSha256,value.personRemovalEvidence?.outputSha256,value.compositeFirstFrameSha256,value.qa?.reportHash].every(sha)&&Array.isArray(value.referenceCompositionHashes)&&value.referenceCompositionHashes.length>0&&new Set(value.referenceCompositionHashes).size===value.referenceCompositionHashes.length&&value.referenceCompositionHashes.every(sha)&&Number.isSafeInteger(value.presenter.assetVersion)&&value.presenter.assetVersion>0&&typeof value.qa.passed==='boolean'&&iso(value.createdAt)&&value.recordHash===presenterFirstFrameApprovalHash(value);
}
function validOriginalContract(value:OriginalScenePresenterFirstFrameApprovalContract){
 const evidence=value.originalScene,provenance=value.originalSceneProvenance;
 if(value.sourceMode!=='original_scene'||value.personRemovalEvidence!==undefined||value.assetProvenance!==undefined||value.backgroundFirst!==undefined
  ||!isPresenterOriginalSceneFirstEvidence(evidence)||!isOriginalScenePresenterAssetProvenance(provenance)
  ||evidence.source.sceneContractHash!==provenance.source.sceneContractHash||evidence.source.promptHash!==provenance.source.promptHash
  ||value.targetAspectRatio!==evidence.aspectRatio||!Array.isArray(value.referenceCompositionHashes)||value.referenceCompositionHashes.length!==0
  ||evidence.background.sha256!==value.backgroundPlateSha256||evidence.composite.sha256!==value.compositeFirstFrameSha256||evidence.composite.artifactRef!==value.compositeFirstFrameUrl
  ||evidence.composite.presenterAssetId!==value.presenter?.assetId||evidence.composite.presenterAssetVersion!==value.presenter?.assetVersion
  ||provenance.presenter.assetId!==value.presenter.assetId||provenance.presenter.assetVersion!==value.presenter.assetVersion
  ||value.presenter.providerId!=='heygen'||!text(value.presenter.providerPresenterId)||!text(value.presenter.providerVoiceId)
  ||value.qa?.scope!==undefined||value.qa?.passed!==true||value.qa.receiptRef!==evidence.composite.qa.receiptRef||value.qa.reportHash!==evidence.composite.qa.reportHash
  ||!tenantMediaRef(evidence.background.artifactRef,value.tenantId)||!tenantMediaRef(evidence.composite.artifactRef,value.tenantId))return false;
 return [value.tenantId,value.taskId,value.runId,value.groupId,value.presenter.authorizationRef,value.presenter.consentRef].every(text)
  &&[value.planHash,value.presenterGroupContractHash].every(sha)&&iso(value.createdAt)&&value.recordHash===presenterFirstFrameApprovalHash(value);
}
function validDecision(value:PresenterFirstFrameDecisionReceipt){return value.schemaVersion==='social-presenter-first-frame-decision.v1'&&value.decisionVersion===1&&value.decision==='confirmed'&&[value.tenantId,value.taskId,value.runId,value.groupId,value.actorId,value.idempotencyKey].every(text)&&[value.planHash,value.approvalRecordHash,value.confirmedHash].every(sha)&&iso(value.decidedAt)&&value.confirmedHash===hash({approvalRecordHash:value.approvalRecordHash,actorId:value.actorId,idempotencyKey:value.idempotencyKey,decisionVersion:1,decision:'confirmed'})&&value.recordHash===presenterFirstFrameDecisionHash(value);}
const where=(scope:SocialTaskBudgetScope,groupId:string)=>({tenant_id:scope.tenantId,task_id:scope.taskId,run_id:scope.runId,plan_hash:scope.planHash,group_id:groupId});
export async function createPresenterFirstFrameApproval(store:DataStore,input:Omit<LegacyPresenterFirstFrameApprovalContract,'schemaVersion'|'recordHash'>){const body={schemaVersion:input.backgroundFirst?'social-presenter-first-frame-approval.v2' as const:'social-presenter-first-frame-approval.v1' as const,...structuredClone(input)},record={...body,recordHash:presenterFirstFrameApprovalHash(body)};if(!validContract(record))throw Error('presenter_first_frame_contract_invalid');const found=await store.list<any>(CONTRACTS,{where:where(input,input.groupId),perPage:2});if(found.totalItems||found.items.length){if(found.totalItems===1&&found.items.length===1&&found.items[0]?.record_hash===record.recordHash)return record;throw Error('presenter_first_frame_contract_conflict');}const saved=await store.create(CONTRACTS,{...where(input,input.groupId),record_hash:record.recordHash,payload:record});if(!saved)throw Error('presenter_first_frame_contract_write_failed');return record;}
export async function createOriginalScenePresenterFirstFrameApproval(store:DataStore,input:Omit<OriginalScenePresenterFirstFrameApprovalContract,'schemaVersion'|'recordHash'>):Promise<OriginalScenePresenterFirstFrameApprovalContract>{
 const body={schemaVersion:'social-presenter-first-frame-approval.v3' as const,...structuredClone(input)},record={...body,recordHash:presenterFirstFrameApprovalHash(body)};
 if(!validContract(record))throw Error('presenter_first_frame_contract_invalid');
 const found=await store.list<any>(CONTRACTS,{where:where(input,input.groupId),perPage:2});
 if(found.totalItems||found.items.length){if(found.totalItems===1&&found.items.length===1&&found.items[0]?.record_hash===record.recordHash)return record;throw Error('presenter_first_frame_contract_conflict');}
 if(!await store.create(CONTRACTS,{...where(input,input.groupId),record_hash:record.recordHash,payload:record}))throw Error('presenter_first_frame_contract_write_failed');return record;
}
const AUTO_ACTOR='system:presenter-first-frame-qa';
async function writeConfirmation(store:DataStore,input:{scope:SocialTaskBudgetScope;groupId:string;expectedRecordHash:string;actorId:string;idempotencyKey:string;decidedAt?:string}){const approval=await readApproval(store,input.scope,input.groupId);if(!approval||approval.recordHash!==input.expectedRecordHash||!approval.qa.passed)throw Error('presenter_first_frame_confirmation_target_changed');const found=await store.list<any>(DECISIONS,{where:where(input.scope,input.groupId),perPage:2});if(found.totalItems||found.items.length){const prior=found.items[0]?.payload as PresenterFirstFrameDecisionReceipt;if(found.totalItems===1&&found.items.length===1&&validDecision(prior)&&prior.approvalRecordHash===approval.recordHash&&prior.actorId===input.actorId&&prior.idempotencyKey===input.idempotencyKey&&found.items[0]?.record_hash===prior.recordHash)return prior;throw Error('presenter_first_frame_decision_conflict');}const body={schemaVersion:'social-presenter-first-frame-decision.v1' as const,decisionVersion:1 as const,...input.scope,groupId:input.groupId,approvalRecordHash:approval.recordHash,actorId:input.actorId,idempotencyKey:input.idempotencyKey,decision:'confirmed' as const,decidedAt:input.decidedAt||new Date().toISOString(),confirmedHash:hash({approvalRecordHash:approval.recordHash,actorId:input.actorId,idempotencyKey:input.idempotencyKey,decisionVersion:1,decision:'confirmed'})};const receipt={...body,recordHash:presenterFirstFrameDecisionHash(body)};if(!validDecision(receipt))throw Error('presenter_first_frame_decision_invalid');const saved=await store.create(DECISIONS,{...where(input.scope,input.groupId),record_hash:receipt.recordHash,payload:receipt});if(!saved)throw Error('presenter_first_frame_decision_write_failed');return receipt;}
export async function confirmPresenterFirstFrameApproval(store:DataStore,input:{scope:SocialTaskBudgetScope;groupId:string;expectedRecordHash:string;actorId:string;idempotencyKey:string;decidedAt?:string}){if(input.actorId===AUTO_ACTOR||input.idempotencyKey.startsWith('system-auto-confirm:'))throw Error('presenter_first_frame_reserved_system_identity');return writeConfirmation(store,input);}
/** Server-only automatic continuation after the immutable static QA contract
 * passes. No caller-controlled actor or decision value crosses this boundary. */
export async function automaticallyConfirmPresenterFirstFrameApproval(store:DataStore,input:{scope:SocialTaskBudgetScope;groupId:string;expectedRecordHash:string;decidedAt?:string}){
 const approval=await readApproval(store,input.scope,input.groupId);
 if(!approval||approval.recordHash!==input.expectedRecordHash||!approval.qa.passed)throw Error('presenter_first_frame_confirmation_target_changed');
 const existing=await readConfirmedPresenterFirstFrameApproval(store,{scope:input.scope,groupId:input.groupId,presenterGroupContractHash:approval.presenterGroupContractHash,presenterAssetId:approval.presenter.assetId});
 if(approval.qa.receiptRef.startsWith('local-technical:')&&(!existing||existing.decision.actorId===AUTO_ACTOR))throw Error('presenter_first_frame_visual_qa_required');
 if(existing)return existing.decision;
 return writeConfirmation(store,{...input,actorId:AUTO_ACTOR,idempotencyKey:`system-auto-confirm:${input.scope.runId}:${input.groupId}:${input.expectedRecordHash}`});
}
async function readApproval(store:DataStore,scope:SocialTaskBudgetScope,groupId:string){const rows=await store.list<any>(CONTRACTS,{where:where(scope,groupId),perPage:2});if(rows.totalItems!==1||rows.items.length!==1)return null;const value=rows.items[0]?.payload as PresenterFirstFrameApprovalContract;if(!value||!validContract(value)||value.tenantId!==scope.tenantId||value.taskId!==scope.taskId||value.runId!==scope.runId||value.planHash!==scope.planHash||value.groupId!==groupId||rows.items[0]?.record_hash!==value.recordHash)return null;return value;}
export async function readConfirmedPresenterFirstFrameApproval(store:DataStore,input:{scope:SocialTaskBudgetScope;groupId:string;presenterGroupContractHash:string;presenterAssetId:string;expectedAssetProvenanceHash?:string}){const approval=await readApproval(store,input.scope,input.groupId);if(!approval||!approval.qa.passed||approval.presenterGroupContractHash!==input.presenterGroupContractHash||approval.presenter.assetId!==input.presenterAssetId||(input.expectedAssetProvenanceHash!==undefined&&(!sha(input.expectedAssetProvenanceHash)||(approval.schemaVersion==='social-presenter-first-frame-approval.v3'?approval.originalSceneProvenance.manifestHash:approval.assetProvenance?.manifestHash)!==input.expectedAssetProvenanceHash)))return null;const rows=await store.list<any>(DECISIONS,{where:where(input.scope,input.groupId),perPage:2});if(rows.totalItems!==1||rows.items.length!==1)return null;const decision=rows.items[0]?.payload as PresenterFirstFrameDecisionReceipt;if(!decision||!validDecision(decision)||decision.approvalRecordHash!==approval.recordHash||decision.tenantId!==input.scope.tenantId||decision.taskId!==input.scope.taskId||decision.runId!==input.scope.runId||decision.planHash!==input.scope.planHash||decision.groupId!==input.groupId||rows.items[0]?.record_hash!==decision.recordHash)return null;return {approval,decision};}
export async function listPresenterFirstFrameApprovalsForReview(store:DataStore,input:{tenantId:string;taskId:string;runId:string}){const rows=await store.list<any>(CONTRACTS,{where:{tenant_id:input.tenantId,task_id:input.taskId,run_id:input.runId},perPage:20});if(rows.totalItems!==rows.items.length||rows.totalItems>20)throw Error('presenter_first_frame_review_scope_ambiguous');const approvals:PresenterFirstFrameApprovalContract[]=[];for(const row of rows.items){const value=row.payload as PresenterFirstFrameApprovalContract;if(!value||!validContract(value)||value.tenantId!==input.tenantId||value.taskId!==input.taskId||value.runId!==input.runId||row.record_hash!==value.recordHash)throw Error('presenter_first_frame_review_corrupt');approvals.push(value);}return approvals.sort((a,b)=>a.groupId.localeCompare(b.groupId));}
