import {CONTENT_CREATION_QUOTA_COLLECTION,type QuotaScope} from '../socialPrograms/contentCreationQuota.js';
import type {Starter198Repository} from './repository.js';
import {STARTER_COLLECTIONS} from './repository.js';
import {executeSocialContentMutation} from './socialContentMutation.js';
import {resolvePreparedProductAssetCostLineage} from './socialContentCostLineage.js';
import {readPreparedSocialProductAssetFallback} from './socialContentProductAssetRevisionPrepare.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialRequestHash,socialText,SocialContentWorkflowError} from './socialContentValidation.js';

const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_${code}`,409);};

/** Freeze the exact registered same-slot dispatch as a dedicated operation.
 * This is deliberately not a queue/worker adapter: no run or provider authority
 * can be inferred from a prepared marker or this operation alone. */
export async function freezeSocialProductAssetRevisionStart(input:{
 repository:Starter198Repository;tenantId:string;userId:string;taskId:string;commandId:string;
 idempotencyKey:string;prepared:Parameters<typeof readPreparedSocialProductAssetFallback>[0];now?:Date;
}){
 if(input.prepared.repository!==input.repository||input.prepared.tenantId!==input.tenantId
  ||input.prepared.taskId!==input.taskId)return fail('scope_invalid');
 const store=input.repository.dataStore;
 if(!store?.compareAndSwap||!await store.supportsAtomicCompareAndSwap?.())return fail('atomic_store_required');
 const read=async()=>{
  const lineage=await resolvePreparedProductAssetCostLineage(input.prepared);
  const task=await requireSocialTask(input),binding=socialObject(socialJson(task.content_order));
  const dispatch=socialObject(binding?.dispatch),queue=socialObject(dispatch?.queueRequest);
  if(!binding||!dispatch||!queue||dispatch.commandId!==input.commandId
   ||dispatch.userId!==input.userId||dispatch.schemaVersion!=='social-content-dispatch.v1'
   ||socialRequestHash((({requestHash,...body})=>body)(dispatch))!==dispatch.requestHash
   ||queue.commandId!==input.commandId||queue.userId!==input.userId||queue.tenantId!==input.tenantId
   ||queue.workflowScope!=='social_content'||socialObject(queue.subject)?.id!==input.taskId
   ||socialObject(queue.subject)?.version!==lineage.preparedVersion
   ||socialText(task.version)!==lineage.preparedVersion||socialText(task.run_id)!==lineage.sourceRunId)
   return fail('registered_dispatch_invalid');
  const scope:QuotaScope={tenantId:input.tenantId,programId:lineage.programId,weekStart:lineage.originWeek};
  const pools=await store.list<any>(CONTENT_CREATION_QUOTA_COLLECTION,
   {where:{tenant_id:input.tenantId,program_id:lineage.programId,week_start:lineage.originWeek},perPage:2});
  if(pools.totalItems!==1||pools.items.length!==1)return fail('quota_missing_or_ambiguous');
  const pool=pools.items[0]?.payload;
  const order=pool?.orders?.[lineage.contentId];
  const revisions=order?.revisions?.filter((item:any)=>item.executionTaskId===lineage.executionTaskId
   &&item.lineageHash===lineage.lineageHash&&item.commandId===input.commandId);
  const outbox=pool?.outbox?.filter((item:any)=>item.kind==='dispatch'&&item.contentId===lineage.contentId
   &&item.executionTaskId===lineage.executionTaskId&&item.commandId===input.commandId);
  if(pool?.scope?.tenantId!==scope.tenantId||pool?.scope?.programId!==scope.programId
   ||pool?.scope?.weekStart!==scope.weekStart||!order||revisions?.length!==1||outbox?.length!==1
   ||outbox[0].state!=='pending')return fail('registered_outbox_invalid');
  return {lineage,dispatchHash:String(dispatch.requestHash),outboxCommandId:input.commandId};
 };
 const frozen=await read();
 const requestHash=socialRequestHash({schemaVersion:'social-product-asset-revision-start-freeze.v1',
  tenantId:input.tenantId,taskId:input.taskId,userId:input.userId,
  commandId:input.commandId,lineageHash:frozen.lineage.lineageHash,dispatchHash:frozen.dispatchHash});
 const operation=await executeSocialContentMutation({repository:input.repository,tenantId:input.tenantId,
  userId:input.userId,idempotencyKey:input.idempotencyKey,requestHash,
  operation:'freeze_social_product_asset_revision_start',targetId:input.taskId,now:input.now,
  processingReceipt:{lineageHash:frozen.lineage.lineageHash,dispatchHash:frozen.dispatchHash,
   outboxCommandId:input.commandId},
  action:async()=>{
   const current=await read();
   if(current.lineage.lineageHash!==frozen.lineage.lineageHash||current.dispatchHash!==frozen.dispatchHash)
    return fail('freeze_inputs_changed');
   return current;
  },replay:async()=>read()});
 return {...operation.value,operationRepeated:operation.repeated,authorizesQueue:false as const,authorizesProvider:false as const};
}
