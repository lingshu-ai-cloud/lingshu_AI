import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {WEEKLY_AUTOMATION_TEMPLATE} from '../../shared/weeklyAutomationTemplate.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {createWeeklyAutomaticScheduleService,recoverCommittedAutomaticWeeklySchedule,AUTOMATIC_WEEKLY_SCHEDULES,readWeeklyAutomaticPreproductionAdmission} from './weeklyAutomaticSchedule.js';
import {connectAndBindWeeklyAutomaticSchedule,uniqueApprovedWeeklyDiscoveryAuthority} from './weeklyAutomaticScheduleFlow.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {hasWeeklyInitialExecution} from './weeklyInitialExecution.js';
import {readWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {readDailyCollectionCapacity} from '../socialDiscovery/dailyCollectionQuota.js';
import {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId,readIndependentAdmission} from './weeklyIndependentAdmission.js';
import {LOCAL_WEEKLY_CONSUMERS} from '../runtime/localWeeklyExecutionRuntime.js';
import {listWeeklyPreproductionJobs} from '../runtime/weeklyPreproductionProducer.js';
import {supplementConsumerHash} from './weeklySupplementRequests.js';
import {createWeeklyExecutionPipelineService} from './weeklyExecutionPipeline.js';
import type {WeeklyAutomaticExecutionScope} from './weeklyAutomaticScheduleFlow.js';

export const WEEKLY_BUDGET_POLICY_MIGRATIONS='social_weekly_budget_policy_migrations';
const POLICY='weekly-per-film-10.v1' as const;
type Scope=WeeklyAutomaticExecutionScope;
export interface WeeklyBudgetPolicyMigrationReceipt {
 schemaVersion:'weekly-budget-policy-migration.v1';migrationId:string;source:Scope;sourceWeekStart:string;
 sourcePackageHash:string;sourceTaskHash:string;weeklyBudgetCny:number;perItemBudgetCny:number;policy:typeof POLICY;
 state:'planned'|'revised'|'schedule_blocked'|'activating_independent'|'independent_active'|'scheduled';revisedVersion:number|null;targetVersion:number|null;
 createdAt:string;updatedAt:string;activationGraphHash?:string;recordHash:string;
}
type Ports={
 revise?:(scope:Scope,marker:string)=>Promise<number>;
 schedule?:(scope:Scope)=>Promise<{status:'scheduled'|'blocked';targetVersion:number|null}>;
 recoverSchedule?:(scope:Scope)=>Promise<{status?:string;targetVersion?:number|null}|null>;
 bind?:(scope:Scope)=>Promise<void>;
 resumeScan?:(scope:Scope)=>Promise<void>;
 blockedAdmission?:(scope:Scope)=>Promise<boolean>;
 now?:()=>string;
};
const fail=(code:string):never=>{throw Error(code);};
const seal=(value:Omit<WeeklyBudgetPolicyMigrationReceipt,'recordHash'>|WeeklyBudgetPolicyMigrationReceipt):WeeklyBudgetPolicyMigrationReceipt=>{
 const {recordHash:_ignored,...body}=value as WeeklyBudgetPolicyMigrationReceipt;
 return {...body,recordHash:socialRequestHash(body)} as WeeklyBudgetPolicyMigrationReceipt;
};
function checked(row:Record_):WeeklyBudgetPolicyMigrationReceipt{
 const r=row.payload as WeeklyBudgetPolicyMigrationReceipt;
 if(!r||r.schemaVersion!=='weekly-budget-policy-migration.v1'||r.policy!==POLICY||r.migrationId!==row.id||r.recordHash!==seal(r).recordHash||r.recordHash!==row.record_hash||r.source.tenantId!==row.tenant_id||r.source.programId!==row.program_id||r.source.packageId!==row.package_id||r.source.packageVersion!==row.package_version)fail('weekly_budget_migration_receipt_corrupt');
 return r;
}
async function rows(store:DataStore,collection:string,where:Record<string,string|number>){
 const result:Record_[]=[];
 for(let page=1;page<=1000;page++){
  const found=await store.list<Record_>(collection,{where,page,perPage:250,sort:'id'});
  if(!Number.isSafeInteger(found.totalItems)||found.totalItems<0)fail('weekly_budget_migration_scan_invalid');
  result.push(...found.items);
  if(result.length===found.totalItems)return result;
  if(!found.items.length||result.length>found.totalItems)fail('weekly_budget_migration_scan_incomplete');
 }
 return fail('weekly_budget_migration_scan_limit');
}
async function persist(store:DataStore,r:WeeklyBudgetPolicyMigrationReceipt,next:Pick<WeeklyBudgetPolicyMigrationReceipt,'state'|'revisedVersion'|'targetVersion'>&{activationGraphHash?:string},now:string){
 const updated=seal({...r,...next,updatedAt:now});
 if(!await store.update(WEEKLY_BUDGET_POLICY_MIGRATIONS,r.migrationId,{state:updated.state,record_hash:updated.recordHash,payload:updated,updated_at:now}))fail('weekly_budget_migration_receipt_write_failed');
 return updated;
}
const taskHash=(tasks:WeeklyExecutionTask[])=>socialRequestHash(tasks.map(t=>({taskId:t.taskId,status:t.status,attempt:t.attempt,resultRefs:t.resultRefs,budget:t.budget,schedule:t.schedule,lease:t.lease,productionProgress:t.productionProgress})).sort((a,b)=>a.taskId.localeCompare(b.taskId)));
const activationGraphHash=(tasks:WeeklyExecutionTask[])=>socialRequestHash(tasks.map(t=>({taskId:t.taskId,idempotencyKey:t.idempotencyKey,tenantId:t.tenantId,programId:t.programId,packageId:t.packageId,packageVersion:t.packageVersion,workflowKind:t.workflowKind,scope:t.scope,subjectId:t.subjectId,accountId:t.accountId,publicationTaskId:t.publicationTaskId,dependsOnTaskIds:t.dependsOnTaskIds,stepKind:t.schedule.stepKind,responsibleActor:t.schedule.responsibleActor,budget:t.budget})).sort((a,b)=>a.taskId.localeCompare(b.taskId)));
const productionKinds=new Set(['script','asset_generation','video_generation','rework']);
const productionShape=(tasks:WeeklyExecutionTask[])=>socialRequestHash(tasks.filter(t=>productionKinds.has(t.schedule.stepKind)).map(t=>({publicationTaskId:t.publicationTaskId,stepKind:t.schedule.stepKind,scope:t.scope})).sort((a,b)=>socialRequestHash(a).localeCompare(socialRequestHash(b))));
function assertNewTaskBudget(tasks:WeeklyExecutionTask[],perItem:number){
 const budgeted=tasks.filter(t=>productionKinds.has(t.schedule.stepKind));
 if(!budgeted.length||budgeted.some(t=>t.budget.category!=='production'||t.budget.limitCny===null||!Number.isFinite(t.budget.limitCny)||t.budget.limitCny<0||t.budget.limitCny>perItem||hasWeeklyInitialExecution(t)))fail('weekly_budget_migration_target_task_invalid');
}
function assertRevision(source:WeeklyOperatingPackage,target:WeeklyOperatingPackage,marker:string,version:number){
 if(target.version!==version||target.previousVersion!==source.version||target.weekStart!==source.weekStart||target.weekEnd!==source.weekEnd||!String(target.changeReason??'').includes(marker)||target.socialContentPackage.weeklyBudgetCny!==source.socialContentPackage.weeklyBudgetCny||target.socialContentPackage.perItemBudgetCny!==source.socialContentPackage.perItemBudgetCny||socialRequestHash(target.socialContentPackage.publicationTasks)!==socialRequestHash(source.socialContentPackage.publicationTasks)||target.socialContentPackage.authorization.allowRealPublishing||source.socialContentPackage.authorization.allowRealPublishing)fail('weekly_budget_migration_revision_changed');
}

/** Only repairs a historical task-budget derivation. It never binds a local
 * consumer or carries old execution into the fresh immutable task graph. */
export async function prepareWeeklyBudgetPolicyMigration(store:DataStore,scope:Scope,ports:Ports={}):Promise<WeeklyBudgetPolicyMigrationReceipt>{
 return withExecutionPackageGate(store,scope,async assert=>{
  const now=ports.now??(()=>new Date().toISOString());
  const packageRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:scope.packageVersion});
  if(packageRows.length!==1)fail('weekly_budget_migration_source_missing');
  const source=packageRows[0]!.payload as WeeklyOperatingPackage;
  const sourceTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,scope.packageVersion);
  const weekly=source.socialContentPackage.weeklyBudgetCny,perItem=source.socialContentPackage.perItemBudgetCny;
  if(source.version!==scope.packageVersion||typeof weekly!=='number'||!Number.isFinite(weekly)||typeof perItem!=='number'||!Number.isFinite(perItem)||perItem<=0||perItem>WEEKLY_AUTOMATION_TEMPLATE.perFinishedVideoMaxCny||source.socialContentPackage.authorization.allowRealPublishing||!sourceTasks.length||sourceTasks.some(hasWeeklyInitialExecution))fail('weekly_budget_migration_source_ineligible');
  const weeklyBudgetCny=weekly as number,perItemBudgetCny=perItem as number;
  const oldOverBudget=sourceTasks.filter(t=>productionKinds.has(t.schedule.stepKind)&&t.budget.category==='production'&&t.budget.limitCny!==null&&t.budget.limitCny>perItemBudgetCny);
  if(!oldOverBudget.length)fail('weekly_budget_migration_no_legacy_budget');
  const all=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId});
  if(all.some(row=>(row.payload as WeeklyOperatingPackage).weekStart>source.weekStart))fail('weekly_budget_migration_historical_week');
  const frozenHash=socialRequestHash(source),frozenTasks=taskHash(sourceTasks);
  const where={tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion};
  let found=(await rows(store,WEEKLY_BUDGET_POLICY_MIGRATIONS,where)).map(checked);
  if(found.length>1)fail('weekly_budget_migration_receipt_ambiguous');
  let receipt=found[0]??null;
  if(!receipt){
   const latest=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
   if(latest?.payload.version!==scope.packageVersion)fail('weekly_budget_migration_source_not_latest');
   const id=socialRequestHash({schemaVersion:'weekly-budget-policy-migration.v1',scope,sourcePackageHash:frozenHash,sourceTaskHash:frozenTasks,policy:POLICY}).slice(0,32);
   const createdAt=now();const value=seal({schemaVersion:'weekly-budget-policy-migration.v1',migrationId:id,source:scope,sourceWeekStart:source.weekStart,sourcePackageHash:frozenHash,sourceTaskHash:frozenTasks,weeklyBudgetCny,perItemBudgetCny,policy:POLICY,state:'planned',revisedVersion:null,targetVersion:null,createdAt,updatedAt:createdAt});
   await assert();const saved=await store.create(WEEKLY_BUDGET_POLICY_MIGRATIONS,{id,tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,state:value.state,record_hash:value.recordHash,payload:value,created_at:createdAt,updated_at:createdAt});
   if(!saved){const raced=await store.getById<Record_>(WEEKLY_BUDGET_POLICY_MIGRATIONS,id);if(!raced||checked(raced).recordHash!==value.recordHash)fail('weekly_budget_migration_receipt_write_failed');}
   receipt=value;
  }
  if(receipt.sourcePackageHash!==frozenHash||receipt.sourceTaskHash!==frozenTasks||receipt.weeklyBudgetCny!==weeklyBudgetCny||receipt.perItemBudgetCny!==perItemBudgetCny||receipt.sourceWeekStart!==source.weekStart||socialRequestHash(receipt.source)!==socialRequestHash(scope))fail('weekly_budget_migration_source_changed');
  const marker=`weekly-budget-policy-migration:${receipt.migrationId}`;
  let revisedVersion=receipt.revisedVersion;
  if(!revisedVersion){
   const latest=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
   if(latest?.payload.version===scope.packageVersion){
    await assert();revisedVersion=ports.revise?await ports.revise(scope,marker):(await createWeeklyOperatingPackageService(store).revise(scope.tenantId,scope.actorUserId,scope.programId,scope.packageId,{expectedVersion:scope.packageVersion,changeReason:`按已确认单条 ${perItemBudgetCny} 元上限重新派生任务预算；${marker}；不扩大周预算或对外权限`})).version;
   }else{
    const recovered=all.map(row=>row.payload as WeeklyOperatingPackage).filter(pkg=>pkg.packageId===scope.packageId&&pkg.previousVersion===scope.packageVersion&&String(pkg.changeReason??'').includes(marker));
    if(recovered.length!==1)fail('weekly_budget_migration_revision_unknown');
    revisedVersion=recovered[0]!.version;
   }
   await assert();receipt=await persist(store,receipt,{state:'revised',revisedVersion,targetVersion:null},now());
  }
  const revisedRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:revisedVersion});
  if(revisedRows.length!==1)fail('weekly_budget_migration_revision_missing');
  const revised=revisedRows[0]!.payload as WeeklyOperatingPackage;
  assertRevision(source,revised,marker,revisedVersion);
  const revisedTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,revisedVersion);
  if(revisedTasks.some(t=>sourceTasks.some(old=>old.taskId===t.taskId))||productionShape(revisedTasks)!==productionShape(sourceTasks))fail('weekly_budget_migration_old_execution_reused');
  assertNewTaskBudget(revisedTasks,perItemBudgetCny);
  if(['schedule_blocked','activating_independent','independent_active','scheduled'].includes(receipt.state))return receipt;
  const revisedScope={...scope,packageVersion:revisedVersion};
  const latest=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
  const headVersion=latest?.payload.version;
  if(typeof headVersion!=='number'||headVersion<revisedVersion||headVersion>revisedVersion+1)fail('weekly_budget_migration_schedule_head_changed');
  await assert();
  const scheduled=headVersion===revisedVersion+1
   ?await (ports.recoverSchedule?ports.recoverSchedule(revisedScope):recoverCommittedAutomaticWeeklySchedule(store,revisedScope))
   :ports.schedule?await ports.schedule(revisedScope):await createWeeklyAutomaticScheduleService(store).apply(revisedScope) as {status:'scheduled'|'blocked';targetVersion:number|null};
  if(!scheduled)fail('weekly_budget_migration_schedule_recovery_missing');
  const scheduleResult=scheduled as {status:string;targetVersion:number|null};
  if(scheduleResult.status==='blocked'&&scheduleResult.targetVersion===null){await assert();return persist(store,receipt,{state:'schedule_blocked',revisedVersion,targetVersion:null},now());}
  if(scheduleResult.status!=='scheduled'||scheduleResult.targetVersion!==revisedVersion+1)fail('weekly_budget_migration_schedule_invalid');
  const scheduledTargetVersion=scheduleResult.targetVersion as number;
  const targetRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:scheduledTargetVersion});
  if(targetRows.length!==1)fail('weekly_budget_migration_schedule_target_missing');
  const target=targetRows[0]!.payload as WeeklyOperatingPackage;
  if(target.previousVersion!==revisedVersion||target.socialContentPackage.weeklyBudgetCny!==weeklyBudgetCny||target.socialContentPackage.perItemBudgetCny!==perItemBudgetCny||target.socialContentPackage.authorization.allowRealPublishing)fail('weekly_budget_migration_schedule_target_changed');
  const targetTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,target.version);
  if(productionShape(targetTasks)!==productionShape(sourceTasks))fail('weekly_budget_migration_schedule_graph_changed');
  assertNewTaskBudget(targetTasks,perItemBudgetCny);
  await assert();return persist(store,receipt,{state:'scheduled',revisedVersion,targetVersion:target.version},now());
 });
}

