import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import type { StarterRecord } from './repository.js';
import type { SocialGraphApprovedContext } from './socialContentProductionExecution.js';
import { assertSocialProductionStateAdmission } from './socialContentProductionState.js';
import {socialRequestHash} from './socialContentValidation.js';
function fixture(){
 const approvedContext={version:'14',agentWorkflow:{executionPlan:{status:'approved',executionPlanId:'plan',version:'14'},executionPlanReview:{approved:true,executionPlanId:'plan',executionPlanVersion:'14',directorBriefId:'director',directorBriefVersion:'14'},directorBrief:{directorBriefId:'director',version:'14'}}} as unknown as SocialGraphApprovedContext;
 const input={tenantId:'tenant',taskId:'task',runId:'run',jobId:'job',userId:'user',expectedTaskVersion:'14',frozenInputHash:'a'.repeat(64),graphInputHash:'a'.repeat(64),planVersion:'14',approvedContext};
 const task:StarterRecord={id:'task-row',tenant_id:'tenant',task_id:'task',run_id:'run',version:'14',status:'plan_review'};
 const job:ContentExecutionJob={id:'job',tenantId:'tenant',taskId:'task',runId:'run',jobKey:'key',userId:'user',accountId:'account',taskType:'social_content_instant',status:'running',attempt:1,reconciliationAttempt:0,nextAttemptAt:null,workerId:'worker',leaseExpiresAt:null,retryClass:null,lastError:null,providerState:'completed',providerReceipts:[],createdAt:'2026-10-25',updatedAt:'2026-10-25',lastStartedAt:null,completedAt:null,
  checkpoints:{'social.executor':{version:'1',inputHash:input.frozenInputHash,updatedAt:'2026-10-25',payload:{executor:'langgraph',inputHash:input.frozenInputHash,planVersion:'14',approvedContext}}}};
 return {input,task,job};
}
test('approved frozen current-run worker may repair legacy plan_review without relaxing artifact admission',()=>{
 const f=fixture();assert.doesNotThrow(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job));
 for(const status of ['producing','asset_review','packaging','delivered'])assert.doesNotThrow(()=>assertSocialProductionStateAdmission(f.input,{...f.task,status},f.job));
});
test('another tenant/run/version or a cancelled order cannot borrow queue production state',()=>{
 const f=fixture();for(const patch of [{tenant_id:'other'},{run_id:'other'},{version:'15'},{status:'cancelled'},{status:'paused'},{status:'draft'}])assert.throws(()=>assertSocialProductionStateAdmission(f.input,{...f.task,...patch},f.job),/production_state_/);
 for(const patch of [{id:'other'},{runId:'other'},{tenantId:'other'},{status:'paused' as const},{taskType:'manual_upload'}])assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,{...f.job,...patch}),/job_not_admitted/);
});
test('unapproved or mismatched frozen review never authorizes producing, even with a paid provider receipt',()=>{
 for(const change of ['review','plan','reviewVersion'] as const){const f=fixture();const workflow=f.input.approvedContext.agentWorkflow!;
  if(change==='review')workflow.executionPlanReview.approved=false;
  else if(change==='plan')workflow.executionPlan.status='draft' as typeof workflow.executionPlan.status;
  else workflow.executionPlanReview.executionPlanVersion='other';
  assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job),/approved_review_required/);
 }
});
test('changed executor binding or substituted approved snapshot must be re-admitted',()=>{
 const f=fixture();assert.throws(()=>assertSocialProductionStateAdmission({...f.input,frozenInputHash:'b'.repeat(64)},f.task,f.job),/executor_changed/);
 const substitute=structuredClone(f.input.approvedContext);substitute.version='other';
 assert.throws(()=>assertSocialProductionStateAdmission({...f.input,approvedContext:substitute},f.task,f.job),/approved_context_changed/);
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,{...f.job,checkpoints:{}}),/executor_changed/);
});


test('attention after a recoverable worker failure can resume only on the same active frozen admission',()=>{
 const f=fixture();const attention={...f.task,status:'attention',version:'16'};
 const expected={...f.input,expectedTaskVersion:'16'};
 assert.doesNotThrow(()=>assertSocialProductionStateAdmission(expected,attention,f.job));
 assert.throws(()=>assertSocialProductionStateAdmission(expected,attention,{...f.job,status:'blocked'}),/job_not_admitted/);
 assert.throws(()=>assertSocialProductionStateAdmission(expected,attention,{...f.job,runId:'new-run'}),/job_not_admitted/);
 assert.throws(()=>assertSocialProductionStateAdmission(expected,{...attention,status:'paused'},f.job),/task_not_executing/);
 f.input.approvedContext.agentWorkflow!.executionPlanReview.approved=false;
 assert.throws(()=>assertSocialProductionStateAdmission(expected,attention,f.job),/approved_review_required/);
});

