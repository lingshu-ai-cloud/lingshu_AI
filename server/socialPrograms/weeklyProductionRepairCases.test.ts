import test from 'node:test';
import assert from 'node:assert/strict';
import type {InitialSceneQualityReport} from '../starter198/socialContentInitialSceneCache.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {createWeeklyProductionRepairCaseService} from './weeklyProductionRepairCases.js';

const failedReport:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:2,contentFrameCount:2,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:true,estimatedDistinctFrames:2,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:false,issues:[{sceneIndex:1,start:3,end:6,code:'blur',reason:'第二镜清晰度不足'}],checkedScenes:2},audio:{ok:true,error:null}};

test('v3 hard quality failure creates one evidence-bound repair card without starting production',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture({hardFailure:true,initialQualityReport:failedReport,initialG4Outcomes:['passed','failed'],controlledRenderManifest:true});t.after(f.cleanup);
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-05T10:00:00Z';
 const approval:WeeklyExecutionTask={...f.task,taskId:'approval-v3',subjectId:'pub:user-approval',status:'blocked',dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[f.task.taskId],ownBlockingReasons:[],idempotencyKey:'approval-v3',schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-v3-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,idempotency_key:approval.idempotencyKey,payload:approval});
 const service=createWeeklyProductionRepairCaseService(f.store,()=>new Date('2026-10-01T01:00:00Z'));
 const quality=await f.service.context(f.scope,'owner'),consumer=quality.consumers[0]!;
 const cache=await f.serviceCache.readCache({tenantId:'t',taskId:'content',runId:'run',parentArtifactId:'artifact'}),failed=cache.cache.scenes.filter(scene=>scene.status==='failed');assert.equal(failed.length,1);
 const publishWindow=f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow!;
 const input={requestId:'technical-repair-card-0001',expectedQualityContextHash:consumer.contextHash,qualityTaskId:f.task.taskId,affectedSceneIds:failed.map(scene=>scene.sceneId),ownerUserId:'owner',reviewerUserId:'owner',deadlineAt:new Date(Date.parse(publishWindow)-3_600_000).toISOString(),estimatedDurationMinutes:30,maximumCostCny:10};
 const created=await service.createTechnical(f.scope,'owner',input);assert.equal(created.state,'awaiting_capacity');assert.equal(created.kind,'technical_scene_repair');assert.deepEqual(created.affectedSceneIds,input.affectedSceneIds);assert.equal(created.qualityTaskId,f.task.taskId);assert.equal(created.approvalTaskId,approval.taskId);assert.equal(created.parent.artifactRef.id,'artifact');assert.equal(created.trigger.failedReceiptIds.length,1);assert.equal(created.execution,null);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.workflow_runs!.filter(row=>row.id!=='run').length,1); // fixture authorization only; case creation adds none
 const retried=await service.createTechnical(f.scope,'owner',{...input,requestId:'technical-repair-card-retry-0002'});assert.equal(retried.caseId,created.caseId);assert.equal((await service.list('t','p','week1',1)).length,1);assert.deepEqual(await service.read('t',created.caseId),created);
 await assert.rejects(service.createTechnical(f.scope,'owner',{...input,affectedSceneIds:[]}));
 await assert.rejects(service.createTechnical(f.scope,'owner',{...input,deadlineAt:publishWindow}));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});
