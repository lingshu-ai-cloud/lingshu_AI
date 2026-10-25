import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import type { StarterRecord } from './repository.js';
import type { SocialGraphApprovedContext } from './socialContentProductionExecution.js';
import { assertSocialProductionStateAdmission } from './socialContentProductionState.js';
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
