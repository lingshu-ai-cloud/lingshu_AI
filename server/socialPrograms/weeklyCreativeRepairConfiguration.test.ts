import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {createWeeklyProductionRepairCaseService} from './weeklyProductionRepairCases.js';
import {createWeeklyCreativeRepairConfigurationService} from './weeklyCreativeRepairConfiguration.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

test('creative configuration freezes real user feedback and scope, creates no production, and rejects changed scope',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-05T10:00:00Z';
 const approval:WeeklyExecutionTask={...f.task,taskId:'approval-creative-config',dependsOnTaskIds:[f.task.taskId],schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-config-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,payload:approval});
 const artifact=f.tables.starter_social_content_artifacts![0]!,source=f.tables.starter_social_content_tasks![0]!,operationId='creative-config-decision',operationRequestHash=socialRequestHash('actual-feedback');
 artifact.status='changes_requested';artifact.version='v2';artifact.last_operation_id=operationId;source.weekly_plan_id='week1';
 await f.store.create('starter_social_content_operations',{tenant_id:'t',operation_id:operationId,operation:'decide_social_content_artifact',target_id:'content',request_hash:operationRequestHash,status:'processing'});
 let currentTime='2026-10-01T01:00:00Z';const clock=()=>new Date(currentTime),cases=createWeeklyProductionRepairCaseService(f.store,clock);
 const item=await cases.createCreativeFromDecision({tenantId:'t',actorUserId:'owner',taskId:'content',artifactId:'artifact',operationId,operationRequestHash,note:'CTA改为预约样品'});
 const service=createWeeklyCreativeRepairConfigurationService(f.store,clock),input={expectedCaseHash:item.recordHash,revisionScope:'只重写CTA分镜与配音，保留产品事实',estimatedDurationMinutes:30,maximumCostCny:10,deadlineAt:'2026-10-04T10:00:00Z'};
 await assert.rejects(service.configure('t','foreign',item.caseId,input));
 const owner=await f.store.getById('users','owner');assert.ok(owner);const originalRole=owner.role;
 owner.role='unknown';await assert.rejects(service.configure('t','owner',item.caseId,input),{code:'weekly_creative_repair_actor_forbidden'});owner.role=originalRole;
 owner.status='suspended';await assert.rejects(service.configure('t','owner',item.caseId,input),{code:'weekly_creative_repair_actor_forbidden'});delete owner.status;

 const originalUpdate=f.store.update.bind(f.store);let interrupt=true;
 f.store.update=async (...args:Parameters<typeof f.store.update>)=>{if(args[0]==='social_weekly_production_repair_cases'&&interrupt){interrupt=false;throw Error('simulated-case-write-interruption');}return originalUpdate(...args);};
 await assert.rejects(service.configure('t','owner',item.caseId,input),/simulated-case-write-interruption/);
 assert.equal((await cases.read('t',item.caseId)).state,'awaiting_configuration');
 const configured=await service.configure('t','owner',item.caseId,input);assert.equal(configured.feedbackHash,socialRequestHash('CTA改为预约样品'));assert.equal((await cases.read('t',item.caseId)).state,'awaiting_capacity');assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(source.run_id,'run');
 assert.deepEqual(await service.configure('t','owner',item.caseId,input),configured);
 await assert.rejects(service.configure('t','owner',item.caseId,{...input,revisionScope:'全部重做'}));
 const operation=f.tables.starter_social_content_operations!.find(row=>row.operation_id===operationId)!;
 const originalHash=operation.request_hash;operation.request_hash=socialRequestHash('tampered');
 await assert.rejects(service.configure('t','owner',item.caseId,input),{code:'weekly_creative_repair_feedback_changed'});operation.request_hash=originalHash;
 source.run_id='changed-run';await assert.rejects(service.configure('t','owner',item.caseId,input),{code:'weekly_creative_repair_parent_changed'});source.run_id='run';
 currentTime='2026-10-04T11:00:00Z';assert.deepEqual(await service.configure('t','owner',item.caseId,input),configured);
 artifact.status='approved';await assert.rejects(service.configure('t','owner',item.caseId,input));
});
