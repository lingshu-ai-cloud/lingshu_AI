import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { socialContentQueueProjection } from './socialContentQueueProjection.js';
const fixture = (patch: Partial<ContentExecutionJob> = {}) => ({ id:'job',tenantId:'tenant',taskId:'task',runId:'run',
 status:'blocked',attempt:1,nextAttemptAt:null,lastError:'native_speech_track_provider_failed:MOVIO_PAYMENT_INSUFFICIENT_CREDIT:private-vendor-body',
 workerId:null,leaseExpiresAt:null,providerState:'none',providerReceipts:[],checkpoints:{'social.voice_route_amendment':{payload:{executionMode:'native_video',newIntent:{operationId:'paid-op',model:'avatar_iv',stage:'tts'}}}},...patch } as ContentExecutionJob);
const failed = {provider:'heygen',requestId:'paid-op',state:'failed' as const,providerTaskId:'video',
 metadata:{stage:'tts',model:'avatar_iv',operationId:'paid-op',failureCode:'MOVIO_PAYMENT_INSUFFICIENT_CREDIT'},
 firstRecordedAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:01:00Z'};

test('terminal balance failure uses safe durable status and canonical-recovery hint, never raw errors',()=>{
 const result=socialContentQueueProjection(fixture({providerReceipts:[failed]}));
 assert.equal(result.label,'余额不足 · 可恢复');assert.equal(result.failureCode,'insufficient_balance');
 assert.ok(result.recovery?.action==='retry_failed_native_voice');assert.equal(result.recovery.failedOperationId,'paid-op');assert.equal(result.recovery?.canRequest,true);
 assert.equal(JSON.stringify(result).includes('private-vendor-body'),false);
});
test('unsettled/unknown receipt always takes precedence over a historic failure and forbids a paid retry',()=>{
 for(const state of ['submitting','accepted','unknown'] as const){
  const result=socialContentQueueProjection(fixture({providerReceipts:[failed,{...failed,requestId:'new-op',state}]}));
  assert.equal(result.label,'供应商结果待核对');assert.equal(result.requiresReconciliation,true);assert.equal(result.recovery,undefined);
 }
});
test('queued or running new attempts never offer another recovery from a previous failed receipt',()=>{
 for(const status of ['queued','running','succeeded','cancelled'] as const){
  const result=socialContentQueueProjection(fixture({status,providerReceipts:[failed]}));assert.equal(result.recovery,undefined);
 }
 assert.equal(socialContentQueueProjection(fixture({status:'running',lastError:null})).label,'制作中');
 assert.equal(socialContentQueueProjection(fixture({status:'succeeded',lastError:null})).label,'执行完成 · 待验收');
});
test('resumed queued/running states hide retained audit errors but waiting and blocked states preserve their reason',()=>{
 const lastError='social_content_idempotency_key_reused:old audit failure';
 for(const status of ['queued','running'] as const){
  const job=fixture({status,lastError,providerState:'completed'});
  const result=socialContentQueueProjection(job);
  assert.equal(result.reason,null);assert.equal(result.failureCode,null);
  assert.equal(result.requiresReconciliation,false);assert.equal(job.lastError,lastError,'projection must retain audit data');
 }
 for(const status of ['retry_wait','reconciling','blocked'] as const){
  const result=socialContentQueueProjection(fixture({status,lastError,providerState:'completed'}));
  assert.ok(result.reason);assert.ok(result.failureCode);
 }
 const unknown=socialContentQueueProjection(fixture({status:'running',lastError,providerState:'unknown',providerReceipts:[{...failed,state:'unknown'}]}));
 assert.equal(unknown.label,'供应商结果待核对');assert.equal(unknown.requiresReconciliation,true);assert.equal(unknown.recovery,undefined);
});
test('only native terminal failure identity enables the recovery hint; worker ownership blocks action',()=>{
 assert.equal(socialContentQueueProjection(fixture({checkpoints:{}})).recovery,undefined);
 assert.equal(socialContentQueueProjection(fixture({providerReceipts:[{...failed,metadata:{...failed.metadata,model:'starfish'}}]})).recovery,undefined);
 assert.equal(socialContentQueueProjection(fixture({providerReceipts:[failed],workerId:'worker'})).recovery?.canRequest,false);
});

test('page hydration uses one tenant-scoped queue read and ignores old runs and other tenants',async()=>{
 const {hydrateSocialContentExecutionSummaries}=await import('./socialContentQueueProjection.js');
 const jobs=[{id:'current',tenant_id:'tenant',task_id:'task',run_id:'run',job_key:'key',user_id:'user',account_id:'account',task_type:'content',status:'blocked',attempt:1,last_error:'insufficient_balance'},
  {id:'old',tenant_id:'tenant',task_id:'task',run_id:'old',job_key:'key2',user_id:'user',account_id:'account',task_type:'content',status:'succeeded'},
  {id:'foreign',tenant_id:'other',task_id:'task',run_id:'run',job_key:'key3',user_id:'user',account_id:'account',task_type:'content',status:'running'}];
 let reads=0;
 const store={list:async(_collection: string,query: {where?: Record<string,unknown>})=>{reads++;assert.deepEqual(query.where,{tenant_id:'tenant'});return {items:jobs,totalItems:3,totalPages:1,page:1,perPage:200};}} as unknown as import('../storage/datastore.js').DataStore;
 const items=[{taskId:'task',runId:'run',status:'plan_review'},{taskId:'unstarted',runId:null,status:'draft'}] as import('../../shared/contracts/socialContentWorkflow.js').SocialContentTaskSummary[];
 const result=await hydrateSocialContentExecutionSummaries({store,tenantId:'tenant',items});
 assert.equal(reads,1);assert.equal(result[0]?.execution?.id,'current');assert.equal(result[0]?.execution?.label,'余额不足 · 可恢复');
 assert.equal(result[1]?.execution,undefined);assert.equal(items[0]?.execution,undefined);
 jobs.push({...jobs[0]!,id:'duplicate'});
 await assert.rejects(hydrateSocialContentExecutionSummaries({store,tenantId:'tenant',items}),/integrity_violation/);
});

test('legacy native failure is only a candidate checked against the canonical receipt by recovery command',()=>{
 const checkpoints={'social.voice_route_amendment':{payload:{executionMode:'native_video',newIntent:{operationId:'legacy-native',model:'avatar_iv',stage:'tts'}}}} as unknown as ContentExecutionJob['checkpoints'];
 const result=socialContentQueueProjection(fixture({checkpoints}));
 assert.ok(result.recovery?.action==='retry_failed_native_voice');assert.equal(result.recovery.failedOperationId,'legacy-native');assert.equal(result.recovery?.canRequest,true);
 const unknown=socialContentQueueProjection(fixture({checkpoints,lastError:'native_speech_track_submission_unknown_no_repost'}));
 assert.equal(unknown.requiresReconciliation,true);assert.equal(unknown.recovery,undefined);
});

test('known accepted task on an active queue is processing; blocked acceptance and unknown remain warnings',()=>{
 for(const status of ['queued','running','retry_wait','reconciling'] as const){
  const result=socialContentQueueProjection(fixture({status,providerState:'accepted',providerReceipts:[{...failed,state:'accepted'}]}));
  assert.equal(result.label,'供应商制作中');assert.equal(result.tone,'processing');assert.equal(result.requiresReconciliation,true);
  assert.equal(result.recovery,undefined);assert.match(result.reason!,/无需重复提交/);
 }
 for(const override of [{status:'blocked' as const},{providerState:'unknown'},{providerReceipts:[{...failed,state:'unknown' as const}]},{providerReceipts:[{...failed,state:'accepted' as const,providerTaskId:null}]}]){
  const result=socialContentQueueProjection(fixture({status:'reconciling',providerState:'accepted',providerReceipts:[{...failed,state:'accepted'}],...override}));
  assert.equal(result.label,'供应商结果待核对');assert.equal(result.tone,'warning');assert.equal(result.recovery,undefined);
 }
});

test('completed current mother track resumes downstream work and never retries a historical failed operation',()=>{
 const current={...failed,requestId:'current-op',state:'completed' as const,metadata:{...failed.metadata,operationId:'current-op'}};
 const checkpoints={'social.voice_route_amendment':{payload:{executionMode:'native_video',newIntent:{operationId:'current-op',model:'avatar_iv',stage:'tts'}}}} as unknown as ContentExecutionJob['checkpoints'];
 const result=socialContentQueueProjection(fixture({lastError:'native_speech_track_subtitle_invalid',providerState:'completed',providerReceipts:[failed,current],checkpoints}));
 assert.equal(result.recovery?.action,'resume_existing_execution');assert.equal(result.recovery?.canRequest,true);
 assert.ok(!('failedOperationId' in result.recovery!));assert.match(result.recovery!.reason,/复用已完成/);
 for(const state of ['submitting','accepted','unknown'] as const){
  const pending=socialContentQueueProjection(fixture({providerState:'completed',providerReceipts:[current,{...failed,state}],checkpoints}));
  assert.equal(pending.recovery,undefined);
 }
});


test('quality-blocked archived output directs to original task instead of repeated queue recovery',()=>{
 const completed={...failed,requestId:'done',state:'completed' as const};
 for(const status of ['blocked','paused','dead_letter'] as const){
  const result=socialContentQueueProjection(fixture({status,lastError:'social_graph_quality_failed:private-quality-evidence',providerState:'completed',providerReceipts:[completed]}));
  assert.equal(result.label,'质量检查待处理');assert.equal(result.failureCode,'input_required');
  assert.equal(result.recovery,undefined);assert.match(result.reason!,/打开原任务/);
  assert.equal(JSON.stringify(result).includes('private-quality-evidence'),false);
 }
 for(const state of ['submitting','accepted','unknown'] as const){
  const result=socialContentQueueProjection(fixture({lastError:'social_graph_quality_failed:quality',providerState:state,providerReceipts:[completed,{...failed,state}]}));
  assert.equal(result.label,'供应商结果待核对');assert.equal(result.recovery,undefined);
  assert.match(result.reason!,/核对原回执/);
 }
 const active=socialContentQueueProjection(fixture({status:'running',lastError:'social_graph_quality_failed:old',providerState:'completed',providerReceipts:[completed]}));
 assert.equal(active.label,'制作中');assert.equal(active.reason,null);
});
