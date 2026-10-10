import test from'node:test';
import assert from'node:assert/strict';
import type{WeeklyExecutionTask}from'../../shared/contracts/socialProgram.js';
import{STARTER_COLLECTIONS}from'../starter198/repository.js';
import{socialRequestHash}from'../starter198/socialContentValidation.js';
import{createWeeklyCreativeRepairConfigurationService}from'../socialPrograms/weeklyCreativeRepairConfiguration.js';
import{createWeeklyCreativeRepairExecutionService}from'../socialPrograms/weeklyCreativeRepairExecution.js';
import{prepareWeeklyQualityRecoveryFixture}from'../socialPrograms/weeklyContentQualityRecovery.fixture.js';
import{createWeeklyProductionRepairCaseService}from'../socialPrograms/weeklyProductionRepairCases.js';
import{createWeeklyCreativeRepairProductionPort,WEEKLY_CREATIVE_REPAIR_CAPACITY_RESERVATIONS}from'./weeklyCreativeRepairProductionPort.js';

test('real creative repair adapter validates authority and persists immutable capacity without starting production',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-15T10:00:00Z';f.task.status='succeeded';f.task.ownBlockingReasons=[];f.task.lastError=null;
 f.tables.social_programs=[{id:'program-row',tenant_id:'t',program_id:'p',payload:{programId:'p',version:1}}];
 const approval:WeeklyExecutionTask={...f.task,taskId:'approval-real-creative-port',subjectId:'pub:user-approval',status:'queued',dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[],ownBlockingReasons:[],idempotencyKey:'approval-real-creative-port',schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-real-creative-port-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,idempotency_key:approval.idempotencyKey,payload:approval});
 const artifact=f.tables.starter_social_content_artifacts![0]!,parent=f.tables.starter_social_content_tasks![0]!,operationId='real-creative-port-decision',operationRequestHash=socialRequestHash('real-creative-port-feedback');artifact.status='changes_requested';artifact.version='v2';artifact.last_operation_id=operationId;parent.weekly_plan_id='week1';
 await f.store.create(STARTER_COLLECTIONS.socialContentOperations,{tenant_id:'t',operation_id:operationId,operation:'decide_social_content_artifact',target_id:'content',request_hash:operationRequestHash,status:'processing'});
 const now='2026-10-10T01:00:00Z',clock=()=>new Date(now),cases=createWeeklyProductionRepairCaseService(f.store,clock),created=await cases.createCreativeFromDecision({tenantId:'t',actorUserId:'owner',taskId:'content',artifactId:'artifact',operationId,operationRequestHash,note:'CTA改成预约工厂打样'});
 const configuration=await createWeeklyCreativeRepairConfigurationService(f.store,clock).configure('t','owner',created.caseId,{expectedCaseHash:created.recordHash,revisionScope:'只修改CTA分镜和配音，保留产品事实',estimatedDurationMinutes:30,maximumCostCny:0,deadlineAt:'2026-10-14T10:00:00Z'});
 const port=createWeeklyCreativeRepairProductionPort(f.store,clock),service=createWeeklyCreativeRepairExecutionService(f.store,port,clock),preview=await service.previewCapacity('t','owner',created.caseId),current=await cases.read('t',created.caseId);
 assert.equal(preview.localOnly,true);assert.equal(preview.quoteHash,null);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 const ready=await service.confirmCapacity('t','owner',created.caseId,{expectedCaseRecordHash:current.recordHash,expectedConfigurationHash:configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,authorizedMaximumCostCny:0});
 assert.equal(ready.state,'ready');assert.equal(f.tables[WEEKLY_CREATIVE_REPAIR_CAPACITY_RESERVATIONS]?.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 const mapping=await service.read('t',created.caseId);assert(mapping);assert.equal((await port.reconcileStart({case:ready,configuration,mapping})).status,'absent');assert.equal(f.tables.starter_social_content_tasks!.filter(row=>String(row.create_idempotency_key).startsWith('weekly-creative-repair:')).length,0);assert.equal(f.tables.content_execution_jobs?.length??0,0);
});
