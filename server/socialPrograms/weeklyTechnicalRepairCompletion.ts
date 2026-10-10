import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import {createWeeklyProductionRepairCaseService,WEEKLY_PRODUCTION_REPAIR_CASES} from './weeklyProductionRepairCases.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {readSocialSceneReworkStatus} from '../starter198/socialContentSceneReworkRead.js';
import {socialRequestHash,socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {SOCIAL_SCENE_INTENT_COLLECTION} from '../starter198/socialContentSceneReworkService.js';
import {withWeeklyProductionAdmissionGuard} from './weeklyCancellation.js';
import {getWeeklyExecutionTaskRow,recomputePackageExecution,withWeeklyExecutionTaskMutation,writeWeeklyExecutionTask} from './executionTasks.js';
import {readVerifiedWeeklyContentQualityAudit} from '../runtime/weeklyContentQualityAudit.js';
import {createWeeklyContentQualityRecoveryService} from './weeklyContentQualityRecovery.js';
import {SocialProgramError} from './service.js';

function check(value:unknown,code:string):asserts value {if(!value)throw new SocialProgramError(`weekly_repair_completion_${code}`,409,'返工产物或审核证据尚未满足恢复条件。');}

/** Reconciles existing output and audit evidence. It never creates or completes a production job. */
export function createWeeklyTechnicalRepairCompletionService(store:DataStore){
 const cases=createWeeklyProductionRepairCaseService(store),repository=createStarter198Repository(store);
 async function output(tenantId:string,actorUserId:string,caseId:string){
  const item=await cases.read(tenantId,caseId);
  check(item.kind==='technical_scene_repair'&&item.execution&&['running','awaiting_audit','resolved'].includes(item.state),'state_invalid');
  check(actorUserId===item.ownerUserId||actorUserId===item.reviewerUserId,'actor_forbidden');
  const status=await readSocialSceneReworkStatus({repository,tenantId,actorUserId:item.ownerUserId,taskId:item.parent.taskId,operationId:item.execution.operationId});
  const intents=await store.list<Record_>(SOCIAL_SCENE_INTENT_COLLECTION,{where:{tenant_id:tenantId,task_id:item.parent.taskId,operation_id:item.execution.operationId},perPage:2}),intent=socialObject(socialJson(intents.items[0]?.payload));
  check(intents.totalItems===1&&intent&&intent.parentArtifactHash===item.parent.artifactHash&&intent.cacheHash===item.parent.sceneCacheHash,'parent_evidence_changed');
  check(status.executionRunId===item.execution.runId&&status.jobId===item.execution.jobId&&status.sourceRunId===item.parent.runId&&status.parentArtifactId===item.parent.artifactRef.id,'execution_changed');
  check(socialRequestHash([...status.affectedSceneIds].sort())===socialRequestHash([...item.affectedSceneIds].sort()),'scene_scope_changed');
  if(item.admission)check(item.admission.operationId===status.operationId&&item.admission.executionRunId===status.executionRunId&&item.admission.sceneCacheHash===item.parent.sceneCacheHash,'admission_changed');
  check(status.jobStatus==='succeeded'&&['succeeded','completed'].includes(status.runStatus)&&status.output,'output_not_complete');
  check(status.completedAt&&Number.isFinite(Date.parse(status.completedAt))&&status.runCompletedAt&&Number.isFinite(Date.parse(status.runCompletedAt)),'completion_evidence_missing');
  const rows=await store.list<Record_>('starter_social_content_artifacts',{where:{tenant_id:tenantId,task_id:item.parent.taskId,artifact_id:status.output.artifactId},perPage:2});
  check(rows.totalItems===1&&rows.items.length===1,'artifact_missing');
  const version=Number(String(rows.items[0]!.version).replace(/^v/,''));check(Number.isSafeInteger(version)&&version>0,'artifact_version_invalid');
  const ref={type:'starter_social_content_artifact',id:status.output.artifactId,version};
  if(item.childArtifactRef)check(socialRequestHash(item.childArtifactRef)===socialRequestHash(ref),'child_changed');
  return{item,status,ref,scope:{tenantId,taskId:item.parent.taskId,runId:item.execution.runId,artifactId:ref.id}};
 }
 async function saveCase(item:WeeklyProductionRepairCase,state:WeeklyProductionRepairCase['state'],ref:NonNullable<WeeklyProductionRepairCase['childArtifactRef']>,assert:()=>Promise<void>){
  const rows=await store.list<Record_>(WEEKLY_PRODUCTION_REPAIR_CASES,{where:{tenant_id:item.tenantId,case_id:item.caseId},perPage:2});check(rows.totalItems===1&&rows.items.length===1&&rows.items[0]!.content_hash===socialRequestHash(item),'case_changed');
  if(item.state===state&&item.childArtifactRef)return item;
  const{recordHash:_,...body}=item,next={...body,state,childArtifactRef:ref,updatedAt:new Date().toISOString()},updated={...next,recordHash:socialRequestHash(next)};
  await assert();check(await store.update(WEEKLY_PRODUCTION_REPAIR_CASES,rows.items[0]!.id,{state,content_hash:socialRequestHash(updated),payload:updated}),'save_failed');return updated;
 }
 async function reconcile(tenantId:string,actorUserId:string,caseId:string){
  const initial=await output(tenantId,actorUserId,caseId);
  return withWeeklyProductionAdmissionGuard({dataStore:store,tenantId,packageId:initial.item.packageId,packageVersion:initial.item.packageVersion,action:async assert=>{
   const actual=await output(tenantId,actorUserId,caseId),item=actual.item;
   const quality=(await getWeeklyExecutionTaskRow(store,tenantId,item.qualityTaskId)).payload;
   check(quality.programId===item.programId&&quality.packageId===item.packageId&&quality.packageVersion===item.packageVersion&&quality.publicationTaskId===item.publicationTaskId&&quality.schedule.stepKind==='quality_check','quality_scope_changed');
   if(quality.status==='succeeded'){
    await readVerifiedWeeklyContentQualityAudit(store,quality,actual.ref);
    check(quality.resultRefs.some(ref=>socialRequestHash(ref)===socialRequestHash(actual.ref)),'quality_result_changed');
    const recovery=quality.qualityRecoveries?.find(ref=>ref.artifactId===actual.ref.id&&ref.runId===actual.scope.runId&&ref.repairParentArtifactRef?.id===item.parent.artifactRef.id);
    check(recovery,'recovery_receipt_missing');
    const verified=await createWeeklyContentQualityRecoveryService(store).read(actual.scope,item.ownerUserId,item.qualityTaskId,recovery.requestId);
    check(verified.currentSourceVerified,'audit_changed');
    // Persist the evidence-backed resolution before making approval claimable.
    // A failed approval update can then be repaired by replaying this same reconciliation.
    const resolved=await saveCase(item,'resolved',actual.ref,assert);
    await withWeeklyExecutionTaskMutation(store,tenantId,item.approvalTaskId,async()=>{
     const row=await getWeeklyExecutionTaskRow(store,tenantId,item.approvalTaskId),approval=row.payload;
     check(approval.programId===item.programId&&approval.packageId===item.packageId&&approval.packageVersion===item.packageVersion&&approval.publicationTaskId===item.publicationTaskId&&approval.schedule.stepKind==='user_approval'&&approval.dependsOnTaskIds.length===1&&approval.dependsOnTaskIds[0]===quality.taskId&&!approval.lease&&!['cancelled','dead_letter'].includes(approval.status),'approval_scope_changed');
     const own=approval.ownBlockingReasons.filter(reason=>reason!==`weekly_repair_case_open:${item.caseId}`),inherited=approval.inheritedBlockingTaskIds.filter(id=>id!==quality.taskId);
     if(socialRequestHash(own)===socialRequestHash(approval.ownBlockingReasons)&&socialRequestHash(inherited)===socialRequestHash(approval.inheritedBlockingTaskIds))return;
     await assert();await writeWeeklyExecutionTask(store,row,{...approval,ownBlockingReasons:own,inheritedBlockingTaskIds:inherited,status:approval.status==='succeeded'?'succeeded':own.length||inherited.length?'blocked':'queued',updatedAt:new Date().toISOString()});
    });
    await recomputePackageExecution(store,tenantId,item.programId,item.packageId,item.packageVersion,new Date().toISOString(),false);
    return resolved;
   }
   check(item.state!=='resolved','resolved_evidence_changed');
   return saveCase(item,'awaiting_audit',actual.ref,assert);
  }});
 }
 return{reconcile,async recoverQuality(tenantId:string,actorUserId:string,caseId:string,input:{requestId:string;expectedContextHash:string}){
  const actual=await output(tenantId,actorUserId,caseId);check(actorUserId===actual.item.ownerUserId,'owner_required');
  await reconcile(tenantId,actorUserId,caseId);
  return createWeeklyContentQualityRecoveryService(store).resume(actual.scope,actorUserId,{...input,executionTaskId:actual.item.qualityTaskId});
 }};
}
