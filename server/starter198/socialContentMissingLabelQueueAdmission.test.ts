import test from 'node:test';
import assert from 'node:assert/strict';
import {missingLabelStartFixture as fixture} from './socialContentMissingLabelQueueAdmission.fixture.js';
import {canQueueV3InputCompletion,canQueueMissingBenchmarkLabelCompletion} from './socialContentMissingLabelQueueAdmission.js';
import {startSocialContentTask} from './socialContentTasks.js';

test('real start queues label-only completion while original review remains unapproved',async t=>{
 const f=await fixture(t);
 assert.equal(f.detail.agentWorkflow?.executionPlanReview.approved,false);
 assert.equal(canQueueMissingBenchmarkLabelCompletion(f.detail),true,JSON.stringify(f.detail.agentWorkflow));
 let queued=0;
 const result=await startSocialContentTask({repository:f.repository,tenantId:'tenant',userId:'owner',taskId:'film',expectedVersion:'1',idempotencyKey:'label-start',
  referenceResolver:f.resolve,orchestratorQueue:{enqueue:async()=>{queued++;return{queueItemId:'queue',runId:'run',disposition:'queued'};}}});
 assert.equal(queued,1);assert.equal(result.runId,'run');
 assert.equal(result.agentWorkflow?.executionPlanReview.approved,false,'queuing cannot manufacture execution approval');
 assert.equal((await f.store.list('starter_usage_ledger')).totalItems,0);
 assert.equal((await f.store.list('content_execution_jobs')).totalItems,0,'isolated queue port never runs a worker or provider');
});


test('draft start queues label analysis without falsely confirming the draft script',async t=>{
 const f=await fixture(t,'draft');
 assert.equal(canQueueMissingBenchmarkLabelCompletion(f.detail),true);
 let queued=0;
 const result=await startSocialContentTask({repository:f.repository,tenantId:'tenant',userId:'owner',taskId:'film',expectedVersion:'1',idempotencyKey:'draft-label-start',
  referenceResolver:f.resolve,orchestratorQueue:{enqueue:async()=>{queued++;return{queueItemId:'queue',runId:'run',disposition:'queued'};}}});
 assert.equal(queued,1);assert.equal(result.replicationScript?.status,'review_required');
 assert.equal(result.agentWorkflow?.executionPlanReview.approved,false);
});

test('queue exception cannot waive source, fixed sentence slots or unrelated review failures',async t=>{
 const f=await fixture(t);
 const changes:Array<(detail:typeof f.detail)=>void>=[
  d=>{d.brief.materialRoutingPolicyVersion='type-aware.v2';},
  d=>{d.brief.referenceReuse=undefined;},
  d=>{d.brief.referenceReuse!.recordId='foreign';},
  d=>{d.sources[0]!.status='removed';},
  d=>{d.referenceVideoAnalysis!.coverage!.fullTimelineCovered=false;},
  d=>{d.replicationScript!.status='superseded';},
  d=>{d.agentWorkflow!.executionPlanReview.reasonCodes.push('rights_missing');},
  d=>{d.agentWorkflow!.executionPlanReview.reasonCodes.push('facts_missing');},
  d=>{d.agentWorkflow!.executionPlanReview.reasonCodes.push('budget_exceeded');},
  d=>{d.agentWorkflow!.executionPlanReview.sceneResults[0]!.failedCriteria.push('another unrelated requirement');},
  d=>{d.agentWorkflow!.directorBrief.scenes.reverse();},
  d=>{d.agentWorkflow!.directorBrief.scenes[0]!.voiceoverLines=undefined;},
  d=>{d.agentWorkflow!.directorBrief.scenes[0]!.voiceoverLines![0]!.visualShotIds=['foreign'];},
 ];
 for(const change of changes){const current=structuredClone(f.detail);change(current);assert.equal(canQueueMissingBenchmarkLabelCompletion(current),false,String(change));assert.equal(canQueueV3InputCompletion(current),false,String(change));}
});

test('actual start queues known missing-theme slots into existing input completion without approving production',async t=>{
 const f=await fixture(t);
 const analysis=JSON.parse(f.record.aiAnalysis);analysis.gemini.scriptDetails15s[1].materialType='factory';
 f.record.aiAnalysis=JSON.stringify(analysis);
 let queued=0;
 const result=await startSocialContentTask({repository:f.repository,tenantId:'tenant',userId:'owner',taskId:'film',expectedVersion:'1',idempotencyKey:'non-label-blocked',
  referenceResolver:f.resolve,orchestratorQueue:{enqueue:async()=>{queued++;return{queueItemId:'queue',runId:'run'};}}});
 assert.equal(queued,1);assert.equal(result.agentWorkflow?.executionPlanReview.approved,false);assert.equal(canQueueV3InputCompletion(result),true);assert.equal(canQueueMissingBenchmarkLabelCompletion(result),false); assert.equal((await f.store.list('content_execution_jobs')).totalItems,0);
});


test('actual start queues an unregistered talking-head slot for the existing shooting task',async t=>{
 const f=await fixture(t,'draft');
 const analysis=JSON.parse(f.record.aiAnalysis);
 for(const shot of analysis.gemini.scriptDetails15s)shot.materialType='talking_head';
 f.record.aiAnalysis=JSON.stringify(analysis);
 let queued=0;
 const result=await startSocialContentTask({repository:f.repository,tenantId:'tenant',userId:'owner',taskId:'film',expectedVersion:'1',idempotencyKey:'shooting-input',
  referenceResolver:f.resolve,orchestratorQueue:{enqueue:async()=>{queued++;return{queueItemId:'queue',runId:'run'};}}});
 assert.equal(queued,1);assert.equal(result.agentWorkflow?.executionPlanReview.approved,false);
 assert.equal(canQueueV3InputCompletion(result),true);assert.equal(canQueueMissingBenchmarkLabelCompletion(result),false);
 assert.ok(result.assetSupplyPlan?.shots.every(shot=>shot.materialRouting?.pendingReason==='awaiting_shoot'));
 assert.equal((await f.store.list('starter_usage_ledger')).totalItems,0);
});
