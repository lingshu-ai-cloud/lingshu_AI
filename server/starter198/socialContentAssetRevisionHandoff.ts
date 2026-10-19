import {CONTENT_CREATION_QUOTA_COLLECTION} from '../socialPrograms/contentCreationQuota.js';
import {STARTER_COLLECTIONS,type Starter198Repository} from './repository.js';
import {withSocialContentSubjectLease,assertSocialContentSubjectLease} from './socialContentMutation.js';
import {readSocialProductAssetRevisionPaidGuard} from './socialContentAssetRevisionPaidGuard.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialRequestHash,socialText,SocialContentWorkflowError} from './socialContentValidation.js';

type GuardInput=Parameters<typeof readSocialProductAssetRevisionPaidGuard>[0];
const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_handoff_${code}`,409);};

/** Bind the existing content task to its isolated revision run. This is a
 * durable identity handoff, not a worker admission or a provider permit. */
export async function handoffSocialProductAssetRevision(input:{repository:Starter198Repository;guard:GuardInput;
 queueItemId:string;actorId:string;now?:Date}):Promise<{taskVersion:string;runId:string;repeated:boolean;
 authorizesProvider:false;authorizesProduction:false}>{
 const {repository,guard}=input,store=repository.dataStore;
 if(guard.repository!==repository||guard.prepared.repository!==repository||!store?.compareAndSwap
  ||!await store.supportsAtomicCompareAndSwap?.()||!socialText(input.queueItemId)||!socialText(input.actorId))return fail('input_invalid');
 const compareAndSwap=store.compareAndSwap.bind(store);
 return withSocialContentSubjectLease({repository,tenantId:guard.tenantId,subjectId:guard.taskId,action:async()=>{
  const frozen=await readSocialProductAssetRevisionPaidGuard(guard);
  const run=await repository.get(STARTER_COLLECTIONS.runs,guard.tenantId,guard.revisionRunId);
  const context=socialObject(socialJson(run?.starter_context));
  const queue=await repository.list(STARTER_COLLECTIONS.tasks,guard.tenantId,
   {where:{run_id:guard.revisionRunId,task_key:'social_product_asset_revision_admission'},perPage:2});
  const queueRow=queue.items[0];
  if(!run||run.status!=='waiting_external'||context?.schemaVersion!=='social-product-asset-revision-schedule.v1'
   ||context.taskId!==guard.taskId||context.sourceRunId!==guard.prepared.sourceRunId
   ||context.revisedPlanHash!==frozen.guard.revisedPlanHash||context.lineageHash!==frozen.guard.lineageHash
   ||context.budgetLedgerRef!==frozen.guard.budgetLedgerRef||context.queueItemId!==input.queueItemId
   ||queue.totalItems!==1||queue.items.length!==1||!queueRow||queueRow.status!=='blocked'
   ||queueRow.automatic_execution_allowed!==false||queueRow.external_effect!=='none'
   ||socialRequestHash(socialJson(queueRow.output))!==socialRequestHash({...context,paidGuard:undefined}))
   return fail('schedule_changed');
  const pools=await store.list<any>(CONTENT_CREATION_QUOTA_COLLECTION,{where:{tenant_id:guard.tenantId},perPage:500});
  if(pools.totalItems!==pools.items.length)return fail('quota_incomplete');
  const matching=pools.items.filter(item=>item.payload?.scope?.tenantId===guard.tenantId
   &&item.payload?.outbox?.some((entry:any)=>entry.kind==='dispatch'&&entry.commandId===context.dispatchCommandId
    &&entry.contentId===guard.taskId));
  if(matching.length!==1)return fail('quota_changed');
  const pool=matching[0].payload,outbox=pool.outbox.filter((entry:any)=>entry.kind==='dispatch'
   &&entry.commandId===context.dispatchCommandId&&entry.contentId===guard.taskId);
  const order=pool.orders?.[guard.taskId];
  if(outbox.length!==1||outbox[0].state!=='pending'||!order
   ||order.slotId!==pool.slots?.find((slot:any)=>slot.contentId===guard.taskId)?.slotId
   ||order.revisions?.filter((entry:any)=>entry.commandId===context.dispatchCommandId
    &&entry.lineageHash===frozen.guard.lineageHash).length!==1)return fail('quota_changed');
  const task=await requireSocialTask({repository,tenantId:guard.tenantId,taskId:guard.taskId});
  const newRun=socialText(task.run_id)===guard.revisionRunId;
  if(newRun){
   if(socialText(task.orchestrator_item_id)!==input.queueItemId||task.status!=='paused'
    ||socialText(task.version)!==String(Number(frozen.guard.preparedVersion)+1))return fail('task_changed');
   return {taskVersion:socialText(task.version),runId:guard.revisionRunId,repeated:true,
    authorizesProvider:false as const,authorizesProduction:false as const};
  }
  if(socialText(task.run_id)!==guard.prepared.sourceRunId
   ||socialText(task.version)!==frozen.guard.preparedVersion
   ||!['attention','paused'].includes(socialText(task.status)))return fail('task_changed');
  const version=Number(task.version);
  if(!Number.isSafeInteger(version)||version<1)return fail('version_invalid');
  await assertSocialContentSubjectLease({repository,tenantId:guard.tenantId,subjectId:guard.taskId});
  const saved=await compareAndSwap(STARTER_COLLECTIONS.socialContentTasks,task.id,
   {tenant_id:guard.tenantId,version:task.version,run_id:task.run_id,status:task.status,
    brief:task.brief,replication_script:task.replication_script,orchestrator_item_id:task.orchestrator_item_id},
   {run_id:guard.revisionRunId,orchestrator_item_id:input.queueItemId,status:'paused',version:String(version+1),
    updated_by:input.actorId,updated_at:(input.now??new Date()).toISOString()});
  if(!saved)return fail('task_conflict');
  await readSocialProductAssetRevisionPaidGuard(guard);
  return {taskVersion:String(version+1),runId:guard.revisionRunId,repeated:false,
   authorizesProvider:false as const,authorizesProduction:false as const};
 }});
}