/** Explicit second stage for a blocked whole-graph schedule. Its scoped
 * connector does not initiate a global restore scan, but the final target scan
 * can call suppliers. An already-running normal background timer is separate.
 * This is not a read-only eligibility check or a no-cost registration step.
 * Callers must separately establish provider and same-day quota readiness. */
export async function activateWeeklyBudgetIndependentPreproduction(store:DataStore,scope:Scope,ports:Ports={}):Promise<WeeklyBudgetPolicyMigrationReceipt>{
 return withExecutionPackageGate(store,scope,async assert=>{
  const now=ports.now??(()=>new Date().toISOString());
  const where={tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion};
  const found=(await rows(store,WEEKLY_BUDGET_POLICY_MIGRATIONS,where)).map(checked);
  if(found.length!==1)fail('weekly_budget_migration_receipt_missing_or_ambiguous');
  let receipt=found[0]!;
  if(receipt.state==='independent_active')return receipt;
  if(!['schedule_blocked','activating_independent'].includes(receipt.state)||!receipt.revisedVersion||receipt.targetVersion!==null)fail('weekly_budget_migration_independent_state_invalid');
  const revisedVersion=receipt.revisedVersion as number,revisedScope={...scope,packageVersion:revisedVersion};
  const sourceRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:scope.packageVersion});
  const revisedRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:revisedVersion});
  if(sourceRows.length!==1||revisedRows.length!==1)fail('weekly_budget_migration_revision_missing');
  const source=sourceRows[0]!.payload as WeeklyOperatingPackage,revised=revisedRows[0]!.payload as WeeklyOperatingPackage;
  const sourceTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,scope.packageVersion);
  const revisedTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,revisedVersion);
  const latest=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
  if(latest?.payload.version!==revisedVersion||socialRequestHash(receipt.source)!==socialRequestHash(scope)||receipt.sourcePackageHash!==socialRequestHash(source)||receipt.sourceTaskHash!==taskHash(sourceTasks)||receipt.sourceWeekStart!==source.weekStart||receipt.weeklyBudgetCny!==source.socialContentPackage.weeklyBudgetCny||receipt.perItemBudgetCny!==source.socialContentPackage.perItemBudgetCny)fail('weekly_budget_migration_source_changed');
  assertRevision(source,revised,`weekly-budget-policy-migration:${receipt.migrationId}`,revisedVersion);
  if(revised.status!=='draft'||revisedTasks.some(task=>sourceTasks.some(old=>old.taskId===task.taskId))||productionShape(revisedTasks)!==productionShape(sourceTasks))fail('weekly_budget_migration_independent_graph_changed');
  const alreadyExecuted=revisedTasks.some(hasWeeklyInitialExecution);
  if(receipt.state==='schedule_blocked'&&alreadyExecuted)fail('weekly_budget_migration_independent_graph_changed');
  if(receipt.state==='activating_independent'&&revisedTasks.some(task=>!['business_outline','benchmark_collection'].includes(task.schedule.stepKind)&&hasWeeklyInitialExecution(task)))fail('weekly_budget_migration_non_independent_execution');
  if(receipt.state==='activating_independent'&&(!receipt.activationGraphHash||receipt.activationGraphHash!==activationGraphHash(revisedTasks)))fail('weekly_budget_migration_independent_graph_changed');
  assertNewTaskBudget(revisedTasks,receipt.perItemBudgetCny);
  const independentTasks=revisedTasks.filter(task=>['business_outline','benchmark_collection'].includes(task.schedule.stepKind));
  if(independentTasks.filter(task=>task.schedule.stepKind==='business_outline').length!==1||!independentTasks.some(task=>task.schedule.stepKind==='benchmark_collection'))fail('weekly_budget_migration_independent_graph_invalid');
  const admitted=ports.blockedAdmission?await ports.blockedAdmission(revisedScope):await (async()=>{
   const schedules=await rows(store,AUTOMATIC_WEEKLY_SCHEDULES,{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:revisedVersion});
   const schedule=schedules[0]?.payload as {status?:string;targetVersion?:number|null}|undefined;
   if(schedules.length!==1||schedule?.status!=='blocked'||schedule.targetVersion!==null||schedules[0]!.content_hash!==socialRequestHash(schedule))return false;
   const checks=await Promise.all(independentTasks.map(task=>readWeeklyAutomaticPreproductionAdmission(store,task,now())));
   return checks.every(check=>check?.eligible===true&&check.authority==='independent_preproduction_window_only'&&check.userApproval===null&&check.outboundAuthorization===false&&check.proposalId===checks[0]?.proposalId);
  })();
  if(!admitted)fail('weekly_budget_migration_independent_admission_missing');
  const adoption=await readWeeklyAutomationTemplate(store,revisedScope);
  if(!adoption||adoption.userApproval!==null||adoption.template.perFinishedVideoMaxCny!==receipt.perItemBudgetCny||adoption.template.outboundAuthorization!==false)fail('weekly_budget_migration_template_adoption_missing');
  // Diagnostic only. The producer rechecks and reserves under the durable quota
  // lease before every paid crawl; zero quota must never be promoted to a new
  // grant merely because this independent branch is activated. Same-day
  // supplement/cross-day continuation retain their separate durable gates.
  const capacity=await readDailyCollectionCapacity(store,{tenantId:scope.tenantId,runId:`weekly-budget-independent:${receipt.migrationId}`,now:new Date(now())});
  if(capacity.kind!=='normal_daily_window'||!Number.isSafeInteger(capacity.remainingCount)||capacity.remainingCount<0)fail('weekly_budget_migration_collection_capacity_invalid');
  if(receipt.state==='schedule_blocked'){
   await assert();receipt=await persist(store,receipt,{state:'activating_independent',revisedVersion,targetVersion:null,activationGraphHash:activationGraphHash(revisedTasks)},now());
  }
  await assert();
  if(alreadyExecuted){
   // A scan can settle the outline before the final migration write. Never
   // rebind a completed consumer: validate its exact durable authority and
   // resume the registered scope instead of creating a second provider run.
   const admission=await readIndependentAdmission(store,revisedScope);
   const admissionRow=await store.getById<Record_>(WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId(revisedScope));
   const consumers=await rows(store,LOCAL_WEEKLY_CONSUMERS,{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:revisedVersion});
   const jobs=(await listWeeklyPreproductionJobs({store,tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:revisedVersion})).filter(job=>job.originalRunKey===`weekly-preproduction:${job.jobId}`);
   if(!admission||!admissionRow||admission.actorUserId!==scope.actorUserId||consumers.length!==1||consumers[0]!.id!==independentAdmissionId(revisedScope)||socialRequestHash(consumers[0]!.payload)!==socialRequestHash(revisedScope)||jobs.length!==independentTasks.length||independentTasks.some(task=>jobs.filter(job=>job.consumerTaskId===task.taskId&&job.consumerInputHash===supplementConsumerHash(task)&&job.actorUserId===scope.actorUserId&&job.kind===(task.schedule.stepKind==='business_outline'?'outline':'discovery')).length!==1))fail('weekly_budget_migration_recovery_authority_missing');
   if(ports.resumeScan)await ports.resumeScan(revisedScope);
   else await createWeeklyExecutionPipelineService(store).scanScopedLocalConsumer(revisedScope);
  }else if(ports.bind)await ports.bind(revisedScope);
  else{
   const discovery=await uniqueApprovedWeeklyDiscoveryAuthority(store,scope.tenantId);
   if(!discovery)fail('weekly_budget_migration_discovery_authority_missing');
   await connectAndBindWeeklyAutomaticSchedule(store,revisedScope,discovery,'scoped');
  }
  await assert();return persist(store,receipt,{state:'independent_active',revisedVersion,targetVersion:null},now());
 });
}
