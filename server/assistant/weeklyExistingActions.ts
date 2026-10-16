import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {decideSocialContentArtifact} from '../starter198/socialContentOutputs.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyCreativeRepairExecutionService,type WeeklyCreativeRepairProductionPort} from '../socialPrograms/weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairProductionPort} from '../runtime/weeklyCreativeRepairProductionPort.js';
import {runWeeklyPublicationPackageScan} from '../publishing/weeklyPublicationWorker.js';
import {PUBLICATION_ASSIGNMENTS,type StoredPublicationAssignment} from '../publishing/weeklyLineage.js';

export interface WeeklyExistingActionScope {tenantId:string;userId:string;programId:string;packageId:string;packageVersion:number;publicationTaskId:string;taskId:string;artifactId:string;expectedArtifactVersion:string}
const fail=(code:string,status=409):never=>{throw new SocialProgramError(`assistant_weekly_${code}`,status,'请重新选择当前周任务及其最新交付物；未执行任何额外生产或发布。');};

/** A facade over canonical decisions and workers, never a second task database. */
export function createWeeklyExistingActions(store:DataStore,options:{clock?:()=>Date;repairPort?:WeeklyCreativeRepairProductionPort;packageScan?:typeof runWeeklyPublicationPackageScan}={}){
 const clock=options.clock??(()=>new Date()),cases=createWeeklyProductionRepairCaseService(store,clock);
 const configuration=createWeeklyCreativeRepairConfigurationService(store,clock);
 const execution=createWeeklyCreativeRepairExecutionService(store,options.repairPort??createWeeklyCreativeRepairProductionPort(store,clock),clock);
 async function exact(collection:string,where:Record<string,string|number>){const rows=await store.list<Record_>(collection,{where,perPage:2});if(rows.totalItems!==1||rows.items.length!==1)return fail('source_not_unique');return rows.items[0]!;}
 async function source(s:WeeklyExistingActionScope,checkVersion=true){
  if(!Number.isSafeInteger(s.packageVersion)||s.packageVersion<1||Object.values(s).some(v=>typeof v==='string'&&!v.trim()))fail('scope_invalid',400);
  const user=await store.getById<Record_>('users',s.userId),role=organizationRoleOrNull(user?.role);
  if(!user||user.tenantId!==s.tenantId||user.disabled===true||user.active===false||['disabled','suspended'].includes(String(user.status))||!role||!['social_operator','admin','super_admin'].includes(role))fail('actor_forbidden',403);
  const packageRow=await exact('social_weekly_operating_packages',{tenant_id:s.tenantId,program_id:s.programId,package_id:s.packageId,version:s.packageVersion});
  const pkg=packageRow.payload as WeeklyOperatingPackage;if(pkg.status!=='active'||pkg.version!==s.packageVersion||pkg.packageId!==s.packageId)fail('package_not_active');
  if(pkg.socialContentPackage.publicationTasks.filter(p=>p.publicationTaskId===s.publicationTaskId).length!==1)fail('publication_missing');
  const task=await exact('starter_social_content_tasks',{tenant_id:s.tenantId,task_id:s.taskId});
  const brief=socialObject(socialJson(task.brief)),authority=socialObject(brief?._weeklyAuthority),week=socialObject(authority?.weeklyPackage),publication=socialObject(authority?.publicationTask);
  if(task.weekly_plan_id!==s.packageId||week?.programId!==s.programId||week?.packageId!==s.packageId||week?.version!==s.packageVersion||publication?.publicationTaskId!==s.publicationTaskId)fail('task_lineage_changed');
  const artifact=await exact('starter_social_content_artifacts',{tenant_id:s.tenantId,task_id:s.taskId,artifact_id:s.artifactId});
  if(checkVersion&&String(artifact.version)!==s.expectedArtifactVersion)fail('artifact_version_changed');
  return{pkg,task,artifact};
 }
 async function caseScope(s:WeeklyExistingActionScope,caseId:string){await source(s,false);const item=await cases.read(s.tenantId,caseId);if(item.programId!==s.programId||item.packageId!==s.packageId||item.packageVersion!==s.packageVersion||item.publicationTaskId!==s.publicationTaskId||item.parent.taskId!==s.taskId||item.parent.artifactRef.id!==s.artifactId)fail('repair_scope_changed');return item;}
 return{
  async requestRevision(s:WeeklyExistingActionScope,input:{requestId:string;note:string}){
   await source(s,false);if(!/^[a-zA-Z0-9:_-]{8,200}$/.test(input.requestId)||!input.note?.trim()||input.note.length>2000)fail('revision_input_invalid',400);
   await decideSocialContentArtifact({repository:createStarter198Repository(store),tenantId:s.tenantId,userId:s.userId,taskId:s.taskId,artifactId:s.artifactId,idempotencyKey:input.requestId,value:{expectedVersion:s.expectedArtifactVersion,decision:'changes_requested',note:input.note.trim()},weeklyRevisionBridge:{handles:({tenantId,taskId,artifactId})=>cases.handlesCreativeDecision(tenantId,taskId,artifactId),persist:value=>cases.createCreativeFromDecision(value)},now:clock()});
   const items=await cases.list(s.tenantId,s.programId,s.packageId,s.packageVersion),item=items.find(v=>v.parent.taskId===s.taskId&&v.parent.artifactRef.id===s.artifactId&&!['resolved','cancelled'].includes(v.state));
   if(!item)return fail('revision_receipt_missing',503);
   return{state:item.state,case:item,message:'已记录到原周任务的返工链，确认修订范围、预算与时间后才能开始生产。'};
  },
  async configureRevision(s:WeeklyExistingActionScope,caseId:string,input:Parameters<typeof configuration.configure>[3]){await caseScope(s,caseId);return configuration.configure(s.tenantId,s.userId,caseId,input);},
  async previewRevision(s:WeeklyExistingActionScope,caseId:string){await caseScope(s,caseId);return execution.previewCapacity(s.tenantId,s.userId,caseId);},
  async confirmRevision(s:WeeklyExistingActionScope,caseId:string,input:Parameters<typeof execution.confirmCapacity>[3]){await caseScope(s,caseId);return execution.confirmCapacity(s.tenantId,s.userId,caseId,input);},
  async startRevision(s:WeeklyExistingActionScope,caseId:string,input:Parameters<typeof execution.start>[3]){await caseScope(s,caseId);return execution.start(s.tenantId,s.userId,caseId,input);},
  async preparePublish(s:WeeklyExistingActionScope){
   const{artifact}=await source(s);if(artifact.status!=='approved')fail('approval_required');
   const content=socialObject(socialJson(artifact.content)),production=socialObject(content?.productionResult),productionResultId=production?.productionResultId;if(typeof productionResultId!=='string'||!productionResultId)return fail('final_video_required');
   const tasks=await store.list<Record_>('social_weekly_execution_tasks',{where:{tenant_id:s.tenantId,program_id:s.programId,package_id:s.packageId,package_version:s.packageVersion},perPage:1000});if(tasks.totalItems!==tasks.items.length)fail('task_graph_incomplete',503);
   const publishTasks=tasks.items.map(r=>r.payload as WeeklyExecutionTask).filter(t=>t.publicationTaskId===s.publicationTaskId&&t.schedule.stepKind==='publishing');if(publishTasks.length!==1)fail('publish_task_missing');
   const scan=await(options.packageScan??runWeeklyPublicationPackageScan)({dataStore:store,tenantId:s.tenantId,taskId:s.taskId,artifactId:s.artifactId});if(scan.errors.some(e=>e.artifactId===s.artifactId))fail('publish_prerequisite_unverified');
   const assignment=await exact(PUBLICATION_ASSIGNMENTS,{tenant_id:s.tenantId,operating_package_id:s.packageId,operating_package_version:s.packageVersion,publication_task_id:s.publicationTaskId,production_result_id:productionResultId}) as unknown as StoredPublicationAssignment;
   if(assignment.status!=='package_ready'||assignment.authorization_revoked_at)fail('publication_not_authorized');
   return{state:publishTasks[0]!.status,executionTaskId:publishTasks[0]!.taskId,assignmentId:assignment.assignment_id,packageId:s.packageId,packageVersion:s.packageVersion,publicationTaskId:s.publicationTaskId,message:'已核验并关联原周发布任务；按既定时间及授权执行，平台回执由原任务回收。'};
  },
 };
}