test('verified same-graph label overlay permits only a newly approved runtime review, not another failure or run',()=>{
 const f=fixture(),runtime=structuredClone(f.input.approvedContext.agentWorkflow!);
 const original=f.input.approvedContext.agentWorkflow!;original.executionPlanReview.approved=false;original.executionPlanReview.reasonCodes=['material_insufficient'];
 const raw:any={schemaVersion:'social-benchmark-label-completion.v1',tenantId:f.input.tenantId,taskId:f.input.taskId,runId:f.input.runId,
  planHash:f.input.graphInputHash,sourceIdentity:{recordId:'ref',slots:[]},labels:[],operationId:'op',requestHash:'c'.repeat(64),recordHash:''};
 const hash=(value:unknown)=>socialRequestHash(value);raw.recordHash=hash(raw);
 f.job.checkpoints['social.benchmark_label_completion']={version:'1',inputHash:hash({tenantId:raw.tenantId,taskId:raw.taskId,runId:raw.runId,planHash:raw.planHash,sourceIdentity:raw.sourceIdentity}),payload:raw,updatedAt:'2026-10-28'};
 assert.doesNotThrow(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{overlay:raw,workflow:runtime}));
 original.executionPlanReview.reasonCodes=['facts_missing'];assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{overlay:raw,workflow:runtime}),/label_review_changed/);
 original.executionPlanReview.reasonCodes=['material_insufficient'];
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{overlay:{...raw,runId:'other'},workflow:runtime}),/label_review_changed/);
 runtime.executionPlanReview.approved=false;assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{overlay:raw,workflow:runtime}),/approved_review_required/);
});

test('runtime material review needs exact original-run selection evidence and cannot substitute a review',()=>{
 const f=fixture(),runtime=structuredClone(f.input.approvedContext.agentWorkflow!);
 f.input.approvedContext.agentWorkflow!.executionPlanReview.approved=false;
 f.input.approvedContext.agentWorkflow!.executionPlanReview.reasonCodes=['material_insufficient'];
 const sourcePlanHash='b'.repeat(64),scope={tenantId:f.input.tenantId,taskId:f.input.taskId,runId:f.input.runId};
 const entry={version:'1',inputHash:socialRequestHash(scope),updatedAt:'2026-10-28',payload:{...scope,
  selections:{slot:{phase:'initial',materialId:'material',sourceRevision:'c'.repeat(64),originalPlanHash:sourcePlanHash}}}};
 f.job.checkpoints['social.material_recovery_selection']=entry;
 const proof={workflow:runtime,materialRecovery:{sourcePlanHash,checkpointHash:socialRequestHash(entry),workflowHash:socialRequestHash(runtime)}};
 assert.doesNotThrow(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,proof));
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{workflow:runtime}),/runtime_review_proof_missing/);
 for(const patch of [{sourcePlanHash:'d'.repeat(64)},{checkpointHash:'d'.repeat(64)},{workflowHash:'d'.repeat(64)}])
  assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,{...proof,materialRecovery:{...proof.materialRecovery,...patch}}),/material_review_changed/);
 const otherJob=structuredClone(f.job);(otherJob.checkpoints['social.material_recovery_selection'].payload as typeof entry.payload).runId='other';
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,otherJob,proof),/material_review_changed/);
 runtime.executionPlanReview.approved=false;
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,proof),/material_review_changed|approved_review_required/);
 runtime.executionPlanReview.approved=true;
 f.input.approvedContext.agentWorkflow!.executionPlanReview.reasonCodes=['facts_missing'];
 assert.throws(()=>assertSocialProductionStateAdmission(f.input,f.task,f.job,proof),/material_review_changed/);
});

