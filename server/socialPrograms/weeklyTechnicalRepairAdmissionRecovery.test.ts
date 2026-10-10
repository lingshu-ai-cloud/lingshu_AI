import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import {prepareWeeklyHardQualityRepairFixture} from './weeklyContentQualityRecovery.fixture.js';
import {createWeeklyTechnicalRepairCompletionService} from './weeklyTechnicalRepairCompletion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {InitialSceneQualityReport} from '../starter198/socialContentInitialSceneCache.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {WEEKLY_PRODUCTION_REPAIR_CASES,createWeeklyProductionRepairCaseService} from './weeklyProductionRepairCases.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

const failedReport:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:2,contentFrameCount:2,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:true,estimatedDistinctFrames:2,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:false,issues:[{sceneIndex:1,start:3,end:6,code:'blur',reason:'第二镜清晰度不足'}],checkedScenes:2},audio:{ok:true,error:null}};

async function admittedButUnwritten(t:import('node:test').TestContext){
 const f=await prepareWeeklyQualityRecoveryFixture({hardFailure:true,initialQualityReport:failedReport,initialG4Outcomes:['passed','failed'],controlledRenderManifest:true});t.after(f.cleanup);
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-05T10:00:00Z';
 const approval:WeeklyExecutionTask={...f.task,taskId:'approval-v3',subjectId:'pub:user-approval',status:'blocked',dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[f.task.taskId],ownBlockingReasons:[],idempotencyKey:'approval-v3',schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-v3-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,idempotency_key:approval.idempotencyKey,payload:approval});
 let currentNow='2026-10-01T01:00:00Z';const service=createWeeklyProductionRepairCaseService(f.store,()=>new Date(currentNow));
 const quality=await f.service.context(f.scope,'owner'),consumer=quality.consumers[0]!;
 const cache=await f.serviceCache.readCache({tenantId:'t',taskId:'content',runId:'run',parentArtifactId:'artifact'}),failed=cache.cache.scenes.filter(scene=>scene.status==='failed');assert.equal(failed.length,1);
 const publishWindow=f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow!;
 const input={requestId:'technical-repair-card-0001',expectedQualityContextHash:consumer.contextHash,qualityTaskId:f.task.taskId,affectedSceneIds:failed.map(scene=>scene.sceneId),ownerUserId:'owner',reviewerUserId:'owner',deadlineAt:new Date(Date.parse(publishWindow)-3_600_000).toISOString(),estimatedDurationMinutes:30,maximumCostCny:10};
 const created=await service.createTechnical(f.scope,'owner',input);
 const proposal=await service.previewTechnicalCapacity('t','owner',created.caseId);
 const renewed=await service.confirmTechnicalCapacity('t','owner',created.caseId,{expectedCaseRecordHash:created.recordHash,expectedPreviewHash:proposal.preview.previewHash,authorizedMaximumCostCny:0});
 f.tables.workflow_runs=f.tables.workflow_runs!.filter(row=>row.id!=='rework-run');
 const update=f.store.update.bind(f.store);let caseWriteFailed=false;
 f.store.update=async(...args:Parameters<typeof update>)=>{
  if(args[0]===WEEKLY_PRODUCTION_REPAIR_CASES&&!caseWriteFailed){caseWriteFailed=true;return false;}
  return update(...args);
 };
 try{await assert.rejects(service.startTechnical('t','owner',created.caseId,{expectedCaseRecordHash:renewed.recordHash}),{code:'weekly_repair_case_save_failed'});}
 finally{f.store.update=update;}
 const persisted=await service.read('t',created.caseId);
 assert.equal(persisted.state,'ready');assert.equal(persisted.execution,null);
 assert.equal(f.tables.content_execution_jobs!.length,1);
 const job=f.tables.content_execution_jobs![0]!;
 assert.equal(job.run_id,proposal.preview.executionRunId);
 await f.store.update('content_execution_jobs',job.id,{status:'succeeded',completed_at:currentNow});
 await f.store.update('workflow_runs',String(job.run_id),{status:'completed',completed_at:currentNow});
 currentNow='2026-10-01T02:00:00Z'; // recovery remains possible after the original capacity window expires
 return {f,service,created,renewed,proposal,job};
}

test('technical admission restores the original terminal job after its case write failed without admitting again',async t=>{
 const x=await admittedButUnwritten(t),beforeRuns=x.f.tables.workflow_runs!.length;
 const create=x.f.store.create.bind(x.f.store);
 x.f.store.create=async(...args:Parameters<typeof create>)=>{
  assert.notEqual(args[0],'content_execution_jobs','recovery must not admit another job');
  assert.notEqual(args[0],'workflow_runs','recovery must not admit another run');
  assert.notEqual(args[0],'starter_social_scene_rework_intents','recovery must not create another intent');
  return create(...args);
 };
 const restored=await x.service.startTechnical('t','owner',x.created.caseId,{expectedCaseRecordHash:x.renewed.recordHash});
 assert.equal(restored.state,'running');
 assert.deepEqual(restored.execution,{operationId:x.proposal.preview.operationId,runId:x.proposal.preview.executionRunId,jobId:x.job.id});
 assert.deepEqual(await x.service.startTechnical('t','owner',x.created.caseId,{expectedCaseRecordHash:x.renewed.recordHash}),restored);
 assert.equal(x.f.tables.content_execution_jobs!.length,1);assert.equal(x.f.tables.workflow_runs!.length,beforeRuns);
 assert.equal(x.job.status,'succeeded');
});

