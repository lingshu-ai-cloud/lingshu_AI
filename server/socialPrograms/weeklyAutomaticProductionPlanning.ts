import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyPlanningAuthority} from './planningAuthority.js';
import {withExecutionPackageGate,executionPackageFrozen} from './weeklyExecutionGate.js';
import {readIndependentAdmission} from './weeklyIndependentAdmission.js';
import {readWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {listWeeklyExecutionTasks,recomputePackageExecution,getWeeklyExecutionTaskRow,writeWeeklyExecutionTask,applyBusinessDispatchToExecutionTasks} from './executionTasks.js';
import {createWeeklyExecutionContinuationService} from './weeklyExecutionContinuations.js';
import {buildWeeklyProductionScopeCapacity,persistWeeklyProductionScopeCapacity,readWeeklyProductionScopeCapacity} from './weeklyProductionScopeCapacity.js';
import {buildWeeklyProductionPlanningAuthority,persistWeeklyProductionPlanningAuthority,readWeeklyProductionPlanningAuthority} from './weeklyProductionPlanningAuthority.js';
import {readWeeklyExistingFactSource} from './weeklyExistingFactSource.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';
import {listContentExecutionLimits} from '../contentExecution/durableQueue.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {verifiedWeeklyPlanningTemplateAdoption} from './weeklyPlanningTemplateAdoption.js';
import {INITIAL_CAPACITY_SCHEDULE_REQUIRED} from './weeklyInitialScheduleGate.js';
import {SocialProgramError} from './service.js';
type Scope={tenantId:string;programId:string;packageId:string;packageVersion:number};
export const WEEKLY_AUTOMATIC_PRODUCTION_INTENTS='social_weekly_automatic_production_intents';
export interface WeeklyAutomaticProductionIntent {intentId:string;scope:Scope;source:'automatic_template';templateVersion:'weekly-automation.v2';adoptedAt:string;userApproval:null;actorUserId:string;planningAdoptionHash:string;productionAuthorityProofId:string;capacityProofId:string;dispatchHash:string;selectedPublicationTaskIds:string[];authorizesPublishing:false;authorizesContentAcceptance:false;authorizesCustomerMessages:false;}
function fail(code:string):never{throw new SocialProgramError(code,409,code);}
export async function readWeeklyAutomaticProductionIntent(store:DataStore,s:Scope,pkg:WeeklyOperatingPackage,publicationTaskId:string){
 const planning=await createWeeklyPlanningAuthority(store).get(s.tenantId,s.programId,s.packageId,s.packageVersion);
 const adoption=verifiedWeeklyPlanningTemplateAdoption(planning);if(!adoption||planning.status!=='dispatched'||!planning.dispatch)return null;
 const id=socialRequestHash([s,adoption.recordHash]),row=await store.getById<Record_>(WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,id),intent=row?.payload as WeeklyAutomaticProductionIntent|undefined;
 if(!row||!intent||row.content_hash!==socialRequestHash(intent)||intent.intentId!==id||socialRequestHash(intent.scope)!==socialRequestHash(s)||intent.planningAdoptionHash!==adoption.recordHash||intent.dispatchHash!==socialRequestHash(planning.dispatch)||!intent.selectedPublicationTaskIds.includes(publicationTaskId)||intent.userApproval!==null||intent.authorizesPublishing!==false||intent.authorizesContentAcceptance!==false||intent.authorizesCustomerMessages!==false)return null;
 const authority=await readWeeklyProductionPlanningAuthority(store,{tenantId:s.tenantId,pkg,planning,proofId:intent.productionAuthorityProofId});
 return authority?{intent,authority,planning}:null;
}
/** Product-owned continuation after actual analyzed supply, not a manual task
 * state patch. Missing analyses or inputs are left untouched; scope/fees/rights
 * must be verified again by the real production adapter before any enqueue. */
export async function prepareWeeklyAutomaticProductionPlanning(store:DataStore,s:Scope,now=new Date().toISOString()){
 return withExecutionPackageGate(store,s,async assert=>{
  const admission=await readIndependentAdmission(store,s),template=await readWeeklyAutomationTemplate(store,s);
  if(!admission||template?.template.version!=='weekly-automation.v2')return {status:'not_ready' as const,code:'weekly_automatic_production_opt_in_required'};
  const row=await latestPackageRow(store,s.tenantId,s.programId,s.packageId);
  if(!row||row.payload.version!==s.packageVersion||!['draft','active'].includes(row.payload.status)||await executionPackageFrozen(store,s))return {status:'not_ready' as const,code:'weekly_automatic_production_scope_stale'};
  const pkg=row.payload,planner=createWeeklyPlanningAuthority(store);let plan=await planner.get(s.tenantId,s.programId,s.packageId,s.packageVersion);
  if(plan.userConfirmation)return {status:'not_ready' as const,code:'weekly_existing_manual_planning_preserved'};
  if(!plan.detailedSchedule?.coverage||!['awaiting_confirmation','confirmed','dispatched'].includes(plan.status))return {status:'not_ready' as const,code:'weekly_actual_analysis_and_schedule_required'};
  if(plan.status==='dispatched'&&plan.automaticTemplateAdoption){
   const first=plan.dispatch?.scheduleItems[0]?.publicationTaskId;
   if(!first)return {status:'not_ready' as const,code:'weekly_automatic_dispatch_empty'};
   const existing=await readWeeklyAutomaticProductionIntent(store,s,pkg,first);
   if(existing){const tasks=await listWeeklyExecutionTasks(store,s.tenantId,s.programId,s.packageId,s.packageVersion),taskId=tasks.find(t=>t.publicationTaskId===first&&t.schedule.stepKind==='script')?.taskId;
    const capacity=taskId?await readWeeklyProductionScopeCapacity(store,{proofId:existing.intent.capacityProofId,pkg,tasks,planning:plan,taskId,now}):null;
    if(capacity)return {status:'prepared' as const,intent:existing.intent,fullWeeklyPackageActivated:false as const};
    return {status:'not_ready' as const,code:'weekly_automatic_capacity_changed_requires_reconciliation'};
   }
  }
  const source=await readWeeklyExistingFactSource(store,s.tenantId),tasks=await listWeeklyExecutionTasks(store,s.tenantId,s.programId,s.packageId,s.packageVersion);
  const outline=tasks.filter(t=>t.schedule.stepKind==='business_outline'&&t.status==='succeeded');
  if(outline.length!==1)return {status:'not_ready' as const,code:'weekly_real_outline_required'};
  const goalRef=outline[0].resultRefs.find(ref=>ref.type==='business_content_goal');if(!goalRef)return {status:'not_ready' as const,code:'weekly_real_goal_evidence_required'};
  const goal=await createSocialOperatingRepository(store).getGoal(s.tenantId,s.programId,goalRef.id,goalRef.version);if(!goal)return {status:'not_ready' as const,code:'weekly_real_goal_evidence_required'};
  // Existing result validation proves real completed ancestors; no timestamp or
  // status is converted to a delivery merely to make capacity appear feasible.
  const evidence=await createWeeklyExecutionContinuationService(store).derivePlannerEvidence(s,now),verifiedCompletedTaskIds=new Set(Object.keys(evidence.completedEvidence));
  const limits=await listContentExecutionLimits(store,s.tenantId),selection=plan.detailedSchedule.coverage.selectedSlotIds;
  if(plan.status==='awaiting_confirmation')plan=await planner.confirmAutomaticTemplate({...s,actorUserId:admission.actorUserId,expectedPlanningVersion:plan.version,selectedSlotIds:selection,now:new Date(now)});
  const production=buildWeeklyProductionPlanningAuthority({tenantId:s.tenantId,pkg,planning:plan,goal,factSourceRef:source.ref,factSourceHash:source.sourceHash,now});
  // Capacity is checked before dispatch. The second proof binds the real
  // dispatch metadata written onto task inputs, without changing task identity.
  buildWeeklyProductionScopeCapacity({pkg,tasks,planning:plan,selectedSlotIds:selection,now,limits,verifiedCompletedTaskIds});
  if(plan.status==='confirmed')plan=await planner.dispatch({...s,actor:'business_agent',expectedPlanningVersion:plan.version,selectedSlotIds:selection,now:new Date(now)});
  if(!plan.dispatch)fail('weekly_automatic_real_dispatch_missing');
  await assert();await applyBusinessDispatchToExecutionTasks(store,s.tenantId,s.programId,s.packageId,s.packageVersion,plan.dispatch!,now);
  const actual=await listWeeklyExecutionTasks(store,s.tenantId,s.programId,s.packageId,s.packageVersion),capacity=buildWeeklyProductionScopeCapacity({pkg,tasks:actual,planning:plan,selectedSlotIds:selection,now,limits,verifiedCompletedTaskIds});
  await persistWeeklyProductionPlanningAuthority(store,production);await persistWeeklyProductionScopeCapacity(store,capacity);
  const adoption=verifiedWeeklyPlanningTemplateAdoption(plan)!;
  const intentId=socialRequestHash([s,adoption.recordHash]),intent:WeeklyAutomaticProductionIntent={intentId,scope:s,source:'automatic_template',templateVersion:'weekly-automation.v2',adoptedAt:now,userApproval:null,actorUserId:admission.actorUserId,planningAdoptionHash:adoption.recordHash,productionAuthorityProofId:production.proofId,capacityProofId:capacity.proofId,dispatchHash:socialRequestHash(plan.dispatch),selectedPublicationTaskIds:plan.dispatch!.scheduleItems.map(i=>i.publicationTaskId),authorizesPublishing:false,authorizesContentAcceptance:false,authorizesCustomerMessages:false};
  const old=await store.getById<Record_>(WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,intentId);
  if(old){if(old.content_hash!==socialRequestHash(old.payload))fail('weekly_automatic_production_intent_invalid');}
  else if(!await store.create(WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,{id:intentId,tenant_id:s.tenantId,program_id:s.programId,package_id:s.packageId,package_version:s.packageVersion,payload:intent,content_hash:socialRequestHash(intent)}))fail('weekly_automatic_production_intent_write_failed');
  for(const assignment of capacity.assignments){const task=actual.find(t=>t.taskId===assignment.taskId)!;if(task.status==='succeeded')continue;
   const next={...task,ownBlockingReasons:task.ownBlockingReasons.filter(code=>code!==INITIAL_CAPACITY_SCHEDULE_REQUIRED&&code!=='business_dispatch_required')};
   if(socialRequestHash(task)!==socialRequestHash(next)){await assert();await writeWeeklyExecutionTask(store,await getWeeklyExecutionTaskRow(store,s.tenantId,task.taskId),next);}
  }
  await recomputePackageExecution(store,s.tenantId,s.programId,s.packageId,s.packageVersion,now,true);
  return {status:'prepared' as const,intent:old?.payload??intent,fullWeeklyPackageActivated:false as const};
 });
}
