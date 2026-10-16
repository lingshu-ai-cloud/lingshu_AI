import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyScheduleCapacityInput} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import {WEEKLY_AUTOMATION_TEMPLATE as template} from '../../shared/weeklyAutomationTemplate.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {assertWeeklyScheduleActor} from './weeklyScheduleActor.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {hasWeeklyInitialExecution} from './weeklyInitialExecution.js';
import {createWeeklyScheduleRevisionService} from './socialWeeklyScheduleRevisions.js';
import {listContentExecutionLimits,setContentExecutionLimit} from '../contentExecution/durableQueue.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {SocialProgramError} from './service.js';
import {SCHEDULE_PROPOSALS,scheduleHash} from './weeklyScheduleSnapshots.js';
import {weeklyContinuationInputHash,createWeeklyExecutionContinuationService} from './weeklyExecutionContinuations.js';
import type {WeeklyScheduleProposal} from '../../shared/contracts/socialWeeklyScheduleRevision.js';

type Scope={tenantId:string;programId:string;packageId:string;packageVersion:number;actorUserId:string};
export const AUTOMATIC_WEEKLY_SCHEDULES='social_weekly_automatic_schedules';
const fail=(code:string):never=>{throw new SocialProgramError(code,409,code);};
const plusDay=(date:string,days:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

/** Independent preproduction consumes the adopted task window even when an
 * unrelated publication deadline makes the complete package infeasible. This
 * is scheduling eligibility only; factual inputs, source rights, dependencies,
 * provider readiness and collection quantity limits remain executor gates. */
export async function readWeeklyAutomaticPreproductionAdmission(store:DataStore,task:WeeklyExecutionTask,now:string){
 if(!['business_outline','benchmark_collection'].includes(task.schedule.stepKind))return null;
 if(!Number.isFinite(Date.parse(now)))return null;
 const scopes={tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion};
 const records:Record_[]=[];
 for(let page=1;;page++){
  const rows=await store.list<Record_>(AUTOMATIC_WEEKLY_SCHEDULES,{where:scopes,page,perPage:250,sort:'id'});
  if(!Number.isSafeInteger(rows.totalPages)||!Number.isSafeInteger(rows.totalItems)||rows.totalPages<1)fail('weekly_template_schedule_pagination_invalid');
  records.push(...rows.items);if(page>=rows.totalPages){if(records.length!==rows.totalItems)fail('weekly_template_schedule_pagination_invalid');break;}
  if(!rows.items.length)fail('weekly_template_schedule_pagination_invalid');
 }
 for(const row of records.reverse()){
  const receipt=row.payload as {proposalId:string;source:string;userApproval:null;templateVersion:string};
  if(row.content_hash!==socialRequestHash(receipt)||receipt.source!=='automatic_template'||receipt.userApproval!==null||receipt.templateVersion!==template.version)fail('weekly_template_schedule_receipt_invalid');
  const proposals=await store.list<Record_>(SCHEDULE_PROPOSALS,{where:{...scopes,proposal_id:receipt.proposalId},perPage:2});
  if(proposals.totalItems!==1||proposals.items.length!==1)fail('weekly_template_schedule_proposal_missing');
  const stored=proposals.items[0],proposal=stored.payload as WeeklyScheduleProposal;
  if(stored.content_hash!==scheduleHash(proposal)||proposal.tenantId!==task.tenantId||proposal.programId!==task.programId||proposal.packageId!==task.packageId||proposal.packageVersion!==task.packageVersion||proposal.inputAuthority!=='target_graph_with_automatic_template_capacity'||proposal.automaticAdoption?.userApproval!==null||proposal.automaticAdoption.source!=='automatic_template'||proposal.automaticAdoption.templateVersion!==template.version)fail('weekly_template_schedule_proposal_invalid');
  const projected=proposal.targetGraph?.tasks.find(t=>t.taskId===task.taskId),constraint=proposal.capacity.constraints[task.taskId];
  if(!projected||!constraint||weeklyContinuationInputHash(projected)!==weeklyContinuationInputHash(task))continue;
  const limits=await listContentExecutionLimits(store,task.tenantId);
  if(!limits.some(l=>l.scope==='tenant'&&l.scopeKey==='*'&&l.maxRunning<=template.productionConcurrency)||!limits.some(l=>l.scope==='task_type'&&l.scopeKey==='social_content_weekly'&&l.maxRunning<=template.productionConcurrency))return null;
  const availableAt=constraint.availableAt;
  return {source:'automatic_template' as const,templateVersion:template.version,proposalId:proposal.proposalId,availableAt,eligible:Date.parse(now)>=Date.parse(availableAt),authority:'independent_preproduction_window_only' as const,userApproval:null,outboundAuthorization:false as const};
 }
 return null;
}

/** Conservative planning assumptions, not measured throughput, provider quotes,
 * delivery, approval, or outbound authorization. Existing execution is never
 * assigned zero remaining work/cost: it must use verified continuation evidence. */
export function automaticWeeklyCapacity(pkg:WeeklyOperatingPackage,tasks:WeeklyExecutionTask[],now:string,verifiedCompletedPreproductionIds:ReadonlySet<string>=new Set()):WeeklyScheduleCapacityInput {
 if(!Number.isFinite(Date.parse(now)))fail('weekly_template_clock_invalid');
 if(pkg.socialContentPackage.productionIdentityVersion!=='shared-original.v1')fail('weekly_template_shared_production_identity_required');
 const blockedPreproductionForecast=(task:WeeklyExecutionTask)=>task.schedule.stepKind==='benchmark_collection'&&task.status==='blocked'&&task.attempt===0&&!task.lease&&!task.resultRefs.length&&!task.schedule.actualFinishedAt&&!task.productionProgress&&task.lastError?.code==='business_dispatch_required'&&task.ownBlockingReasons.length===1&&task.ownBlockingReasons[0]==='business_dispatch_required';
 // A dispatch preflight timestamp is retained as history, not reinterpreted as
 // zero work. The conservative planner still reports started_work_requires_
 // verified_continuation; this merely permits forecasting the other branches.
 if(tasks.some(task=>hasWeeklyInitialExecution(task)&&!blockedPreproductionForecast(task)&&!(['business_outline','benchmark_collection'].includes(task.schedule.stepKind)&&task.status==='succeeded'&&task.budget.category!=='production'&&verifiedCompletedPreproductionIds.has(task.taskId))))fail('weekly_template_existing_work_requires_reconciliation');
 const windows:Array<{startAt:string;finishAt:string}>=[],resident:Array<{startAt:string;finishAt:string}>=[];
 for(let date=pkg.weekStart;date<=pkg.weekEnd;date=plusDay(date,1)){
  const finishAt=`${plusDay(date,1)}T00:00:00+08:00`;
  if(Date.parse(finishAt)<=Date.parse(now))continue;
  windows.push({startAt:new Date(Math.max(Date.parse(now),Date.parse(`${date}T06:00:00+08:00`))).toISOString(),finishAt});
  resident.push({startAt:new Date(Math.max(Date.parse(now),Date.parse(`${date}T00:00:00+08:00`))).toISOString(),finishAt});
 }
 if(!windows.length)fail('weekly_template_week_expired_requires_explicit_carryover');
 const resources:WeeklyScheduleCapacityInput['resources']={};
 const constraints:WeeklyScheduleCapacityInput['constraints']={},operationalDeadlines:Record<string,string>={};
 const productionRoots=new Set<string>();
 const rootDays=new Map<string,string>();
 for(const publication of pkg.socialContentPackage.publicationTasks){
  const root=publication.motherContentId,date=publication.publishWindow?.slice(0,10);
  if(root&&date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&(!rootDays.has(root)||date<rootDays.get(root)!))rootDays.set(root,date);
 }
 for(const task of tasks){
  const actor=task.schedule.responsibleActor,key=`template:${actor}`;
  resources[key]??={concurrency:actor==='customer_agent'?1:template.productionConcurrency,workingWindows:actor==='customer_agent'?resident:windows};
  // Reserve the whole film ceiling only once for each shared production root.
  // This is not an assertion that unpaid stages incur no cost: all stages and
  // revisions consume that same film budget in the existing production ledger.
  let reserve=0;
  if(task.schedule.stepKind==='video_generation'){
   const pub=pkg.socialContentPackage.publicationTasks.find(p=>p.publicationTaskId===task.publicationTaskId);
   const root=pub?.motherContentId;
   if(!root)fail('weekly_template_production_root_missing');
   if(!productionRoots.has(root!)){reserve=template.perFinishedVideoMaxCny;productionRoots.add(root!);}
  }
  const publication=pkg.socialContentPackage.publicationTasks.find(p=>p.publicationTaskId===task.publicationTaskId);
  const localDay=typeof task.inputSnapshot.rollingDate==='string'?task.inputSnapshot.rollingDate:(publication?.motherContentId?rootDays.get(publication.motherContentId):null)??pkg.weekStart;
  const eligible=Date.parse(`${localDay??pkg.weekStart}T${actor==='customer_agent'?'00':'06'}:00:00+08:00`);
  constraints[task.taskId]={resourceKey:key,remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:reserve,bufferMinutes:0,availableAt:new Date(Math.max(Date.parse(now),eligible)).toISOString()};
  if(['business_schedule','performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)){
   const today=new Date(Date.parse(now)+8*3600000).toISOString().slice(0,10);
   const day=['business_schedule','performance_monitoring'].includes(task.schedule.stepKind)?(localDay<today?today:localDay):pkg.weekEnd;
   operationalDeadlines[task.taskId]=`${day}T23:59:59+08:00`;
  }
 }
 return {constraints,resources,operationalDeadlines,remainingBudgetCny:Math.min(pkg.socialContentPackage.weeklyBudgetCny??template.originalVideosPerWeek*template.perFinishedVideoMaxCny,template.originalVideosPerWeek*template.perFinishedVideoMaxCny)};
}

/** Server-owned adoption and real durable queue limit configuration. The normal
 * revision service still verifies leases, unknown receipts, queue identity and
 * complete feasibility before freezing anything. A blocked proposal is retained
 * with its actual reasons; never rewrite a historical deadline to claim success. */
export function createWeeklyAutomaticScheduleService(store:DataStore,ports:{now?:()=>string}={}){
 return {async apply(a:Scope){
  await assertWeeklyScheduleActor(store,a);
  const now=ports.now?.()??new Date().toISOString();
  let id='';
  const prepared=await withExecutionPackageGate(store,a,async()=>{
   const row=await latestPackageRow(store,a.tenantId,a.programId,a.packageId);
   if(row?.payload.version!==a.packageVersion)fail('weekly_template_schedule_version_conflict');
   const pkg=row!.payload,tasks=await listWeeklyExecutionTasks(store,a.tenantId,a.programId,a.packageId,a.packageVersion);
   if(pkg.status!=='draft'||pkg.socialContentPackage.authorization.allowRealPublishing)fail('weekly_template_schedule_requires_unapproved_draft');
   const evidence=await createWeeklyExecutionContinuationService(store).derivePlannerEvidence(a,now);
   const verifiedCompletedPreproductionIds=new Set(tasks.filter(task=>['business_outline','benchmark_collection'].includes(task.schedule.stepKind)&&evidence.completedEvidence[task.taskId]).map(task=>task.taskId));
   const capacity=automaticWeeklyCapacity(pkg,tasks,now,verifiedCompletedPreproductionIds);
   const adoption=await adoptWeeklyAutomationTemplate(store,a,a.actorUserId);
   const limits=await listContentExecutionLimits(store,a.tenantId);
   // Keep every stricter existing limit; do not raise account/platform limits.
   for(const [scope,scopeKey] of [['tenant','*'],['task_type','social_content_weekly']] as const){
    const old=limits.find(l=>l.scope===scope&&l.scopeKey===scopeKey);
    if(!old||old.maxRunning>template.productionConcurrency)await setContentExecutionLimit({dataStore:store,tenantId:a.tenantId,scope,scopeKey,maxRunning:template.productionConcurrency,updatedBy:`automatic_template:${template.version}:${a.actorUserId}`,now:new Date(now)});
   }
   // Account production concurrency is conservatively one unless an existing
   // stricter/equivalent configuration exists. This does not alter publish API
   // throttles or grant connection permissions.
   for(const accountId of new Set(pkg.socialContentPackage.publicationTasks.map(p=>p.accountId))){
    if(!limits.some(l=>l.scope==='account'&&(l.scopeKey===accountId||l.scopeKey==='*')))await setContentExecutionLimit({dataStore:store,tenantId:a.tenantId,scope:'account',scopeKey:accountId,maxRunning:1,updatedBy:`automatic_template:${template.version}:${a.actorUserId}`,now:new Date(now)});
   }
   id=createHash('sha256').update(socialRequestHash([a.tenantId,a.programId,a.packageId,a.packageVersion,template.version,tasks,await listContentExecutionLimits(store,a.tenantId)])).digest('hex');
   const existing=await store.getById<Record_>(AUTOMATIC_WEEKLY_SCHEDULES,id);
   if(existing){if(existing.content_hash!==socialRequestHash(existing.payload))fail('weekly_template_schedule_receipt_invalid');return {receipt:existing.payload as Record<string,unknown>};}
   return {capacity,adoption,verifiedCompletedPreproductionIds};
  });
  if('receipt' in prepared)return prepared.receipt;
  const automaticAdoption={source:'automatic_template' as const,templateVersion:template.version,adoptedAt:prepared.adoption.adoptedAt,userApproval:null};
  const scheduling=createWeeklyScheduleRevisionService(store,{now:()=>now,automaticAdoption});
  const graph=await scheduling.preview(a);
  // Build against the complete projected graph so new material/quality nodes
  // are not silently omitted from the adopted capacity constraints.
  const pkg=(await latestPackageRow(store,a.tenantId,a.programId,a.packageId))!.payload;
  const capacity=automaticWeeklyCapacity(pkg,graph.tasks,now,prepared.verifiedCompletedPreproductionIds);
  const proposal=await scheduling.propose(a,capacity);
  const blockers=proposal.plan.assignments.filter(r=>!r.startAt||r.reasons.some(reason=>reason!=='human_completion_not_verified')).map(r=>({taskId:r.taskId,reasons:r.reasons}));
  const feasible=proposal.plan.publicationGap===0&&blockers.length===0;
  const confirmation=feasible?await scheduling.confirm(a,{proposalId:proposal.proposalId,expectedVersion:a.packageVersion,inputEvidenceHash:proposal.inputEvidenceHash,confirmedTemplateCarryoverPlanHashes:(proposal.templateCarryovers??[]).map(p=>p.planHash)}):null;
  const payload={scope:{tenantId:a.tenantId,programId:a.programId,packageId:a.packageId,packageVersion:a.packageVersion},...automaticAdoption,proposalId:proposal.proposalId,status:confirmation?'scheduled':'blocked',targetVersion:confirmation?.item.version??null,blockers,acceptance:{originalVideos:5,platforms:template.sharedPublicationPlatforms,perFilmIncludingRevisionsMaxCny:15,requiresRealArtifact:true,requiresProductionPageAcceptance:true},activated:false,outboundAuthorization:false};
  const saved=await store.create(AUTOMATIC_WEEKLY_SCHEDULES,{id,tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload,content_hash:socialRequestHash(payload)});
  if(!saved)fail('weekly_template_schedule_receipt_write_failed');
  return payload;
 }};
}
