import {randomUUID} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {SocialDirectorG5Scope} from '../../shared/contracts/socialDirectorG5Review.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {createSocialSceneReworkService} from '../starter198/socialContentSceneReworkService.js';
import {createWeeklyContentQualityRecoveryService,WEEKLY_QUALITY_ACTUAL_REPAIR_BLOCK} from './weeklyContentQualityRecovery.js';
import {withWeeklyProductionAdmissionGuard} from './weeklyCancellation.js';
import {SocialProgramError} from './service.js';

export const WEEKLY_PRODUCTION_REPAIR_CASES='social_weekly_production_repair_cases';
const fail=(code:string,status=409):never=>{throw new SocialProgramError(`weekly_repair_case_${code}`,status,'返工任务的来源、容量或截止信息不完整。');};
const text=(value:unknown,code:string,max=200)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max?value:fail(code,400);
const hash=(value:unknown,code:string)=>/^[a-f0-9]{64}$/.test(String(value))?String(value):fail(code,400);
const instant=(value:unknown,code:string)=>{const result=text(value,code,40);if(!Number.isFinite(Date.parse(result)))fail(code,400);return new Date(result).toISOString();};
async function exactRows(store:DataStore,where:Record<string,string|number>){const result=await store.list<Record_>(WEEKLY_PRODUCTION_REPAIR_CASES,{where,perPage:200});if(result.totalItems!==result.items.length)fail('storage_incomplete',503);return result.items;}
function decode(row:Record_):WeeklyProductionRepairCase{
 const raw=socialObject(socialJson(row.payload));
 if(!raw)fail('record_corrupt',503);
 const item=raw as unknown as WeeklyProductionRepairCase;
 if(row.content_hash!==socialRequestHash(item))fail('record_corrupt',503);
 const {recordHash,...body}=item;
 if(item.schemaVersion!=='weekly-production-repair-case.v1'||item.version!==1||recordHash!==socialRequestHash(body)||row.case_id!==item.caseId)fail('record_corrupt',503);
 return structuredClone(item);
}
export function createWeeklyProductionRepairCaseService(store:DataStore,clock:()=>Date=()=>new Date()){
 const repository=createStarter198Repository(store),sceneRework=createSocialSceneReworkService(repository),qualityRecovery=createWeeklyContentQualityRecoveryService(store);
 async function read(tenantId:string,caseId:string){const rows=await exactRows(store,{tenant_id:tenantId,case_id:caseId});if(rows.length!==1)fail(rows.length?'ambiguous':'not_found',rows.length?503:404);return decode(rows[0]!);}
 async function list(tenantId:string,programId:string,packageId:string,packageVersion:number){const rows=await exactRows(store,{tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion});return rows.map(decode).sort((a,b)=>a.deadlineAt.localeCompare(b.deadlineAt)||a.caseId.localeCompare(b.caseId));}
 return {read,list,
  async createTechnical(scope:SocialDirectorG5Scope,actorUserId:string,input:{requestId:string;expectedQualityContextHash:string;qualityTaskId:string;affectedSceneIds:string[];ownerUserId:string;reviewerUserId:string;deadlineAt:string;estimatedDurationMinutes:number;maximumCostCny:number}){
   const requestId=text(input.requestId,'input_invalid',160),qualityTaskId=text(input.qualityTaskId,'input_invalid'),ownerUserId=text(input.ownerUserId,'input_invalid'),reviewerUserId=text(input.reviewerUserId,'input_invalid');
   const expectedQualityContextHash=hash(input.expectedQualityContextHash,'input_invalid'),deadlineAt=instant(input.deadlineAt,'deadline_invalid');
   if(!Array.isArray(input.affectedSceneIds)||!input.affectedSceneIds.length||input.affectedSceneIds.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim())||new Set(input.affectedSceneIds).size!==input.affectedSceneIds.length)fail('scene_selection_invalid',400);
   if(!Number.isSafeInteger(input.estimatedDurationMinutes)||input.estimatedDurationMinutes<1||input.estimatedDurationMinutes>1440||!Number.isFinite(input.maximumCostCny)||input.maximumCostCny<0)fail('capacity_invalid',400);
   const quality=await qualityRecovery.context(scope,actorUserId),matchedConsumer=quality.consumers.find(item=>item.executionTaskId===qualityTaskId);
   if(!matchedConsumer)fail('quality_source_invalid');
   const consumer=matchedConsumer!;
   if(consumer.contextHash!==expectedQualityContextHash||consumer.status!=='blocked'||!consumer.ownBlockingReasons.includes(WEEKLY_QUALITY_ACTUAL_REPAIR_BLOCK)||consumer.gap?.code!=='weekly_quality_recovery_repair_artifact_required')fail('quality_source_invalid');
   const taskRows=await store.list<Record_>('social_weekly_execution_tasks',{where:{tenant_id:scope.tenantId,program_id:consumer.programId,package_id:consumer.packageId,package_version:consumer.packageVersion},perPage:500});
   if(taskRows.totalItems!==taskRows.items.length)fail('task_graph_incomplete',503);const tasks=taskRows.items.map(row=>row.payload as WeeklyExecutionTask),qualityTask=tasks.find(task=>task.taskId===qualityTaskId),approval=tasks.filter(task=>task.publicationTaskId===consumer.publicationTaskId&&task.schedule.stepKind==='user_approval');
   if(!qualityTask||approval.length!==1||approval[0]!.dependsOnTaskIds.length!==1||approval[0]!.dependsOnTaskIds[0]!==qualityTaskId)fail('v3_graph_required');
   const packageRows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:scope.tenantId,program_id:consumer.programId,package_id:consumer.packageId,version:consumer.packageVersion},perPage:2});
   if(packageRows.totalItems!==1||packageRows.items.length!==1)fail('package_missing');const pkg=packageRows.items[0]!.payload as WeeklyOperatingPackage;if(pkg.executionGraphVersion!==3||pkg.status!=='active')fail('v3_graph_required');
   const publication=pkg.socialContentPackage.publicationTasks.filter(item=>item.publicationTaskId===consumer.publicationTaskId);if(publication.length!==1)fail('publication_invalid');const rawPublishWindow=publication[0]!.publishWindow;if(!rawPublishWindow)fail('publication_invalid');const publishWindow=new Date(rawPublishWindow!).toISOString();if(Date.parse(deadlineAt)>=Date.parse(publishWindow))fail('deadline_after_publish',400);
   const cache=await sceneRework.readCache({tenantId:scope.tenantId,taskId:scope.taskId,runId:scope.runId,parentArtifactId:scope.artifactId}),failed=cache.cache.scenes.filter(scene=>scene.status==='failed');
   const selected=[...input.affectedSceneIds].sort(),required=failed.map(scene=>scene.sceneId).sort();if(socialRequestHash(selected)!==socialRequestHash(required))fail('failed_scenes_incomplete');
   const parentRows=await store.list<Record_>('starter_social_content_artifacts',{where:{tenant_id:scope.tenantId,task_id:scope.taskId,artifact_id:scope.artifactId},perPage:2});if(parentRows.totalItems!==1||parentRows.items.length!==1)fail('parent_missing');const parent=parentRows.items[0]!,parentVersion=Number(String(parent.version).replace(/^v/,''));if(!Number.isSafeInteger(parentVersion)||parentVersion<1||parent.content_hash!==quality.artifactHash)fail('parent_changed');
   const subjectHash=socialRequestHash({tenantId:scope.tenantId,programId:consumer.programId,packageId:consumer.packageId,packageVersion:consumer.packageVersion,publicationTaskId:consumer.publicationTaskId,parentArtifactId:scope.artifactId,kind:'technical_scene_repair'});
   return withWeeklyProductionAdmissionGuard({dataStore:store,tenantId:scope.tenantId,packageId:consumer.packageId,packageVersion:consumer.packageVersion,action:async assert=>{
    const active=(await exactRows(store,{tenant_id:scope.tenantId,subject_hash:subjectHash})).map(decode).filter(item=>!['resolved','cancelled'].includes(item.state));
    if(active.length>1)fail('active_ambiguous',503);if(active.length===1)return active[0]!;
    const now=clock().toISOString(),requestHash=socialRequestHash({scope,qualityTaskId,expectedQualityContextHash,affectedSceneIds:selected,ownerUserId,reviewerUserId,deadlineAt,estimatedDurationMinutes:input.estimatedDurationMinutes,maximumCostCny:input.maximumCostCny}),body={schemaVersion:'weekly-production-repair-case.v1' as const,caseId:`wrc_${randomUUID()}`,version:1 as const,requestId,requestHash,tenantId:scope.tenantId,programId:consumer.programId,packageId:consumer.packageId,packageVersion:consumer.packageVersion,publicationTaskId:consumer.publicationTaskId,accountId:publication[0]!.accountId,qualityTaskId,approvalTaskId:approval[0]!.taskId,kind:'technical_scene_repair' as const,trigger:{type:'verified_quality_failure' as const,blocker:'weekly_quality_audit_actual_repair_required' as const,qualityContextHash:expectedQualityContextHash,failedReceiptIds:failed.map(scene=>scene.technicalReceiptId).sort()},parent:{taskId:scope.taskId,runId:scope.runId,artifactRef:quality.artifactRef,artifactHash:quality.artifactHash,sceneCacheHash:cache.cache.recordHash},affectedSceneIds:selected,ownerUserId,reviewerUserId,deadlineAt,affectedPublishWindow:publishWindow,estimatedDurationMinutes:input.estimatedDurationMinutes,maximumCostCny:input.maximumCostCny,state:'awaiting_capacity' as const,execution:null,childArtifactRef:null,createdBy:actorUserId,createdAt:now,updatedAt:now};const item:WeeklyProductionRepairCase={...body,recordHash:socialRequestHash(body)};
    await assert();const saved=await store.create(WEEKLY_PRODUCTION_REPAIR_CASES,{tenant_id:item.tenantId,program_id:item.programId,package_id:item.packageId,package_version:item.packageVersion,publication_task_id:item.publicationTaskId,case_id:item.caseId,subject_hash:subjectHash,request_id:item.requestId,state:item.state,content_hash:socialRequestHash(item),payload:item});if(!saved){const recovered=(await exactRows(store,{tenant_id:scope.tenantId,subject_hash:subjectHash})).map(decode).filter(candidate=>!['resolved','cancelled'].includes(candidate.state));if(recovered.length===1)return recovered[0]!;fail('save_failed',503);}return item;
   }});
  }
 };
}
