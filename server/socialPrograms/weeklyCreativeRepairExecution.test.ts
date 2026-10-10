import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import type {WeeklyCreativeRepairProductionPort} from './weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairExecutionService,WEEKLY_CREATIVE_REPAIR_CHILD_EXECUTIONS} from './weeklyCreativeRepairExecution.js';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {createWeeklyProductionRepairCaseService} from './weeklyProductionRepairCases.js';
import {createWeeklyCreativeRepairConfigurationService} from './weeklyCreativeRepairConfiguration.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {STARTER_COLLECTIONS} from '../starter198/repository.js';

async function prepared(){
 const f=await prepareWeeklyQualityRecoveryFixture();
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-05T10:00:00Z';f.task.status='succeeded';f.task.ownBlockingReasons=[];f.task.lastError=null;
 const approval:WeeklyExecutionTask={...f.task,taskId:'approval-creative-execution',subjectId:'pub:user-approval',status:'queued',dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[],ownBlockingReasons:[],idempotencyKey:'approval-creative-execution',schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-creative-execution-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,idempotency_key:approval.idempotencyKey,payload:approval});
 const artifact=f.tables.starter_social_content_artifacts![0]!,source=f.tables.starter_social_content_tasks![0]!,operationId='creative-execution-decision',operationRequestHash=socialRequestHash('actual-creative-feedback');artifact.status='changes_requested';artifact.version='v2';artifact.last_operation_id=operationId;source.weekly_plan_id='week1';
 await f.store.create(STARTER_COLLECTIONS.socialContentOperations,{tenant_id:'t',operation_id:operationId,operation:'decide_social_content_artifact',target_id:'content',request_hash:operationRequestHash,status:'processing'});
 let time='2026-10-01T01:00:00Z';const clock=()=>new Date(time),cases=createWeeklyProductionRepairCaseService(f.store,clock),created=await cases.createCreativeFromDecision({tenantId:'t',actorUserId:'owner',taskId:'content',artifactId:'artifact',operationId,operationRequestHash,note:'CTA改为预约样品'});
 const configuration=await createWeeklyCreativeRepairConfigurationService(f.store,clock).configure('t','owner',created.caseId,{expectedCaseHash:created.recordHash,revisionScope:'只修改CTA分镜和配音，保留产品事实',estimatedDurationMinutes:30,maximumCostCny:10,deadlineAt:'2026-10-04T10:00:00Z'});
 return{f,clock,setTime:(value:string)=>{time=value;},cases,configuration,caseId:created.caseId};
}

test('creative child production starts once, reconciles unknown outcome, and binds only a real receipt',async t=>{
 const x=await prepared();t.after(x.f.cleanup);let starts=0,reconciles=0,reconcileState:'unknown'|'started'='unknown';
 const port:WeeklyCreativeRepairProductionPort={
  async preview({case:item,configuration}){return{caseId:item.caseId,caseRecordHash:item.recordHash,configurationHash:configuration.recordHash,previewHash:socialRequestHash('creative-preview'),authorityHash:socialRequestHash('verified-case-authority'),estimatedDurationMinutes:configuration.estimatedDurationMinutes,maximumCostCny:configuration.maximumCostCny,localOnly:true,quoteHash:null,availableUntil:'2026-10-01T02:00:00Z'};},
  async confirmCapacity(){return{reservationId:'creative-capacity-1',expiresAt:'2026-10-01T02:00:00Z'};},
  async start(){starts++;return{status:'unknown'};},
  async reconcileStart({case:item}){reconciles++;return reconcileState==='started'?{status:'started',childTaskId:'creative-child-task-1',childBindingKey:`weekly-creative-repair:${item.packageId}:${item.packageVersion}:${item.publicationTaskId}:${item.caseId}`,runId:'creative-child-run-1',jobId:'creative-child-job-1'}:{status:'unknown'};},
 };
 const service=createWeeklyCreativeRepairExecutionService(x.f.store,port,x.clock),preview=await service.previewCapacity('t','owner',x.caseId),before=await x.cases.read('t',x.caseId);
 assert.equal(x.f.tables.content_execution_jobs?.length??0,0);
 const ready=await service.confirmCapacity('t','owner',x.caseId,{expectedCaseRecordHash:before.recordHash,expectedConfigurationHash:x.configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,authorizedMaximumCostCny:0});
 assert.equal(ready.state,'ready');assert.equal(ready.execution,null);const confirmed=await service.read('t',x.caseId);assert.equal(confirmed?.state,'capacity_confirmed');assert.equal(confirmed?.childTaskId,null);
 await assert.rejects(service.start('t','owner',x.caseId,{expectedCaseRecordHash:ready.recordHash}),{code:'weekly_creative_repair_execution_start_outcome_unknown'});assert.equal(starts,1);assert.equal((await service.read('t',x.caseId))?.state,'reconciling');assert.equal((await x.cases.read('t',x.caseId)).state,'ready');
 await assert.rejects(service.start('t','owner',x.caseId,{expectedCaseRecordHash:ready.recordHash}),{code:'weekly_creative_repair_execution_start_outcome_unknown'});assert.equal(starts,1);assert.equal(reconciles,1);
 reconcileState='started';const running=await service.start('t','owner',x.caseId,{expectedCaseRecordHash:ready.recordHash});assert.equal(running.state,'running');assert.deepEqual(running.execution,{operationId:'creative-child-task-1',runId:'creative-child-run-1',jobId:'creative-child-job-1'});assert.equal(starts,1);assert.equal(reconciles,2);
 assert.equal((await service.start('t','owner',x.caseId,{expectedCaseRecordHash:'0'.repeat(64)})).recordHash,running.recordHash);assert.equal(starts,1);assert.equal(reconciles,2);
 const mapping=await service.read('t',x.caseId);assert.equal(mapping?.state,'running');assert.equal(mapping?.configurationHash,x.configuration.recordHash);assert.equal(mapping?.parentArtifactHash,running.parent.artifactHash);assert.equal(x.f.tables.content_execution_jobs?.length??0,0,'the port owns real queue admission; mapping service never fabricates a job');
});