test('actual same-run initial material recovery repairs attention and replays across projection versions',async t=>{
 const {missingLabelStartFixture}=await import('./socialContentMissingLabelQueueAdmission.fixture.js');
 const {readSocialTaskDetail}=await import('./socialContentRecords.js');
 const {createSocialProductionExecutorCheckpoint,readSocialProductionGraphDetail,socialProductionGraphInput}=await import('./socialContentProductionGraph.js');
 const {buildMaterialScriptAnalysis}=await import('../../shared/materialScriptAnalysis.js');
 const {initialMaterialPlanHash}=await import('./socialContentInitialMaterialPlanIdentity.js');
 const {materialRecoveryScopeHash}=await import('./socialContentMaterialRecovery.js');
 const {runWithContentExecutionContext}=await import('../contentExecution/context.js');
 const {reconcileAdmittedSocialProductionState}=await import('./socialContentProductionState.js');
 const f=await missingLabelStartFixture(t),analysis=JSON.parse(f.record.aiAnalysis);
 for(const shot of analysis.gemini.scriptDetails15s){shot.materialType='factory';shot.classificationEvidence=shot.visual;}
 f.record.aiAnalysis=JSON.stringify(analysis);await f.store.update('trend_videos','reference',{aiAnalysis:f.record.aiAnalysis});
 const resolved=await f.resolve();assert.ok(resolved);resolved.replicationScript.status='confirmed';
 await f.store.update('starter_social_content_tasks','task-row',{run_id:'run',status:'attention',brief:{...f.detail.brief,
  referenceReuse:{...f.detail.brief.referenceReuse,analysisHash:socialRequestHash(analysis)}},reference_video_analysis:resolved.referenceVideoAnalysis,replication_script:resolved.replicationScript});
 let inventory:import('../lib/materialLibrary.js').MaterialRecord[]=[];
 const repository={...f.repository,materialLibrary:async()=>({status:'ready' as const,items:inventory,sources:[]})};
 const scope={repository,tenantId:'tenant',taskId:'film'},before=await readSocialTaskDetail(scope);assert.ok(before?.agentWorkflow);
 assert.ok(before.assetSupplyPlan?.inventoryAudit,'real inventory audit metadata is present');
 const binding=createSocialProductionExecutorCheckpoint(before),approvedContext=binding.payload.approvedContext!;
 const hash='b'.repeat(64),record:import('../lib/materialLibrary.js').MaterialRecord={id:'new',type:'video',tenantId:'tenant',name:'工厂生产线',duration:12,sourceRevision:hash,
  scriptAnalysis:buildMaterialScriptAnalysis({materialId:'new',name:'工厂生产线',sourceRevision:hash,duration:12,
   segments:[{start:0,end:12,observedFacts:'工厂生产线正在运转',subject:'工厂',confidence:.99}],visualObservations:['工厂生产线正在运转']}),
  materialRoles:['factory'],rightsStatus:'owned',rightsEvidenceRef:'ownership:new',commercialUseApproved:true,derivativeUseAllowed:true,
  visualObservations:['工厂生产线正在运转'],segments:[{start:0,end:12}]};
 inventory=[record];
 const originalPlanHash=initialMaterialPlanHash(before.assetSupplyPlan!);
 const initial={schemaVersion:'social-initial-material-block.v1',tenantId:'tenant',taskId:'film',runId:'run',taskVersion:before.version,planHash:originalPlanHash,status:'blocked',
  pending:before.assetSupplyPlan!.shots.map(shot=>({shotId:shot.shotId,materialType:'factory',reason:'awaiting_theme_material',referenceDurationSeconds:3}))};
 const selections=Object.fromEntries(before.assetSupplyPlan!.shots.map(shot=>[shot.shotId,{phase:'initial',materialId:'new',sourceRevision:hash,originalPlanHash,requiredSeconds:3}]));
 const checkpoints={'social.executor':binding,'social.initial_material_block':{version:'1',inputHash:socialRequestHash(initial),updatedAt:new Date().toISOString(),payload:initial},
  'social.material_recovery_selection':{version:'1',inputHash:materialRecoveryScopeHash('tenant','film','run'),updatedAt:new Date().toISOString(),payload:{tenantId:'tenant',taskId:'film',runId:'run',selections}}};
 await f.store.create('content_execution_jobs',{id:'job',tenant_id:'tenant',task_id:'film',run_id:'run',job_key:'job',user_id:'owner',account_id:'account',task_type:'social_content_test',status:'running',checkpoints});
 await f.store.create('workflow_runs',{id:'run',tenant_id:'tenant',status:'running'});
 const input={...scope,runId:'run',jobId:'job',userId:'owner',expectedTaskVersion:before.version,frozenInputHash:binding.inputHash,graphInputHash:binding.inputHash,planVersion:binding.payload.planVersion,approvedContext};
 const run=()=>runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints,action:()=>reconcileAdmittedSocialProductionState(input)});
 const result=await run();assert.equal(result.status,'producing');assert.notEqual(result.version,before.version);
 assert.equal(approvedContext.agentWorkflow!.executionPlanReview.approved,false,'frozen review remains original');
 const frozen=await readSocialProductionGraphDetail(scope,approvedContext);assert.ok(frozen);
 assert.equal(socialProductionGraphInput(frozen,approvedContext).inputHash,binding.inputHash);
 assert.notEqual(frozen.assetSupplyPlan!.planVersion,before.assetSupplyPlan!.planVersion);
 assert.equal(initialMaterialPlanHash(frozen.assetSupplyPlan!),originalPlanHash,'projection versions and scan timestamps cannot break recovery');
 input.expectedTaskVersion=result.version;
 const replay=await run();assert.equal(replay.status,'producing');assert.equal(replay.version,result.version);
 const persisted=await f.store.getById<any>('content_execution_jobs','job');assert.deepEqual(persisted.checkpoints['social.executor'],binding);
 record.commercialUseApproved=false;await assert.rejects(run(),/no_longer_eligible/);
 record.commercialUseApproved=true;Reflect.deleteProperty(checkpoints,'social.material_recovery_selection');
 await f.store.update('content_execution_jobs','job',{checkpoints});
 await assert.rejects(run(),/approved_review_required/);
});
