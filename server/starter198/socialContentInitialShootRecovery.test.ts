import test from 'node:test';
import assert from 'node:assert/strict';
import {missingLabelStartFixture} from './socialContentMissingLabelQueueAdmission.fixture.js';
import {socialRequestHash} from './socialContentValidation.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {ensureInitialShootTasks,readInitialShootTaskVersions} from './socialContentInitialShootTask.js';
import {blockOnInitialMaterialSupply} from './socialContentInitialMaterialBlock.js';
import {recoverSocialContentExecution} from './socialContentExecutionRecovery.js';
import {applyInitialMaterialRecovery} from './socialContentMaterialRecovery.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';

test('current content version CAS retains original shoot version through user selection and later worker phases',async t=>{
 const f=await missingLabelStartFixture(t),analysis=JSON.parse(f.record.aiAnalysis);
 for(const shot of analysis.gemini.scriptDetails15s){shot.materialType='talking_head';shot.visual='真人对镜头口播';shot.classificationEvidence=shot.visual;}
 f.record.aiAnalysis=JSON.stringify(analysis);await f.store.update('trend_videos','reference',{aiAnalysis:f.record.aiAnalysis});
 const resolved=await f.resolve();assert.ok(resolved);resolved.replicationScript.status='confirmed';
 await f.store.update('starter_social_content_tasks','task-row',{run_id:'run',version:'7',status:'producing',brief:{...f.detail.brief,referenceReuse:{...f.detail.brief.referenceReuse,analysisHash:socialRequestHash(analysis)}},reference_video_analysis:resolved.referenceVideoAnalysis,replication_script:resolved.replicationScript});
 const scope={repository:f.repository,tenantId:'tenant',taskId:'film'},original=await readSocialTaskDetail(scope);assert.ok(original?.assetSupplyPlan);
 const shootScope={store:f.store,tenantId:'tenant',taskId:'film',runId:'run',taskVersion:'7',plan:original.assetSupplyPlan,scenes:original.agentWorkflow!.directorBrief.scenes};
 const ids=await ensureInitialShootTasks(shootScope);
 const firstSlot=original.assetSupplyPlan.shots[0]!.shotId,shootingTaskId=ids[firstSlot]!;
 const shoot=await f.store.getById<any>('studio_shooting_tasks',shootingTaskId);
 await f.store.update('studio_shooting_tasks',shootingTaskId,{payload:{...shoot.payload,uploadedMaterialIds:['capture']}});
 const presenter={id:'person',authorized:true,assetVersion:2,avatarId:'avatar',voiceId:'voice',referenceMaterialIds:['capture'],rightsEvidence:{authorizationRef:'document://presenter/person',consentRef:'consent://presenter/person',grantedAt:'2026-10-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}};
 await f.store.create('studio_production_defaults',{id:'defaults',tenant_id:'tenant',payload:{presenters:[presenter]}});
 await f.store.update('starter_social_content_tasks','task-row',{version:'8',status:'needs_input'});
 // A worker replay may refresh the checkpoint after lifecycle projection.
 // Preserve the immutable shoot creation stamp on each pending slot.
 assert.deepEqual(await ensureInitialShootTasks({...shootScope,taskVersion:'8'}),ids);
 let checkpoint:any;
 await assert.rejects(blockOnInitialMaterialSupply({...shootScope,taskVersion:'8',shootingTaskIds:ids,
  shootingTaskVersions:await readInitialShootTaskVersions(f.store,'tenant',ids),
  record:async entry=>{checkpoint={...entry,updatedAt:new Date().toISOString()};}}),/initial_material_supply/);
 assert.equal(checkpoint.payload.taskVersion,'8');
 assert.equal(checkpoint.payload.pending[0].shootingTaskVersion,'7');
 await f.store.create('workflow_runs',{id:'run',tenant_id:'tenant',status:'running'});
 await f.store.create('content_execution_jobs',{id:'job',tenant_id:'tenant',task_id:'film',run_id:'run',job_key:'job',user_id:'owner',account_id:'account',task_type:'social_content_test',status:'blocked',checkpoints:{'social.initial_material_block':checkpoint}});
 const command={action:'resume_presenter_supply' as const,jobId:'job',runId:'run',expectedVersion:'8',slotId:firstSlot,shootingTaskId,presenterAssetId:'person'};
 const input={...scope,userId:'owner',idempotencyKey:'recover-presenter',command};
 await assert.rejects(recoverSocialContentExecution({...input,command:{...command,expectedVersion:'7'}}),/task_changed/);
 const resumed=await recoverSocialContentExecution(input);assert.equal(resumed.status,'queued');
 const job=await f.store.getById<any>('content_execution_jobs','job');
 assert.equal(job.checkpoints['social.material_recovery_selection'].payload.selections[firstSlot].shootingTaskVersion,'7');
 const run=()=>runWithContentExecutionContext({dataStore:f.store,jobId:'job',checkpoints:job.checkpoints,
  action:()=>applyInitialMaterialRecovery({...scope,runId:'run',taskVersion:'9',plan:{...original.assetSupplyPlan!,planVersion:'9'}})});
 const recovered=await run();assert.deepEqual(recovered.plan.shots[0]!.digitalHumanPlan!.presenterAssetIds,['person']);
 assert.equal(recovered.plan.shots[1]!.materialRouting!.pendingReason,'awaiting_shoot');
 await f.store.update('studio_production_defaults','defaults',{payload:{presenters:[{...presenter,assetVersion:3}]}});
 await assert.rejects(run(),/no_longer_eligible/);
});
