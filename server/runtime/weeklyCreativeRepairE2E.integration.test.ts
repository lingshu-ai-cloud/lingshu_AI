import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyNonPresenterProductionFixture} from './weeklyNonPresenterProduction.fixture.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {STARTER_COLLECTIONS} from '../starter198/repository.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyCreativeRepairExecutionService} from '../socialPrograms/weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairProductionPort} from './weeklyCreativeRepairProductionPort.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';

test('full frozen planning resolves the real creative child reference before independent director admission',async t=>{
 const x=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,primaryStructure:true,productInventory:true}),{f,pkg,created}=x;
 pkg.executionGraphVersion=3;pkg.status='active';pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-15T10:00:00Z';
 const packageRow=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version)!;packageRow.payload=pkg;
 const parent=f.tables.starter_social_content_tasks.find(row=>row.id===created.id)!;parent.weekly_plan_id=pkg.packageId;parent.status='asset_review';parent.run_id='';parent.artifact_count=1;parent.approved_artifact_count=0;
 const authority=(parent.brief as any)._weeklyAuthority;authority.weeklyPackage=structuredClone(pkg);authority.publicationTask=structuredClone(pkg.socialContentPackage.publicationTasks[0]);
 const artifact=f.tables.starter_social_content_artifacts![0]!;artifact.task_id=String(parent.task_id);artifact.status='changes_requested';artifact.version='v2';const operationId='full-creative-decision',operationRequestHash=socialRequestHash('full-creative-feedback');artifact.last_operation_id=operationId;
 await f.store.create(STARTER_COLLECTIONS.socialContentOperations,{tenant_id:'t',operation_id:operationId,operation:'decide_social_content_artifact',target_id:parent.task_id,request_hash:operationRequestHash,status:'processing'});
 const base=f.task,quality:WeeklyExecutionTask={...base,tenantId:'t',programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,taskId:'full-creative-quality',publicationTaskId:pkg.socialContentPackage.publicationTasks[0]!.publicationTaskId,accountId:pkg.socialContentPackage.publicationTasks[0]!.accountId,status:'succeeded',dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],lease:null,schedule:{...base.schedule,stepKind:'quality_check',responsibleActor:'content_agent'}},approval:WeeklyExecutionTask={...quality,taskId:'full-creative-approval',status:'queued',dependsOnTaskIds:[quality.taskId],schedule:{...quality.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks=[{id:'quality-row',tenant_id:'t',program_id:pkg.programId,package_id:pkg.packageId,package_version:pkg.version,task_id:quality.taskId,payload:quality},{id:'approval-row',tenant_id:'t',program_id:pkg.programId,package_id:pkg.packageId,package_version:pkg.version,task_id:approval.taskId,payload:approval}];
 const clock=()=>new Date('2026-10-10T01:00:00Z'),cases=createWeeklyProductionRepairCaseService(f.store,clock),repair=await cases.createCreativeFromDecision({tenantId:'t',actorUserId:'owner',taskId:String(parent.task_id),artifactId:String(artifact.artifact_id),operationId,operationRequestHash,note:'CTA改成预约工厂打样'});
 const configuration=await createWeeklyCreativeRepairConfigurationService(f.store,clock).configure('t','owner',repair.caseId,{expectedCaseHash:repair.recordHash,revisionScope:'只修改CTA分镜和配音，保留产品事实',estimatedDurationMinutes:30,maximumCostCny:0,deadlineAt:'2026-10-14T10:00:00Z'});
 const port=createWeeklyCreativeRepairProductionPort(f.store,clock),service=createWeeklyCreativeRepairExecutionService(f.store,port,clock),preview=await service.previewCapacity('t','owner',repair.caseId),current=await cases.read('t',repair.caseId),ready=await service.confirmCapacity('t','owner',repair.caseId,{expectedCaseRecordHash:current.recordHash,expectedConfigurationHash:configuration.recordHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,authorizedMaximumCostCny:0});
 await assert.rejects(port.start({case:ready,configuration,actorUserId:'owner',mapping:(await service.read('t',repair.caseId))!}),{code:'social_content_execution_director_review_required'});
 const child=f.tables.starter_social_content_tasks.find(row=>String(row.create_idempotency_key).startsWith('weekly-creative-repair:'));assert.ok(child);const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:String(child.task_id)});assert.ok(detail?.referenceVideoAnalysis);assert.notEqual(detail.referenceVideoAnalysis.status,'analyzing');assert.equal(detail.agentWorkflow?.executionPlanReview.approved,false);assert.ok(detail.agentWorkflow?.executionPlanReview.reasonCodes.includes('capability_mismatch'));assert.equal(child.run_id,'');assert.equal(f.tables.content_execution_jobs?.filter(row=>row.task_id===child.task_id).length??0,0);
});
