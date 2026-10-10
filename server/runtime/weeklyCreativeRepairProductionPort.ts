import type {CreateSocialContentTaskInput,SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyAgentPlanningState} from '../../shared/contracts/socialProgram.js';
import type {WeeklyCreativeRepairCapacityPreview,WeeklyCreativeRepairChildExecution} from '../../shared/contracts/weeklyCreativeRepairExecution.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {createStarter198OrchestratorQueue} from '../starter198/orchestratorQueue.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from '../starter198/repository.js';
import {readSocialTaskDetail,requireSocialTask} from '../starter198/socialContentRecords.js';
import {enqueueSocialContentAutoProduction} from '../starter198/socialContentProductionQueue.js';
import {addSocialTaskSource,createSocialContentTask,startSocialContentTask} from '../starter198/socialContentTasks.js';
import {assertSocialTaskCapacity} from '../starter198/socialContentLimits.js';
import {socialJson,socialObject,socialRequestHash,SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
import {inspectWeeklyCreativeRepairAuthority,issueWeeklyCreativeRepairAuthority} from './weeklyCreativeRepairAuthority.js';
import {readWeeklyReferenceSources,weeklyReferenceResolver} from './socialWeeklyReferenceSource.js';
import type {WeeklyCreativeRepairProductionPort} from '../socialPrograms/weeklyCreativeRepairExecution.js';

export const WEEKLY_CREATIVE_REPAIR_CAPACITY_RESERVATIONS='social_weekly_creative_repair_capacity_reservations';

interface CapacityReservation {
 schemaVersion:'weekly-creative-repair-capacity.v1';version:1;tenantId:string;caseId:string;
 caseRecordHash:string;configurationHash:string;previewHash:string;authorityHash:string;
 reservationId:string;startIdempotencyKey:string;localOnly:boolean;quoteHash:string|null;
 authorizedMaximumCostCny:number;reservedAt:string;expiresAt:string;recordHash:string;
}

const id=(value:string)=>/^[a-zA-Z0-9._:@-]{1,240}$/.test(value);
const fail=(code:string,status=409):never=>{throw new SocialContentWorkflowError(`weekly_creative_repair_port_${code}`,status);};
const childId=(tenantId:string,caseId:string)=>`creative-repair-${socialRequestHash([tenantId,caseId]).slice(0,32)}`;
const reservationId=(tenantId:string,caseId:string,configurationHash:string)=>`creative-capacity-${socialRequestHash([tenantId,caseId,configurationHash]).slice(0,32)}`;
const seal=<T extends Omit<CapacityReservation,'recordHash'>>(body:T):CapacityReservation=>({...body,recordHash:socialRequestHash(body)});

async function exact(store:DataStore,collection:string,where:Record<string,string|number>){const rows=await store.list<Record_>(collection,{where,perPage:2});if(rows.totalItems!==rows.items.length||rows.items.length>1)fail('record_ambiguous',503);return rows.items[0]??null;}
function decodeReservation(row:Record_):CapacityReservation{const raw=socialObject(socialJson(row.payload));if(!raw||raw.schemaVersion!=='weekly-creative-repair-capacity.v1'||raw.version!==1||row.content_hash!==socialRequestHash(raw))return fail('capacity_corrupt',503);const value=raw as unknown as CapacityReservation,{recordHash,...body}=value;if(recordHash!==socialRequestHash(body)||row.tenant_id!==value.tenantId||row.case_id!==value.caseId||row.reservation_id!==value.reservationId)fail('capacity_corrupt',503);return value;}

function childInput(parent:SocialContentTaskDetail,configuration:{revisionScope:string;deadlineAt:string;maximumCostCny:number},feedback:string):CreateSocialContentTaskInput{
 const b=parent.brief;
 return{title:`${b.title} · 创意返工`,objective:`按已确认反馈修订原成片：${configuration.revisionScope}`,productId:b.productId,productRef:b.productRef,requestedPresenterName:b.requestedPresenterName,requestedPresenterAssetId:b.requestedPresenterAssetId,presenterAssetId:b.presenterAssetId,audience:b.audience,markets:b.markets,languages:b.languages,platforms:b.platforms,formats:b.formats,aspectRatio:b.aspectRatio,cadence:b.cadence,requestedOutputCount:1,weeklyBudgetCny:b.weeklyBudgetCny,perItemBudgetCny:configuration.maximumCostCny,retryReserveCny:0,planningMode:'fixed',shootingWindowMinutes:b.shootingWindowMinutes,specialRequirements:[`仅执行已冻结创意返工范围：${configuration.revisionScope}`,`用户原始反馈：${feedback}`,`原内容任务：${parent.taskId}`].join('\n'),dueAt:configuration.deadlineAt,brandNotes:b.brandNotes,restrictions:b.restrictions,callToAction:b.callToAction,programRef:b.programRef,targetAccountRef:b.targetAccountRef,accountPlaybookRef:b.accountPlaybookRef,referenceMode:b.referenceMode,primaryExperimentVariable:b.primaryExperimentVariable,creationMode:b.creationMode,assetAvailability:b.assetAvailability,managementMode:'one_click_managed',productionMode:'social_ready',productionApproach:b.productionApproach,mode:'weekly',weeklyPlanId:parent.weeklyPlanId,themeId:parent.theme?.themeId??'product_value'};
}

/** Production adapter backed by the same Starter198 task, workflow run and
 * durable content queue used by ordinary weekly production. */
export function createWeeklyCreativeRepairProductionPort(store:DataStore,clock:()=>Date=()=>new Date()):WeeklyCreativeRepairProductionPort{
 const repository=createStarter198Repository(store);
 async function preview(input:Parameters<WeeklyCreativeRepairProductionPort['preview']>[0]):Promise<WeeklyCreativeRepairCapacityPreview>{
  await assertSocialTaskCapacity({repository,tenantId:input.case.tenantId});
  const authority=await inspectWeeklyCreativeRepairAuthority({store,tenantId:input.case.tenantId,caseId:input.case.caseId,expectedCaseHash:input.case.recordHash,expectedConfigurationHash:input.configuration.recordHash,now:clock()});
  const now=clock().getTime(),windowEnd=Math.floor(now/(5*60_000))*(5*60_000)+5*60_000;
  const availableUntil=new Date(Math.min(windowEnd,Date.parse(input.configuration.deadlineAt))).toISOString();
  if(Date.parse(availableUntil)<=clock().getTime())fail('capacity_expired');
  const localOnly=input.configuration.maximumCostCny===0;
  const quoteHash=localOnly?null:socialRequestHash({schemaVersion:'weekly-creative-repair-quote.v1',tenantId:input.case.tenantId,caseId:input.case.caseId,configurationHash:input.configuration.recordHash,maximumCostCny:input.configuration.maximumCostCny,availableUntil});
  const body={caseId:input.case.caseId,caseRecordHash:input.case.recordHash,configurationHash:input.configuration.recordHash,authorityHash:authority.originalAuthorityHash,estimatedDurationMinutes:input.configuration.estimatedDurationMinutes,maximumCostCny:input.configuration.maximumCostCny,localOnly,quoteHash,availableUntil};
  return{...body,previewHash:socialRequestHash(body)};
 }
 async function readReservation(tenantId:string,caseId:string){const row=await exact(store,WEEKLY_CREATIVE_REPAIR_CAPACITY_RESERVATIONS,{tenant_id:tenantId,case_id:caseId});return row?decodeReservation(row):null;}
 async function findStarted(input:{tenantId:string;bindingKey:string}){
  const rows=await repository.list(STARTER_COLLECTIONS.socialContentTasks,input.tenantId,{where:{create_idempotency_key:input.bindingKey},perPage:2});
  if(rows.totalItems!==rows.items.length||rows.items.length>1)fail('child_ambiguous',503);if(!rows.items.length)return null;
  const row=rows.items[0]!,taskId=String(row.task_id??''),runId=String(row.run_id??'');if(!id(taskId))fail('child_corrupt',503);if(!runId)return{status:'unknown' as const};
  const jobs=await store.list<Record_>('content_execution_jobs',{where:{tenant_id:input.tenantId,task_id:taskId,run_id:runId},perPage:2});
  if(jobs.totalItems!==jobs.items.length||jobs.items.length>1)fail('job_ambiguous',503);if(!jobs.items.length)return{status:'unknown' as const};
  const job=jobs.items[0]!;if(!id(runId)||!id(String(job.id))||job.tenant_id!==input.tenantId||job.task_id!==taskId||job.run_id!==runId||!String(job.task_type??'').startsWith('social_content_'))fail('job_corrupt',503);
  return{status:'started' as const,childTaskId:taskId,childBindingKey:input.bindingKey,runId,jobId:String(job.id)};
 }
 return{preview,
  async confirmCapacity(input){
   const fresh=await preview(input);if(fresh.previewHash!==input.preview.previewHash||fresh.authorityHash!==input.preview.authorityHash||fresh.quoteHash!==input.preview.quoteHash||input.authorizedMaximumCostCny<0||input.authorizedMaximumCostCny>input.configuration.maximumCostCny||(fresh.localOnly&&input.authorizedMaximumCostCny!==0))fail('preview_changed');
   const rid=reservationId(input.case.tenantId,input.case.caseId,input.configuration.recordHash),existing=await readReservation(input.case.tenantId,input.case.caseId);
   const now=clock().toISOString(),body={schemaVersion:'weekly-creative-repair-capacity.v1' as const,version:1 as const,tenantId:input.case.tenantId,caseId:input.case.caseId,caseRecordHash:input.case.recordHash,configurationHash:input.configuration.recordHash,previewHash:fresh.previewHash,authorityHash:fresh.authorityHash,reservationId:rid,startIdempotencyKey:input.startIdempotencyKey,localOnly:fresh.localOnly,quoteHash:fresh.quoteHash,authorizedMaximumCostCny:input.authorizedMaximumCostCny,reservedAt:now,expiresAt:fresh.availableUntil},receipt=seal(body);
   if(existing){if(existing.recordHash!==receipt.recordHash)fail('capacity_conflict');return{reservationId:existing.reservationId,expiresAt:existing.expiresAt};}
   await store.create(WEEKLY_CREATIVE_REPAIR_CAPACITY_RESERVATIONS,{id:socialRequestHash([input.case.tenantId,input.case.caseId]).slice(0,15),tenant_id:input.case.tenantId,case_id:input.case.caseId,reservation_id:rid,content_hash:socialRequestHash(receipt),payload:receipt});
   const saved=await readReservation(input.case.tenantId,input.case.caseId);if(!saved||saved.recordHash!==receipt.recordHash)return fail('capacity_save_failed',503);return{reservationId:saved.reservationId,expiresAt:saved.expiresAt};
  },
  async start(input){
   const prior=await findStarted({tenantId:input.case.tenantId,bindingKey:`weekly-creative-repair:${input.case.packageId}:${input.case.packageVersion}:${input.case.publicationTaskId}:${input.case.caseId}`});if(prior?.status==='started')return prior;
   const capacity=await readReservation(input.case.tenantId,input.case.caseId);if(!capacity||capacity.reservationId!==input.mapping.capacityReservationId||capacity.previewHash!==input.mapping.previewHash||capacity.authorityHash!==input.mapping.authorityHash||capacity.configurationHash!==input.configuration.recordHash||capacity.authorizedMaximumCostCny!==input.mapping.authorizedMaximumCostCny||capacity.startIdempotencyKey!==input.mapping.startIdempotencyKey)return fail('capacity_invalid');if(clock().getTime()>Date.parse(capacity.expiresAt))fail('capacity_expired');
   const taskId=childId(input.case.tenantId,input.case.caseId),issued=await issueWeeklyCreativeRepairAuthority({store,tenantId:input.case.tenantId,caseId:input.case.caseId,childTaskId:taskId,expectedCaseHash:input.case.recordHash,expectedConfigurationHash:input.configuration.recordHash,now:clock()});if(issued.proof.originalAuthorityHash!==input.mapping.authorityHash)fail('authority_changed');
   const parent=await readSocialTaskDetail({repository,tenantId:input.case.tenantId,taskId:input.case.parent.taskId});if(!parent)return fail('parent_missing',503);
   const planningRows=await store.list<Record_>('social_weekly_agent_planning',{where:{tenant_id:input.case.tenantId,package_id:input.case.packageId,package_version:input.case.packageVersion},perPage:100});
   if(planningRows.totalItems!==planningRows.items.length)return fail('planning_ambiguous',503);
   const dispatched=planningRows.items.map(row=>socialObject(socialJson(row.payload)) as unknown as WeeklyAgentPlanningState|null).filter((value):value is WeeklyAgentPlanningState=>value?.status==='dispatched'&&value.packageId===input.case.packageId&&value.packageVersion===input.case.packageVersion);
   if(dispatched.length!==1)return fail(dispatched.length?'planning_ambiguous':'planning_missing',503);
   const planning=dispatched[0]!;
   const slots=planning.skeleton.slots.filter(slot=>slot.publicationTaskIds.includes(input.case.publicationTaskId));
   if(slots.length!==1)return fail('planning_ambiguous',503);
   const analyses=planning.directorAnalyses.filter(analysis=>analysis.slotId===slots[0]!.slotId);
   if(analyses.length!==1)return fail('planning_ambiguous',503);
   const references=await readWeeklyReferenceSources(store,input.case.tenantId,issued.authority,analyses[0]!);
   const referenceResolver=weeklyReferenceResolver(references);
   let child=await createSocialContentTask({repository,tenantId:input.case.tenantId,userId:input.actorUserId,taskId,idempotencyKey:issued.bindingKey,value:childInput(parent,input.configuration,input.case.trigger.type==='user_changes_requested'?input.case.trigger.note:''),now:clock()});
   const childRow=await requireSocialTask({repository,tenantId:input.case.tenantId,taskId});const briefRaw=socialObject(socialJson(childRow.brief));if(!briefRaw)return fail('child_corrupt',503);const brief=briefRaw;
   const bound=socialObject(brief._weeklyCreativeRepairProof);if(bound&&socialRequestHash(bound)!==socialRequestHash(issued.proof))fail('child_authority_conflict');
   if(!bound){await repository.update(STARTER_COLLECTIONS.socialContentTasks,input.case.tenantId,childRow.id,{brief:{...brief,_weeklyAuthority:issued.authority,_weeklyCreativeRepairProof:issued.proof,_weeklyCreativeRepair:{caseId:input.case.caseId,configurationHash:input.configuration.recordHash,parentTaskId:input.case.parent.taskId,parentRunId:input.case.parent.runId,parentArtifactRef:input.case.parent.artifactRef,parentArtifactHash:input.case.parent.artifactHash,revisionScope:input.configuration.revisionScope,feedbackHash:input.configuration.feedbackHash,authorizedMaximumCostCny:input.mapping.authorizedMaximumCostCny,capacityReservationId:input.mapping.capacityReservationId}},updated_at:clock().toISOString()});child=(await readSocialTaskDetail({repository,tenantId:input.case.tenantId,taskId}))!;}
   for(const source of parent.sources.filter(value=>value.status==='active')){if(child.sources.some(value=>value.kind===source.kind&&value.sourceRef===source.sourceRef&&value.sourceVersion===source.sourceVersion&&value.status==='active'))continue;const attached=await addSocialTaskSource({repository,tenantId:input.case.tenantId,userId:input.actorUserId,taskId,idempotencyKey:`${input.mapping.startIdempotencyKey}:source:${source.sourceId}`,referenceResolver,value:{kind:source.kind,sourceRef:source.sourceRef,sourceVersion:source.sourceVersion,label:source.label,purpose:`创意返工继承原任务已冻结来源：${source.purpose??source.label}`},now:clock()});child=attached.task;}
   const queue=createStarter198OrchestratorQueue({repository,dataStore:store,now:clock});
   if(!child.runId)child=await startSocialContentTask({repository,orchestratorQueue:queue,tenantId:input.case.tenantId,userId:input.actorUserId,taskId,expectedVersion:child.version,referenceResolver,idempotencyKey:`${input.mapping.startIdempotencyKey}:starter-run`,now:clock()});
   if(!child.runId)return{status:'unknown'};
   let job=await readContentExecutionJob(store,input.case.tenantId,taskId,child.runId);if(!job){await enqueueSocialContentAutoProduction({repository,tenantId:input.case.tenantId,userId:input.actorUserId,taskId,runId:child.runId});job=await readContentExecutionJob(store,input.case.tenantId,taskId,child.runId);}
   if(!job)return{status:'unknown'};return{status:'started',childTaskId:taskId,childBindingKey:issued.bindingKey,runId:child.runId,jobId:job.id};
  },
  async reconcileStart(input){const bindingKey=`weekly-creative-repair:${input.case.packageId}:${input.case.packageVersion}:${input.case.publicationTaskId}:${input.case.caseId}`;const found=await findStarted({tenantId:input.case.tenantId,bindingKey});return found??{status:'absent'};},
 };
}
