import test from 'node:test';
import assert from 'node:assert/strict';
import {missingLabelStartFixture} from './socialContentMissingLabelQueueAdmission.fixture.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {createSocialProductionExecutorCheckpoint,readSocialProductionGraphDetail,socialProductionGraphInput} from './socialContentProductionGraph.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {socialRequestHash} from './socialContentValidation.js';
import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import {materialRecoveryScopeHash} from './socialContentMaterialRecovery.js';
import {recoverSocialContentExecution} from './socialContentExecutionRecovery.js';
import {blockOnInitialMaterialSupply} from './socialContentInitialMaterialBlock.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import type {MaterialRecord} from '../lib/materialLibrary.js';

test('new authorized slot selection restores runtime review while original graph inventory and authority stay frozen',async t=>{
 const f=await missingLabelStartFixture(t),analysis=JSON.parse(f.record.aiAnalysis);
 for(const shot of analysis.gemini.scriptDetails15s){shot.materialType='factory';shot.classificationEvidence=shot.visual;}
 f.record.aiAnalysis=JSON.stringify(analysis);await f.store.update('trend_videos','reference',{aiAnalysis:f.record.aiAnalysis});
 const resolved=await f.resolve();assert.ok(resolved);resolved.replicationScript.status='confirmed';
 await f.store.update('starter_social_content_tasks','task-row',{run_id:'run',status:'producing',brief:{...f.detail.brief,referenceReuse:{...f.detail.brief.referenceReuse,analysisHash:socialRequestHash(analysis)}},reference_video_analysis:resolved.referenceVideoAnalysis,replication_script:resolved.replicationScript});
 let inventory:MaterialRecord[]=[];
 const repository={...f.repository,materialLibrary:async()=>({status:'ready' as const,items:inventory,sources:[]})};
 const scope={repository,tenantId:'tenant',taskId:'film'},before=await readSocialTaskDetail(scope);assert.ok(before?.agentWorkflow);
 assert.equal(before.agentWorkflow.executionPlanReview.approved,false);
 const binding=createSocialProductionExecutorCheckpoint(before),context=binding.payload.approvedContext!;
 const hash='b'.repeat(64),record:MaterialRecord={id:'new',type:'video',tenantId:'tenant',name:'工厂生产线',duration:12,sourceRevision:hash,
  scriptAnalysis:buildMaterialScriptAnalysis({materialId:'new',name:'工厂生产线',sourceRevision:hash,duration:12,segments:[{start:0,end:12,observedFacts:'工厂生产线正在运转',subject:'工厂',confidence:.99}],visualObservations:['工厂生产线正在运转']}),
  materialRoles:['factory'],rightsStatus:'owned',rightsEvidenceRef:'ownership:new',commercialUseApproved:true,derivativeUseAllowed:true,visualObservations:['工厂生产线正在运转'],segments:[{start:0,end:12}]};
 inventory=[record];
 const selections=Object.fromEntries(before.assetSupplyPlan!.shots.map(shot=>[shot.shotId,{phase:'initial',materialId:'new',sourceRevision:hash,originalPlanHash:initialMaterialPlanHash(before.assetSupplyPlan!),requiredSeconds:3}]));
 const recovery={version:'1',inputHash:materialRecoveryScopeHash('tenant','film','run'),updatedAt:new Date().toISOString(),payload:{tenantId:'tenant',taskId:'film',runId:'run',selections}};
 const checkpoints={'social.executor':binding,'social.material_recovery_selection':recovery};
 await f.store.create('content_execution_jobs',{id:'job',tenant_id:'tenant',task_id:'film',run_id:'run',job_key:'job',user_id:'owner',account_id:'account',task_type:'social_content_test',status:'running',checkpoints});
 await f.store.create('workflow_runs',{id:'run',tenant_id:'tenant',status:'running'});
 const raw=await readSocialTaskDetail(scope);assert.ok(raw?.agentWorkflow);
 assert.notEqual(socialRequestHash(raw.agentWorkflow),socialRequestHash(before.agentWorkflow),'new inventory changes unrestricted projections');
 const frozen=await readSocialProductionGraphDetail(scope,context);assert.ok(frozen);
 assert.equal(socialProductionGraphInput(frozen,context).inputHash,binding.inputHash);
 const derived=await runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints,action:()=>readSocialProductionGraphDetail({...scope,runtimeMaterialRecovery:true},context)});assert.ok(derived?.agentWorkflow);
 assert.equal(derived.agentWorkflow.executionPlanReview.approved,true,JSON.stringify(derived.agentWorkflow.executionPlanReview));
 assert.ok(derived.assetSupplyPlan!.shots.every(shot=>shot.materialRouting?.localMatch.state==='matched'&&shot.sourceRefs.includes('new')));
 assert.equal(socialProductionGraphInput((await readSocialProductionGraphDetail(scope,context))!,context).inputHash,binding.inputHash);
 record.commercialUseApproved=false;
 await assert.rejects(runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints,action:()=>readSocialProductionGraphDetail({...scope,runtimeMaterialRecovery:true},context)}),/no_longer_eligible/);
 record.commercialUseApproved=true;
 const initialCheckpoints={'social.executor':binding};
 await assert.rejects(runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints:initialCheckpoints,
  action:()=>blockOnInitialMaterialSupply({...scope,runId:'run',taskVersion:before.version,plan:before.assetSupplyPlan,referenceScenes:before.agentWorkflow!.directorBrief.scenes})}),/initial_material_supply/);
 await f.store.update('content_execution_jobs','job',{status:'blocked'});
 const selectedSlot=before.assetSupplyPlan!.shots[0]!.shotId;
 const resumed=await recoverSocialContentExecution({...scope,userId:'owner',idempotencyKey:'resume-uploaded-material',command:{action:'resume_material_supply',jobId:'job',runId:'run',expectedVersion:before.version,slotId:selectedSlot,materialId:'new'}});
 assert.equal(resumed.status,'queued');
 const resumedJob=await f.store.getById<any>('content_execution_jobs','job');
 assert.equal(resumedJob.checkpoints['social.material_recovery_selection'].payload.selections[selectedSlot].materialId,'new');
 const partial=await runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints:resumedJob.checkpoints,action:()=>readSocialProductionGraphDetail({...scope,runtimeMaterialRecovery:true},context)});assert.ok(partial);
 assert.equal(partial.assetSupplyPlan!.shots[0]!.materialRouting!.pendingReason,undefined);
 assert.equal(partial.assetSupplyPlan!.shots[1]!.materialRouting!.pendingReason,'awaiting_theme_material');
 assert.equal(socialProductionGraphInput((await readSocialProductionGraphDetail(scope,context))!,context).inputHash,binding.inputHash);

});