test('running mapping recovers a failed case bind without another production start',async t=>{
 const x=await prepared();t.after(x.f.cleanup);let starts=0;
 const receipt={status:'started' as const,childTaskId:'creative-child-task-2',childBindingKey:'',runId:'creative-child-run-2',jobId:'creative-child-job-2'};
 const port:WeeklyCreativeRepairProductionPort={
  async preview({case:item,configuration}){return{caseId:item.caseId,caseRecordHash:item.recordHash,configurationHash:configuration.recordHash,previewHash:socialRequestHash('preview-2'),authorityHash:socialRequestHash('authority-2'),estimatedDurationMinutes:30,maximumCostCny:10,localOnly:true,quoteHash:null,availableUntil:'2026-10-01T02:00:00Z'};},
  async confirmCapacity(){return{reservationId:'creative-capacity-2',expiresAt:'2026-10-01T02:00:00Z'};},
  async start(){starts++;return receipt;},async reconcileStart(){throw Error('must not reconcile a sealed running receipt');},
 };
 receipt.childBindingKey=`weekly-creative-repair:week1:1:${(await x.cases.read('t',x.caseId)).publicationTaskId}:${x.caseId}`;
 const service=createWeeklyCreativeRepairExecutionService(x.f.store,port,x.clock),preview=await service.previewCapacity('t','owner',x.caseId),before=await x.cases.read('t',x.caseId),ready=await service.confirmCapacity('t','owner',x.caseId,{expectedCaseRecordHash:before.recordHash,expectedConfigurationHash:x.configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,authorizedMaximumCostCny:0});
 const original=x.f.store.update.bind(x.f.store);let failCase=true;x.f.store.update=async(...args:Parameters<typeof x.f.store.update>)=>{if(args[0]==='social_weekly_production_repair_cases'&&failCase){failCase=false;throw Error('simulated case bind loss');}return original(...args);};
 await assert.rejects(service.start('t','owner',x.caseId,{expectedCaseRecordHash:ready.recordHash}),/simulated case bind loss/);assert.equal(starts,1);assert.equal((await service.read('t',x.caseId))?.state,'running');assert.equal((await x.cases.read('t',x.caseId)).state,'ready');
 const recovered=await service.start('t','owner',x.caseId,{expectedCaseRecordHash:ready.recordHash});assert.equal(recovered.state,'running');assert.deepEqual(recovered.execution,{operationId:receipt.childTaskId,runId:receipt.runId,jobId:receipt.jobId});assert.equal(starts,1);
 const row=x.f.tables[WEEKLY_CREATIVE_REPAIR_CHILD_EXECUTIONS]![0]!;row.payload={...(row.payload as object),jobId:'fabricated'};await assert.rejects(service.read('t',x.caseId),{code:'weekly_creative_repair_execution_mapping_corrupt'});
});

test('capacity confirmation rejects stale authority and never calls real admission',async t=>{
 const x=await prepared();t.after(x.f.cleanup);let confirmations=0;const port:WeeklyCreativeRepairProductionPort={async preview({case:item,configuration}){return{caseId:item.caseId,caseRecordHash:item.recordHash,configurationHash:configuration.recordHash,previewHash:socialRequestHash('preview-3'),authorityHash:socialRequestHash('authority-3'),estimatedDurationMinutes:30,maximumCostCny:10,localOnly:false,quoteHash:socialRequestHash('quote-3'),availableUntil:'2026-10-01T02:00:00Z'};},async confirmCapacity(){confirmations++;return{reservationId:'capacity-3',expiresAt:'2026-10-01T02:00:00Z'};},async start(){throw Error('no');},async reconcileStart(){throw Error('no');}};
 const service=createWeeklyCreativeRepairExecutionService(x.f.store,port,x.clock),preview=await service.previewCapacity('t','owner',x.caseId),item=await x.cases.read('t',x.caseId);
 await assert.rejects(service.confirmCapacity('t','owner',x.caseId,{expectedCaseRecordHash:item.recordHash,expectedConfigurationHash:x.configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:'f'.repeat(64),expectedQuoteHash:preview.quoteHash!,authorizedMaximumCostCny:10}),{code:'weekly_creative_repair_execution_capacity_changed'});assert.equal(confirmations,0);assert.equal(await service.read('t',x.caseId),null);
});
