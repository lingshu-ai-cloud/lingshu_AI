import {withWeeklyProductionAdmissionGuard} from '../socialPrograms/weeklyCancellation.js';
import {randomUUID,createHash} from 'node:crypto';import {Readable} from 'node:stream';
import type {Starter198Repository} from './repository.js';
import type {SocialWeeklyG6Scope,SocialWeeklyG6Context} from '../../shared/contracts/socialWeeklyG6Review.js';
import {INSTAGRAM_DELIVERY_TECHNICAL_CHECKS,INSTAGRAM_DELIVERY_CREATIVE_CHECKS,type SocialInstagramDelivery,type SocialInstagramDeliveryReview,type InstagramDeliveryReviewKind,type InstagramDeliveryObservation,type SocialInstagramDeliveryRead} from '../../shared/contracts/socialInstagramDelivery.js';
import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import {openSocialArtifactPreviewMedia} from './socialArtifactMedia.js';
import {storeSocialContentFile,registerSocialContentFile,cleanupTransientSocialContentUpload} from './socialContentFiles.js';
import {convertInstagramDelivery} from './socialInstagramDeliveryConversion.js';
import {socialRequestHash} from './socialContentValidation.js';
import {INSTAGRAM_DELIVERIES,INSTAGRAM_DELIVERY_REVIEWS,deliveryScopeFields,readInstagramDeliveryEvidence,readInstagramSourceAudit,decodeInstagramDelivery} from './socialInstagramDeliveryEvidence.js';
import {acquireDurableOperationLease,assertDurableOperationLease,releaseDurableOperationLease} from '../runtime/durableLease.js';
const assert=(value:unknown,code:string):void=>{if(!value)throw Error('instagram_delivery_'+code);};
const sealed=<T extends object>(body:T)=>({...body,recordHash:socialRequestHash(body)});
export function createSocialInstagramDeliveryService(repository:Starter198Repository,ports:{source?:(a:SocialWeeklyG6Scope,actor:string)=>Promise<SocialWeeklyG6Context>}={}){
 const store=repository.dataStore;if(!store)throw Error('instagram_delivery_storage_missing');
 function mutationAllowed(ctx:SocialWeeklyG6Context){assert(!ctx.gaps.some(g=>['new_preflight_admission_unavailable','actual_independent_g5_pass_required','current_g4_pass_required'].includes(g)),'source_review_or_weekly_admission_required');}
 const source=ports.source??((a,actor)=>createSocialWeeklyG6ReviewService(repository).context(a,actor));
 async function fresh(a:SocialWeeklyG6Scope,actor:string){const ctx=await source(a,actor);assert(ctx.platform==='instagram','platform_not_instagram');const user=await store!.getById('users',actor);assert(user&&user.tenantId===a.tenantId&&user.disabled!==true&&user.enabled!==false&&user.active!==false&&!['disabled','suspended'].includes(String(user.status))&&['admin','super_admin','social_operator'].includes(String(user.role)),'actor_not_authorized');return ctx;}
 async function read(a:SocialWeeklyG6Scope,actor:string):Promise<SocialInstagramDeliveryRead>{const ctx=await fresh(a,actor),evidence=await readInstagramDeliveryEvidence(repository,a,ctx);return {item:evidence?.item??null,currentSourceVerified:Boolean(evidence),reviews:evidence?.reviews??[],previewUrl:evidence?`/api/overseas/starter-198/social-content/tasks/${encodeURIComponent(a.taskId)}/runs/${encodeURIComponent(a.runId)}/artifacts/${encodeURIComponent(a.artifactId)}/instagram-delivery/media?programId=${encodeURIComponent(a.programId)}&packageId=${encodeURIComponent(a.packageId)}&packageVersion=${a.packageVersion}&publicationTaskId=${encodeURIComponent(a.publicationTaskId)}`:null,gaps:evidence?['technical','creative'].filter(kind=>!evidence.reviews.some(r=>r.kind===kind&&r.status==='passed')).map(kind=>`packaged_${kind}_review_required`):['instagram_delivery_not_prepared']};}
 return {
 read,
 async media(a:SocialWeeklyG6Scope,actor:string){const ctx=await fresh(a,actor),result=await readInstagramDeliveryEvidence(repository,a,ctx);assert(result,'not_prepared');return result!;},
 async prepare(a:SocialWeeklyG6Scope,actor:string,input:{requestId:string;expectedContextHash:string}){
  return withWeeklyProductionAdmissionGuard({dataStore:store!,tenantId:a.tenantId,packageId:a.packageId,packageVersion:a.packageVersion,action:async weeklyAssert=>{
  assert(/^[a-zA-Z0-9_-]{16,160}$/.test(input.requestId),'request_id_invalid');const ctx=await fresh(a,actor);mutationAllowed(ctx);
  const existing=await readInstagramDeliveryEvidence(repository,a,ctx);if(existing){assert(existing.item.requestId===input.requestId&&existing.item.preparedBy===actor&&existing.item.sourceContextHash===input.expectedContextHash,'already_prepared');return read(a,actor);}
  assert(input.expectedContextHash===ctx.contextHash,'context_changed');const scopeKey=socialRequestHash(deliveryScopeFields(a)),lease=await acquireDurableOperationLease({dataStore:store!,tenantId:a.tenantId,scope:'instagram_delivery_prepare',subjectId:scopeKey,ownerId:actor,leaseDurationMs:600000});assert(lease,'prepare_in_progress');
  try{
   const replay=await readInstagramDeliveryEvidence(repository,a,await fresh(a,actor));if(replay){assert(replay.item.requestId===input.requestId&&replay.item.preparedBy===actor,'already_prepared');return read(a,actor);}
   const original=await openSocialArtifactPreviewMedia({repository,tenantId:a.tenantId,taskId:a.taskId,artifactId:a.artifactId});assert(original.file.fileRef===ctx.fileRef&&original.file.sha256===ctx.fileSha256,'source_changed');const parts:Buffer[]=[];let size=0;for await(const part of original.body){const b=Buffer.from(part);size+=b.length;assert(size<=110*1024*1024,'source_size_invalid');parts.push(b);}
   const sourceAuditHash=await readInstagramSourceAudit(repository,a);const converted=await convertInstagramDelivery(Buffer.concat(parts),ctx.fileSha256);const stored=await storeSocialContentFile({stream:Readable.from(converted.bytes),tenantId:a.tenantId,name:'instagram-delivery.mp4',mimeType:'video/mp4',declaredLength:converted.bytes.length});
   try{
    const file=await registerSocialContentFile({repository,tenantId:a.tenantId,userId:actor,taskId:a.taskId,usage:'artifact_media',idempotencyKey:`instagram_delivery_${scopeKey}_${input.requestId}`,stored,transientPath:stored.transientPath});
    assert(file.sha256===converted.deliverySha256,'archive_hash_changed');const current=await fresh(a,actor);mutationAllowed(current);assert(current.artifactHash===ctx.artifactHash&&current.fileSha256===ctx.fileSha256&&current.handoffId===ctx.handoffId&&current.handoffVersion===ctx.handoffVersion&&current.productionResultHash===ctx.productionResultHash&&await readInstagramSourceAudit(repository,a)===sourceAuditHash,'source_changed');await assertDurableOperationLease({dataStore:store!,lease:lease!});
    const item:SocialInstagramDelivery=sealed({...a,deliveryId:randomUUID().replaceAll('-','').slice(0,15),requestId:input.requestId,version:1 as const,preparedBy:actor,preparedAt:new Date().toISOString(),sourceContextHash:ctx.contextHash,sourceAuditHash,sourceArtifactHash:ctx.artifactHash,sourceFileRef:ctx.fileRef,sourceFileSha256:ctx.fileSha256,sourceHandoffId:ctx.handoffId,sourceHandoffVersion:ctx.handoffVersion,sourceProductionResultId:ctx.productionResultId,sourceProductionResultHash:ctx.productionResultHash,conversionVersion:converted.conversionVersion,conversionHash:converted.conversionHash,fileRef:file.fileRef,fileId:file.fileId,fileSha256:file.sha256,metadata:converted.metadata});
    await weeklyAssert();const saved=await store!.create(INSTAGRAM_DELIVERIES,{id:item.deliveryId,...deliveryScopeFields(a),request_id:input.requestId,content_hash:item.recordHash,payload:item});assert(saved?.id===item.deliveryId,'persistence_failed');return read(a,actor);
   }finally{await cleanupTransientSocialContentUpload(stored);}
  }finally{await releaseDurableOperationLease({dataStore:store!,lease:lease!});}
  }});
 },
 async review(a:SocialWeeklyG6Scope,actor:string,input:{requestId:string;expectedDeliveryHash:string;kind:InstagramDeliveryReviewKind;checks:InstagramDeliveryObservation[]}){
  return withWeeklyProductionAdmissionGuard({dataStore:store!,tenantId:a.tenantId,packageId:a.packageId,packageVersion:a.packageVersion,action:async weeklyAssert=>{
  assert(/^[a-zA-Z0-9_-]{16,160}$/.test(input.requestId),'request_id_invalid');assert(input.kind==='technical'||input.kind==='creative','review_kind_invalid');const ctx=await fresh(a,actor),evidence=await readInstagramDeliveryEvidence(repository,a,ctx);assert(evidence,'not_prepared');const item=evidence!.item;mutationAllowed(ctx);assert(item.recordHash===input.expectedDeliveryHash,'delivery_changed');
  const codes=input.kind==='technical'?INSTAGRAM_DELIVERY_TECHNICAL_CHECKS:INSTAGRAM_DELIVERY_CREATIVE_CHECKS;assert(Array.isArray(input.checks)&&input.checks.length===codes.length,'checks_invalid');for(const code of codes){const rows=input.checks.filter(c=>c.code===code);assert(rows.length===1&&['passed','failed','unknown'].includes(rows[0]!.outcome)&&typeof rows[0]!.observation==='string'&&rows[0]!.observation.trim().length>0&&rows[0]!.observation.length<=4000,'checks_invalid');}
  const checks=input.checks.map(c=>({...c,observation:c.observation.trim()})),old=evidence!.reviews.find(r=>r.kind===input.kind);if(old){assert(old.requestId===input.requestId&&old.actorUserId===actor&&socialRequestHash(old.checks)===socialRequestHash(checks),'review_already_recorded');return read(a,actor);}
  const lease=await acquireDurableOperationLease({dataStore:store!,tenantId:a.tenantId,scope:'instagram_delivery_review',subjectId:`${item.deliveryId}:${input.kind}`,ownerId:actor});assert(lease,'review_in_progress');try{
   const current=await fresh(a,actor);mutationAllowed(current);const latest=await readInstagramDeliveryEvidence(repository,a,current);assert(latest?.item.recordHash===item.recordHash,'delivery_changed');assert(!latest?.reviews.some(r=>r.kind===input.kind),'review_already_recorded');
   const review:SocialInstagramDeliveryReview=sealed({reviewId:createHash('sha256').update(`${item.deliveryId}:${input.kind}`).digest('hex').slice(0,15),requestId:input.requestId,deliveryId:item.deliveryId,deliveryHash:item.recordHash,fileSha256:item.fileSha256,kind:input.kind,actorUserId:actor,actorRole:input.kind==='technical'?'human_technical_reviewer' as const:'human_director_reviewer' as const,checks,status:checks.some(c=>c.outcome==='failed')?'failed' as const:checks.every(c=>c.outcome==='passed')?'passed' as const:'review_required' as const,reviewedAt:new Date().toISOString()});
   await assertDurableOperationLease({dataStore:store!,lease:lease!});await weeklyAssert();const saved=await store!.create(INSTAGRAM_DELIVERY_REVIEWS,{id:review.reviewId,tenant_id:a.tenantId,delivery_id:item.deliveryId,kind:input.kind,request_id:input.requestId,content_hash:review.recordHash,payload:review});assert(saved?.id===review.reviewId,'review_persistence_failed');return read(a,actor);
  }finally{await releaseDurableOperationLease({dataStore:store!,lease:lease!});}
  }});
 }
 };
}
