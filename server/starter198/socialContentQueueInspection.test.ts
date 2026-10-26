import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSocialContentQueue } from './socialContentQueueInspection.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';

type Input = Parameters<typeof inspectSocialContentQueue>[0];
function fixture(): Input {
  return { tenantId: 'tenant', localPreview: false, queueConfigured: true, capabilityRuntime: [],
    task: { taskId: 'task', version: '7', runId: null, status: 'plan_review', brief: {},
      readiness: { complete: true, missing: [] },
      assetSupplyPlan: { shots: [1, 2].map(index => ({ shotId: `scene-${index}`,
        materialRouting: { materialType: 'product', policy: 'local_only', localMatch: { state: 'missing',
          rejections: [{ assetId: 'asset', reasons: ['rights_evidence_missing', 'commercial_use_not_allowed'] }] } } })) },
      agentWorkflow: { executionPlan: { scenes: [1, 2].map(index => ({ sceneId: `scene-${index}`, recommendedCandidateIds: [] })) },
        executionPlanReview: { approved: false, sceneResults: [] } },
    } as unknown as Input['task'] };
}

test('explains missing rights once per asset while retaining every affected scene, without mutating evidence', () => {
  const input = fixture(), before = JSON.stringify(input), result = inspectSocialContentQueue(input);
  assert.equal(result.canRequestStart, false);
  const rights = result.candidateNotes.find(issue => issue.code === 'rights_evidence_missing');
  assert.equal(result.issues.some(issue => issue.code === 'rights_evidence_missing'), false,
    'unselected alternatives must not become a demand to authorize the whole library');
  assert.deepEqual(rights?.assetIds, ['asset']); assert.deepEqual(rights?.sceneIds, ['scene-1', 'scene-2']);
  assert.equal(result.scenes.length, 2); assert.equal(JSON.stringify(input), before);
});

test('resolved candidates do not inherit stale rejected alternatives as production blockers', () => {
  const input = fixture(); input.task.agentWorkflow!.executionPlanReview.approved = true;
  for (const scene of input.task.agentWorkflow!.executionPlan.scenes) scene.recommendedCandidateIds = ['approved'];
  const result = inspectSocialContentQueue(input);
  assert.equal(result.canRequestStart, true); assert.deepEqual(result.issues, []);
  assert.equal(inspectSocialContentQueue({ ...input, localPreview: true }).canRequestStart, false);
  assert.equal(inspectSocialContentQueue({ ...input, queueConfigured: false }).canRequestStart, false);
});

test('a selected and authorized presenter still requires a registered production capability', () => {
  const input = fixture(); const shot = input.task.assetSupplyPlan!.shots[0]!;
  shot.materialRouting!.policy = 'authorized_presenter'; shot.materialRouting!.materialType = 'talking_head';
  shot.digitalHumanPlan = { presenterAssetIds: ['authorized-presenter'] } as NonNullable<typeof shot.digitalHumanPlan>;
  const result = inspectSocialContentQueue(input);
  assert.ok(result.issues.some(issue => issue.code === 'social_content_presenter_runtime_unavailable'));
  assert.equal(result.issues.some(issue => issue.code === 'social_content_presenter_asset_required'), false);
});

test('existing runs never offer a second original start and queue identities must match the authenticated task', () => {
  const input = fixture(); input.task.runId = 'run';
  assert.ok(inspectSocialContentQueue(input).issues.some(issue => issue.code === 'social_content_execution_job_pending'));
  const job = { id: 'job', tenantId: 'tenant', taskId: 'task', runId: 'run', status: 'queued', attempt: 0,
    nextAttemptAt: null } as ContentExecutionJob;
  const result = inspectSocialContentQueue({ ...input, job });
  assert.equal(result.job?.id, 'job'); assert.equal(result.canRequestStart, false);
  assert.throws(() => inspectSocialContentQueue({ ...input, job: { ...job, tenantId: 'another' } }), /identity_mismatch/);
  assert.throws(() => inspectSocialContentQueue({ ...input, job: { ...job, runId: 'stale-run' } }), /identity_mismatch/);
});

