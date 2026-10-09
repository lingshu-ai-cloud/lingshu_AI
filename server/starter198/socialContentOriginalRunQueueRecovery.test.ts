import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyControlledOriginalRunFixture} from '../runtime/weeklyControlledOriginalRun.fixture.js';
import {ensureOriginalSocialContentProductionQueued} from './socialContentOriginalRunQueueRecovery.js';
import {enqueueSocialContentAutoProduction} from './socialContentProductionQueue.js';
import {SocialContentWorkflowError} from './socialContentValidation.js';

test('missing material admission leaves controlled preexisting owned run nonterminal without suppliers or replacement run',async t=>{
 const {f,created}=await prepareWeeklyControlledOriginalRunFixture(t);const input={repository:f.repository,tenantId:'t',userId:'owner',taskId:String(created.task_id),runId:String(created.run_id)};const run=f.tables.workflow_runs!.find(row=>row.id===input.runId)!;assert.equal(run.status,'running');const count=f.tables.workflow_runs!.length;
 const rejected=(error:unknown)=>error instanceof SocialContentWorkflowError&&/^weekly_material_|^weekly_required_material/.test(error.code);
 await assert.rejects(enqueueSocialContentAutoProduction(input),rejected);assert.equal(run.status,'running','prerequisite gaps must not fail an execution that never entered the queue');
 await assert.rejects(ensureOriginalSocialContentProductionQueued(input),rejected);assert.equal(run.status,'running');assert.equal(f.tables.workflow_runs!.length,count);assert.equal(created.run_id,input.runId);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
 const old=run.tenant_id;run.tenant_id='foreign';await assert.rejects(ensureOriginalSocialContentProductionQueued(input),{code:'weekly_original_run_queue_identity_invalid'});run.tenant_id=old;run.status='completed';await assert.rejects(ensureOriginalSocialContentProductionQueued(input),{code:'weekly_original_run_queue_identity_invalid'});
});


// Persisted queue rows below exercise registration identity only: no completed
// production evidence or material readiness is inferred from their statuses.
test('existing original job states are read only and malformed queue identity cannot trigger replacement',async t=>{
 const {prepareWeeklyQualityAuditFixture}=await import('../runtime/weeklyContentQualityAudit.fixture.js');
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const content=f.tables.starter_social_content_tasks![0]!;content.status='producing';
 const runId=String(content.run_id),taskId=String(content.task_id);
 const run=await f.store.getById<Record<string,unknown>>('workflow_runs',runId);assert.ok(run);
 await f.store.update('workflow_runs',runId,{status:'running',starter_context:{schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:taskId}});
 const job=await f.store.create('content_execution_jobs',{tenant_id:'t',task_id:taskId,run_id:runId,task_type:`social_content_${content.task_mode}`,status:'running'});assert.ok(job);
 const input={repository:f.repository,tenantId:'t',userId:'owner',taskId,runId};
 for(const state of ['running','blocked','dead_letter','succeeded','cancelled']){
  await f.store.update('content_execution_jobs',job.id,{status:state});
  const before=JSON.stringify(f.tables.content_execution_jobs);
  assert.deepEqual(await ensureOriginalSocialContentProductionQueued(input),{status:'existing',jobId:job.id,jobStatus:state});
  assert.equal(JSON.stringify(f.tables.content_execution_jobs),before);
 }
 await f.store.update('content_execution_jobs',job.id,{status:'unsupported'});
 await assert.rejects(ensureOriginalSocialContentProductionQueued(input),{code:'weekly_original_run_queue_identity_invalid'});
 await f.store.update('content_execution_jobs',job.id,{status:'running',task_type:'social_content_foreign'});
 await assert.rejects(ensureOriginalSocialContentProductionQueued(input),{code:'weekly_original_run_queue_identity_invalid'});
 await assert.rejects(ensureOriginalSocialContentProductionQueued({...input,runId:'foreign-run'}),{code:'weekly_original_run_queue_state_changed'});
 await assert.rejects(ensureOriginalSocialContentProductionQueued({...input,tenantId:'foreign'}));
 await f.store.update('content_execution_jobs',job.id,{status:'running',task_type:`social_content_${content.task_mode}`});
 await f.store.create('content_execution_jobs',{tenant_id:'t',task_id:taskId,run_id:runId,task_type:`social_content_${content.task_mode}`,status:'queued'});
 await assert.rejects(ensureOriginalSocialContentProductionQueued(input),{code:'weekly_original_run_queue_ambiguous'});
 assert.equal(f.tables.content_execution_jobs!.length,2);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