test('technical terminal admission recovery rejects a different actor and mismatched original job identity',async t=>{
 const x=await admittedButUnwritten(t);
 await assert.rejects(x.service.startTechnical('t','outsider',x.created.caseId,{expectedCaseRecordHash:x.renewed.recordHash}),{code:'weekly_repair_case_owner_required'});
 await assert.rejects(x.service.startTechnical('foreign','owner',x.created.caseId,{expectedCaseRecordHash:x.renewed.recordHash}));
 for(const [key,value] of [['tenant_id','foreign'],['task_id','foreign-task'],['run_id','foreign-run']] as const){
  const original=x.job[key];x.job[key]=value;
  try{await assert.rejects(x.service.startTechnical('t','owner',x.created.caseId,{expectedCaseRecordHash:x.renewed.recordHash}));}
  finally{x.job[key]=original;}
  assert.equal((await x.service.read('t',x.created.caseId)).execution,null);
  assert.equal(x.f.tables.content_execution_jobs!.length,1);
 }
});

test('terminal admission recovery preserves the actual child artifact and reconciles to awaiting audit',async t=>{
 const f=await prepareWeeklyHardQualityRepairFixture();t.after(f.cleanup);
 f.pkg.status='active';
 const now=new Date().toISOString(),caseId='wrc_real_technical_completion';
 const approval:WeeklyExecutionTask={...f.task,taskId:'original-user-approval',status:'blocked',dependsOnTaskIds:[f.task.taskId],inheritedBlockingTaskIds:[f.task.taskId],ownBlockingReasons:[`weekly_repair_case_open:${caseId}`,'independent_approval_hold'],resultRefs:[],schedule:{...f.task.schedule,stepKind:'user_approval',responsibleActor:'user'},lease:null};
 await f.store.create('social_weekly_execution_tasks',{tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,payload:approval});
 const parent=f.tables.starter_social_content_artifacts!.find(row=>row.artifact_id==='artifact')!;
 const intent=f.tables.starter_social_scene_rework_intents![0]!.payload as {operationId:string;cacheHash:string;planHash:string;affectedSceneIds:string[]};
 const body:Omit<WeeklyProductionRepairCase,'recordHash'>={schemaVersion:'weekly-production-repair-case.v1',caseId,version:1,requestId:'real-completion-case-0001',requestHash:socialRequestHash({caseId}),tenantId:'t',programId:'p',packageId:'week1',packageVersion:1,publicationTaskId:'pub',accountId:f.task.accountId!,qualityTaskId:f.task.taskId,approvalTaskId:approval.taskId,kind:'technical_scene_repair',trigger:{type:'verified_quality_failure',blocker:'weekly_quality_audit_actual_repair_required',qualityContextHash:socialRequestHash({caseId}),failedReceiptIds:[]},parent:{taskId:'content',runId:'run',artifactRef:{type:'starter_social_content_artifact',id:'artifact',version:1},artifactHash:String(parent.content_hash),sceneCacheHash:intent.cacheHash},affectedSceneIds:intent.affectedSceneIds,ownerUserId:'owner',reviewerUserId:'owner',deadlineAt:null,affectedPublishWindow:now,estimatedDurationMinutes:1,maximumCostCny:0,configurationGaps:[],state:'running',admission:null,execution:{operationId:intent.operationId,runId:f.job.runId,jobId:f.job.id},childArtifactRef:null,createdBy:'owner',createdAt:now,updatedAt:now};
 const windowBody={startsAt:now,finishesAt:now,deadlineAt:now,estimatedDurationMinutes:1};
 const admissionBody={type:'weekly_repair_admission_confirmation' as const,version:1 as const,caseId,caseRequestHash:body.requestHash,previewHash:socialRequestHash({caseId}),operationId:intent.operationId,executionRunId:f.job.runId,sceneCacheHash:intent.cacheHash,planHash:intent.planHash,localOnly:true,quoteHash:null,costPolicyHash:null,authorizedMaximumCostCny:0,capacityWindow:{...windowBody,recordHash:socialRequestHash(windowBody)},confirmedBy:'owner',confirmedAt:now};
 body.state='ready';body.execution=null;body.admission={...admissionBody,recordHash:socialRequestHash(admissionBody)};
 const item={...body,recordHash:socialRequestHash(body)};
 await f.store.create(WEEKLY_PRODUCTION_REPAIR_CASES,{tenant_id:'t',case_id:caseId,state:'ready',content_hash:socialRequestHash(item),payload:item});
 const run=f.tables.workflow_runs!.find(row=>row.id===f.job.runId)!;
 const outputBody={...f.result,operationId:intent.operationId,executionRunId:f.job.runId,jobId:f.job.id};
 (run.starter_context as Record<string,unknown>).sceneReworkOutput={...outputBody,recordHash:socialRequestHash(outputBody)};
 await f.store.update('content_execution_jobs',f.job.id,{status:'succeeded',completed_at:now});
 await f.store.update('workflow_runs',f.job.runId,{status:'completed',completed_at:now});
 const cases=createWeeklyProductionRepairCaseService(f.store);
 const restored=await cases.startTechnical('t','owner',caseId,{expectedCaseRecordHash:item.recordHash});
 assert.equal(restored.execution?.jobId,f.job.id);
 const awaiting=await createWeeklyTechnicalRepairCompletionService(f.store).reconcile('t','owner',caseId);
 assert.equal(awaiting.state,'awaiting_audit');assert.equal(awaiting.childArtifactRef?.id,f.result.artifactId);
 assert.equal(f.tables.content_execution_jobs!.length,1);assert.equal(f.supplierCalls(),1);
});
