import {createHash} from 'node:crypto';
import {CONTENT_CREATION_QUOTA_COLLECTION} from '../socialPrograms/contentCreationQuota.js';
import type {Starter198Repository,StarterRecord} from './repository.js';
import {STARTER_COLLECTIONS} from './repository.js';
import type {Starter198SocialAssetRevisionQueueInput} from './runtimePorts.js';
import {withSocialContentSubjectLease,assertSocialContentSubjectLease} from './socialContentMutation.js';
import {resolvePreparedProductAssetCostLineage} from './socialContentCostLineage.js';
import {readPreparedSocialProductAssetFallback} from './socialContentProductAssetRevisionPrepare.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialRequestHash,socialText,SocialContentWorkflowError} from './socialContentValidation.js';

type Queue = Starter198SocialAssetRevisionQueueInput;
type RevisionSubject = Queue['subject'];
const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_schedule_${code}`,409);};
const id=(kind:string,tenantId:string,commandId:string)=>createHash('sha256').update(JSON.stringify([kind,tenantId,commandId])).digest('hex').slice(0,15);

/** Dedicated, non-executable queue admission. The original task and run stay
 * untouched so the prepared reader remains a valid recovery authority. */
export async function scheduleSocialProductAssetRevision(input:{
 repository:Starter198Repository;queue:Queue;prepared:Parameters<typeof readPreparedSocialProductAssetFallback>[0];now?:Date;
}):Promise<{queueItemId:string;runId:string;authorizesProvider:false;authorizesProduction:false}>{
 const subject=input.queue.subject;
 if(subject?.type!=='social_product_asset_revision'||input.queue.workflowScope!=='social_content'
  ||!socialText(subject.id)||!socialText(subject.revisedPlanHash)||!socialText(subject.freezeOperationId)
  ||!socialText(subject.freezeIdempotencyKey)||!socialText(input.queue.commandId)
  ||!socialText(input.queue.userId)||!socialText(input.queue.idempotencyKey)
  ||input.prepared.repository!==input.repository||input.prepared.tenantId!==input.queue.tenantId
  ||input.prepared.taskId!==subject.id||input.prepared.sourceRunId!==subject.sourceRunId
  ||input.prepared.expectedPreparedVersion!==subject.preparedVersion)
  return fail('subject_invalid');
 return withSocialContentSubjectLease({repository:input.repository,tenantId:input.queue.tenantId,subjectId:subject.id,action:async()=>{
  const current=await readAuthority(input.repository,input.queue,subject,input.prepared);
  const tenantId=input.queue.tenantId,commandId=input.queue.commandId,now=(input.now??new Date()).toISOString();
  const goalId=id('asset-revision-goal',tenantId,commandId),planId=id('asset-revision-plan',tenantId,commandId);
  const runId=id('asset-revision-run',tenantId,commandId),queueId=id('asset-revision-queue',tenantId,commandId);
  const queueItemId=`social-asset-revision:${socialRequestHash({tenantId,commandId,taskId:subject.id}).slice(0,32)}`;
  const context={schemaVersion:'social-product-asset-revision-schedule.v1',tenantId,taskId:subject.id,
   sourceRunId:subject.sourceRunId,preparedVersion:subject.preparedVersion,revisedPlanHash:subject.revisedPlanHash,
   lineageHash:subject.lineageHash,freezeOperationId:subject.freezeOperationId,
   freezeIdempotencyKey:subject.freezeIdempotencyKey,dispatchCommandId:commandId,
   budgetLedgerRef:input.prepared.budgetLedgerRef,replacementAssetId:current.replacementAssetId,
   replacementSha256:current.replacementSha256,queueItemId,authorizesProduction:false};
  const exact=(row:StarterRecord)=>row.tenant_id===tenantId&&socialRequestHash(socialJson(row.starter_context??row.output??row.plan??row.scope))===socialRequestHash(context);
  const ensure=async(collection:Parameters<Starter198Repository['get']>[0],recordId:string,data:Record<string,unknown>,valid:(row:StarterRecord)=>boolean)=>{
   const prior=await input.repository.get(collection,tenantId,recordId);
   if(prior){if(!valid(prior))return fail('record_changed');return;}
   await assertSocialContentSubjectLease({repository:input.repository,tenantId,subjectId:subject.id});
   try{const written=await input.repository.create(collection,tenantId,{id:recordId,...data});if(!valid(written))return fail('record_changed');}
   catch(error){const raced=await input.repository.get(collection,tenantId,recordId);if(!raced||!valid(raced))throw error;}
  };
  await ensure(STARTER_COLLECTIONS.goals,goalId,{title:'产品备用图修订',objective:'隔离排期，等待付费前独立准入',metric:'revision_admission',target:1,unit:'revision',starts_at:now.slice(0,10),ends_at:now.slice(0,10),scope:context,constraints:[],owner_id:input.queue.userId,status:'active',version:1,created_at:now,updated_at:now},row=>exact(row));
  await ensure(STARTER_COLLECTIONS.plans,planId,{goal_id:goalId,status:'blocked',plan:context,created_at:now},row=>row.goal_id===goalId&&exact(row));
  await ensure(STARTER_COLLECTIONS.runs,runId,{goal_id:goalId,plan_id:planId,status:'waiting_external',current_controller:'system',pause_reason:'asset_revision_paid_admission_required',product_profile:'starter_social_content_asset_revision',starter_initialization_id:socialRequestHash(context),starter_input_version:subject.preparedVersion,starter_plan_version:1,starter_context:context,started_at:now,completed_at:''},row=>row.goal_id===goalId&&row.plan_id===planId&&row.status==='waiting_external'&&exact(row));
  await ensure(STARTER_COLLECTIONS.tasks,queueId,{goal_id:goalId,plan_id:planId,run_id:runId,task_key:'social_product_asset_revision_admission',title:'备用图修订待独立付费准入',description:'此队列记录不授权生产或供应商调用。',agent_role:'content',kind:'production',status:'blocked',sequence:1,priority:'high',requires_approval:false,depends_on:[],output:context,blocked_reason:'asset_revision_paid_admission_required',owner_id:input.queue.userId,execution_mode:'automatic',external_effect:'none',automatic_execution_allowed:false,policy_source:'social-product-asset-revision-schedule.v1',task_version:1,correction_version:0,created_at:now,updated_at:now},row=>row.run_id===runId&&row.task_key==='social_product_asset_revision_admission'&&row.status==='blocked'&&row.automatic_execution_allowed===false&&exact(row));
  await readAuthority(input.repository,input.queue,subject,input.prepared);
  return {queueItemId,runId,authorizesProvider:false as const,authorizesProduction:false as const};
 }});
}

async function readAuthority(repository:Starter198Repository,queue:Queue,subject:RevisionSubject,prepared:Parameters<typeof readPreparedSocialProductAssetFallback>[0]){
 const lineage=await resolvePreparedProductAssetCostLineage(prepared);
 const certified=await readPreparedSocialProductAssetFallback(prepared);
 if(lineage.lineageHash!==subject.lineageHash||lineage.revisedPlanHash!==subject.revisedPlanHash
  ||certified.revisedPlanHash!==subject.revisedPlanHash||lineage.sourceRunId!==subject.sourceRunId
  ||lineage.preparedVersion!==subject.preparedVersion)return fail('prepared_changed');
 const task=await requireSocialTask({repository,tenantId:queue.tenantId,taskId:subject.id});
 const binding=socialObject(socialJson(task.content_order)),dispatch=socialObject(binding?.dispatch);
 const dispatchQueue=socialObject(dispatch?.queueRequest),dispatchSubject=socialObject(dispatchQueue?.subject);
 const revision=socialObject(socialObject(socialJson(task.brief))?._productAssetFallback)?.revision;
 const asset=socialObject(revision);
 if(!binding||!dispatch||!dispatchQueue||!dispatchSubject
  ||socialRequestHash((({requestHash,...body})=>body)(dispatch))!==dispatch.requestHash
  ||dispatch.schemaVersion!=='social-content-dispatch.v1'
  ||dispatch.commandId!==queue.commandId||dispatch.userId!==queue.userId
  ||dispatchQueue.commandId!==queue.commandId||dispatchQueue.userId!==queue.userId
  ||dispatchQueue.tenantId!==queue.tenantId||dispatchQueue.idempotencyKey!==dispatch.idempotencyKey
  ||queue.idempotencyKey!==dispatch.idempotencyKey
  ||dispatchQueue.workflowScope!=='social_content'||dispatchSubject.type!=='social_content_task'
  ||dispatchSubject.id!==subject.id||dispatchSubject.version!==subject.preparedVersion
  ||dispatchSubject.admissionVersion!==subject.preparedVersion
  ||!asset||!socialText(asset.replacementAssetId)||!socialText(asset.replacementSha256))return fail('dispatch_changed');
 const frozen=await repository.list(STARTER_COLLECTIONS.socialContentOperations,queue.tenantId,{where:{operation_id:subject.freezeOperationId},perPage:2});
 const op=frozen.items[0];
 const expectedFreezeHash=socialRequestHash({schemaVersion:'social-product-asset-revision-start-freeze.v1',tenantId:queue.tenantId,taskId:subject.id,userId:queue.userId,commandId:queue.commandId,lineageHash:lineage.lineageHash,dispatchHash:dispatch.requestHash});
 if(frozen.totalItems!==1||frozen.items.length!==1||!op||op.operation!=='freeze_social_product_asset_revision_start'
  ||op.status!=='succeeded'||op.target_id!==subject.id||op.created_by!==queue.userId
  ||op.idempotency_key!==subject.freezeIdempotencyKey||op.request_hash!==expectedFreezeHash
  ||socialObject(socialJson(op.result))?.operationId!==subject.freezeOperationId)return fail('freeze_changed');
 const store=repository.dataStore;if(!store)return fail('store_required');
 const pools=await store.list<any>(CONTENT_CREATION_QUOTA_COLLECTION,{where:{tenant_id:queue.tenantId,program_id:lineage.programId,week_start:lineage.originWeek},perPage:2});
 const pool=pools.items[0]?.payload,order=pool?.orders?.[lineage.contentId];
 const revisions=order?.revisions?.filter((item:any)=>item.executionTaskId===lineage.executionTaskId&&item.lineageHash===lineage.lineageHash&&item.commandId===queue.commandId);
 const outbox=pool?.outbox?.filter((item:any)=>item.kind==='dispatch'&&item.contentId===lineage.contentId&&item.executionTaskId===lineage.executionTaskId&&item.commandId===queue.commandId);
 if(pools.totalItems!==1||pools.items.length!==1||pool?.scope?.tenantId!==queue.tenantId
  ||pool.scope.programId!==lineage.programId||pool.scope.weekStart!==lineage.originWeek
  ||!order||order.slotId!==pool.slots.find((slot:any)=>slot.contentId===lineage.contentId)?.slotId
  ||revisions?.length!==1||outbox?.length!==1||outbox[0].state!=='pending')return fail('outbox_changed');
 return {replacementAssetId:String(asset.replacementAssetId),replacementSha256:String(asset.replacementSha256)};
}