test('budget estimate stays visible as pending formal pricing without inventing a second admission threshold',()=>{
 const input=fixture();input.task.agentWorkflow!.executionPlanReview.approved=true;
 for(const scene of input.task.agentWorkflow!.executionPlan.scenes)scene.recommendedCandidateIds=['candidate'];
 input.task.agentWorkflow!.executionPlanReview.budgetPreflight={state:'required',advisoryEstimatedCostCny:45.45,maximumCny:19,advisoryExceeded:true};
 const report=inspectSocialContentQueue(input);
 assert.equal(report.budgetPreflight?.advisoryEstimatedCostCny,45.45);assert.equal(report.canRequestStart,true);
 assert.equal(report.issues.some(issue=>issue.code.includes('budget')),false,'original paid preflight remains the formal budget authority');
});

test('a native production block exposes its safe product reason without leaking vendor error bodies',()=>{
 const input=fixture();input.task.runId='run';
 const job={id:'job',tenantId:'tenant',taskId:'task',runId:'run',status:'blocked',attempt:1,nextAttemptAt:null,
  lastError:'user_input_required:presenter_speech_route_unavailable:scene:private-vendor-response'} as ContentExecutionJob;
 const report=inspectSocialContentQueue({...input,job});
 const reason=report.issues.find(issue=>issue.code==='presenter_speech_route_unavailable');
 assert.ok(reason?.message.includes('无需重复办理'));
 assert.equal(JSON.stringify(report).includes('private-vendor-response'),false);
});

test('missing billing bounds explain the original queue pause without leaking provider input',()=>{
 const input=fixture();input.task.runId='run';
 const job={id:'job',tenantId:'tenant',taskId:'task',runId:'run',status:'blocked',attempt:1,nextAttemptAt:null,
  lastError:'user_input_required:whole_film_budget_preflight:provider_usage_bound_missing:private-input'} as ContentExecutionJob;
 const report=inspectSocialContentQueue({...input,job});
 assert.ok(report.issues.some(issue=>issue.code==='production_provider_billing_bound_missing'));
 assert.equal(report.canRequestStart,false);
 assert.equal(JSON.stringify(report).includes('private-input'),false);
});

test('inspection carries safe balance reason and bound retry identity while blocking a second original start',()=>{
 const input=fixture();input.task.runId='run';
 const job: ContentExecutionJob={id:'job',tenantId:'tenant',taskId:'task',runId:'run',jobKey:'key',userId:'user',accountId:'account',taskType:'content',status:'blocked',attempt:1,reconciliationAttempt:0,retryClass:'insufficient_balance',createdAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:00:00Z',lastStartedAt:null,completedAt:null,nextAttemptAt:null,workerId:null,leaseExpiresAt:null,
  lastError:'native_speech_track_provider_failed:MOVIO_PAYMENT_INSUFFICIENT_CREDIT:private',providerState:'none',checkpoints:{'social.voice_route_amendment':{version:'1',inputHash:'fixture',updatedAt:'2026-10-25',payload:{executionMode:'native_video',newIntent:{operationId:'paid-op',model:'avatar_iv',stage:'tts'}}}},
  providerReceipts:[{provider:'heygen',requestId:'paid-op',state:'failed',providerTaskId:'video',metadata:{stage:'tts',model:'avatar_iv',operationId:'paid-op',failureCode:'MOVIO_PAYMENT_INSUFFICIENT_CREDIT'},firstRecordedAt:'2026-10-25',updatedAt:'2026-10-25'}]};
 const report=inspectSocialContentQueue({...input,job});
 assert.equal(report.job?.label,'余额不足 · 可恢复');assert.ok(report.recovery?.action==='retry_failed_native_voice');assert.equal(report.recovery.failedOperationId,'paid-op');assert.equal(report.recovery?.canRequest,true);
 assert.equal(report.canRequestStart,false);assert.equal(JSON.stringify(report).includes('private'),false);
});
