import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProductionTestStore } from '../production/testStore.js';
import { createStarter198Repository } from './repository.js';
import { createSingleContentCreationRouter } from './singleContentCreationRouter.js';
import { recoverSocialContentExecution } from './socialContentExecutionRecovery.js';
import type { amendCanonicalUnsubmittedVoiceRoute } from './socialContentVoiceRouteControl.js';
import { controlContentExecutionJob } from '../contentExecution/durableQueue.js';

const command = { jobId: 'job', runId: 'run', expectedVersion: '14', failedOperationId: 'paid-plan:' + 'a'.repeat(64) };
test('recovery HTTP authenticates start, rejects financial/scope injection and preserves idempotency identity', async () => {
  const seen: string[] = [], calls: unknown[] = [];
  const app = express(); app.use(express.json());
  app.use(createSingleContentCreationRouter({ repository: createStarter198Repository(createProductionTestStore()),
    now: () => new Date(), localPreview: () => false,
    orchestratorQueue: { enqueue: async () => { throw Error('must recover original job'); } },
    authorize: async (_req, _res, level) => { seen.push(level); return { tenantId: 'tenant', userId: 'owner' }; },
    asyncRoute: handler => (req, res) => { void handler(req, res).catch(error => res.status(error.status || 500).json({ code: error.code || error.message })); },
    recoverExecution: async input => { calls.push(input); return { taskId: input.taskId, runId: 'run', jobId: 'job', status: 'queued', operationId: 'new-operation', amendmentHash: 'hash', attempt: 1 }; },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = async (body: unknown, key: string | null = 'retry-command') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/tasks/task/recover-execution`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body),
    }); return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call({ ...command, maximumCny: 999 })).status, 400);
    assert.equal((await call({ ...command, tenantId: 'foreign' })).status, 400);
    assert.equal((await call(command, null)).status, 400);
    assert.equal((await call({action:'resume_existing_execution',jobId:'job',runId:'run',expectedVersion:'14',providerReceipts:[{state:'accepted',providerTaskId:'forged'}]})).status,400);
    assert.equal(calls.length, 0);
    for (let n = 0; n < 2; n++) assert.equal((await call(command)).status, 200);
    assert.deepEqual(calls[0], calls[1]);
    const input = calls[0] as any;
    assert.equal(input.tenantId, 'tenant'); assert.equal(input.userId, 'owner');
    assert.equal(input.idempotencyKey, 'retry-command'); assert.deepEqual(input.command, command);
    assert.ok(seen.every(level => level === 'start'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('canonical task/run/version fencing happens before amendment or queue control; replay uses the same authorization', async () => {
  const store = createProductionTestStore(), repository = createStarter198Repository(store);
  await store.create('starter_social_content_tasks', { tenant_id: 'tenant', task_id: 'task', run_id: 'run', version: '14' });
  await store.create('content_execution_jobs', { tenant_id: 'tenant', task_id: 'task', run_id: 'run',
    job_key: 'original-job', user_id: 'owner', account_id: '_unassigned', task_type: 'social_content_instant',
    status: 'blocked', checkpoints: {}, provider_receipts: [] });
  const row = [...store.rows.entries()].find(([key]) => key.startsWith('content_execution_jobs/'))![1];
  const actualCommand = { ...command, jobId: String(row.id) };
  const grants: any[] = [], actions: any[] = [];
  const ports = {
    amend: (async input => { grants.push(input); return { newIntent: { operationId: 'new-operation' }, recordHash: 'record', retry: { attempt: 1 } }; }) as typeof amendCanonicalUnsubmittedVoiceRoute,
    control: (async input => { actions.push(input); return { id: input.jobId, status: 'queued' }; }) as typeof controlContentExecutionJob,
  };
  const input = { repository, tenantId: 'tenant', userId: 'owner', taskId: 'task', command: actualCommand, idempotencyKey: 'same-action' };
  await assert.rejects(recoverSocialContentExecution({ ...input, tenantId: 'foreign' }, ports), /social_content_task_not_found/);
  await assert.rejects(recoverSocialContentExecution({ ...input, command: { ...actualCommand, expectedVersion: '13' } }, ports), /task_changed/);
  await assert.rejects(recoverSocialContentExecution({ ...input, command: { ...actualCommand, runId: 'other' } }, ports), /task_changed/);
  await assert.rejects(recoverSocialContentExecution({ ...input, command: { ...actualCommand, jobId: 'other' } }, ports), /job_changed/);
  assert.equal(grants.length + actions.length, 0);
  const first = await recoverSocialContentExecution(input, ports), replay = await recoverSocialContentExecution(input, ports);
  assert.deepEqual(first, replay); assert.equal(grants[0].authorizationRef, grants[1].authorizationRef);
  assert.equal(grants[0].expectedFailedOperationId, command.failedOperationId);
  assert.equal(grants[0].retryFailed, true); assert.equal(actions[0].action, 'retry');
  assert.equal('maximumCny' in grants[0], false);
});

test('completed provider work resumes downstream without a new paid intent, while an active worker remains fenced', async () => {
  const store = createProductionTestStore(), repository = createStarter198Repository(store);
  await store.create('starter_social_content_tasks', { tenant_id: 'tenant', task_id: 'task', run_id: 'run', version: '14' });
  const receipt = { provider: 'heygen', requestId: 'original-paid-operation', state: 'completed',
    providerTaskId: 'paid-mother', metadata: { stage: 'tts' }, firstRecordedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' };
  const row = await store.create<any>('content_execution_jobs', { tenant_id: 'tenant', task_id: 'task', run_id: 'run',
    job_key: 'original-job', user_id: 'owner', account_id: '_unassigned', task_type: 'social_content_instant',
    status: 'blocked', provider_state: 'completed', checkpoints: {}, provider_receipts: [receipt] });
  assert.ok(row); let controls = 0;
  const input = { repository, tenantId: 'tenant', userId: 'owner', taskId: 'task', idempotencyKey: 'resume-action',
    command: { action: 'resume_existing_execution' as const, jobId: row.id, runId: 'run', expectedVersion: '14' } };
  const ports = {
    amend: (async () => assert.fail('must not reserve or replace a completed provider request')) as typeof amendCanonicalUnsubmittedVoiceRoute,
    control: (async args => { controls++; await store.update('content_execution_jobs', args.jobId, { status: 'queued' }); return { id: args.jobId, status: 'queued' }; }) as typeof controlContentExecutionJob,
  };
  await store.update('content_execution_jobs', row.id, { worker_id:'live-worker', provider_state: 'accepted', provider_receipts: [{ ...receipt, state: 'unknown' }] });
  const before = JSON.stringify([...store.rows.entries()]);
  await assert.rejects(recoverSocialContentExecution(input, ports), /original_receipt_required/); assert.equal(controls, 0);
  assert.equal(JSON.stringify([...store.rows.entries()]), before);
  await store.update('content_execution_jobs', row.id, { worker_id:'',provider_state: 'completed', provider_receipts: [receipt] });
  const first = await recoverSocialContentExecution(input, ports); assert.equal(first.status, 'queued');
  await store.update('content_execution_jobs', row.id, { status: 'running', provider_state: 'accepted', provider_receipts: [{ ...receipt, state: 'accepted' }] });
  const replay = await recoverSocialContentExecution(input, ports); assert.equal(replay.status, 'running');
  assert.equal(controls, 1); assert.equal(first.operationId, null);
});


test('accepted, unknown and submitting work resumes as reconciliation with original evidence and no new financial action',async()=>{
 for(const state of ['accepted','unknown','submitting'] as const)for(const status of ['blocked','paused'] as const){
  const store=createProductionTestStore(),repository=createStarter198Repository(store);
  await store.create('starter_social_content_tasks',{tenant_id:'tenant',task_id:'task',run_id:'run',version:'14'});
  const receipt={provider:'heygen',requestId:'original-operation',state,...(state==='accepted'?{providerTaskId:'original-provider-task'}:{}),metadata:{stage:'presenter_video'},firstRecordedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
  const checkpoints={'original.checkpoint':{version:'1',inputHash:'original',updatedAt:'2026-01-01T00:00:00.000Z',payload:{original:true}}};
  const row=await store.create<any>('content_execution_jobs',{tenant_id:'tenant',task_id:'task',run_id:'run',job_key:'original-job',user_id:'owner',account_id:'_unassigned',task_type:'social_content_instant',status,provider_state:state,provider_receipts:[receipt],checkpoints,last_error:'original-provider-handoff-error',attempt:3,reconciliation_attempt:2});
  const input={repository,tenantId:'tenant',userId:'owner',taskId:'task',idempotencyKey:'same-command',command:{action:'resume_existing_execution' as const,jobId:row.id,runId:'run',expectedVersion:'14'}};
  const ports={amend:(async()=>assert.fail('resume must never amend or reserve a new operation')) as typeof amendCanonicalUnsubmittedVoiceRoute};
  await assert.rejects(recoverSocialContentExecution({...input,tenantId:'foreign'},ports),/social_content_task_not_found/);
  await assert.rejects(recoverSocialContentExecution({...input,command:{...input.command,jobId:'foreign-job'}},ports),/job_changed/);
  const result=await recoverSocialContentExecution(input,ports);assert.equal(result.status,'reconciling');
  const actual=await store.getById<any>('content_execution_jobs',row.id);assert.equal(actual.id,row.id);assert.equal(actual.run_id,'run');assert.equal(actual.last_error,'original-provider-handoff-error');assert.equal(actual.attempt,3);assert.equal(actual.reconciliation_attempt,2);assert.deepEqual(actual.provider_receipts,[receipt]);assert.deepEqual(actual.checkpoints['original.checkpoint'],checkpoints['original.checkpoint']);
  const before=JSON.stringify([...store.rows.entries()]);assert.equal((await recoverSocialContentExecution(input,ports)).status,'reconciling');assert.equal(JSON.stringify([...store.rows.entries()]),before,'active replay must not add control/financial writes');
  await store.update('content_execution_jobs',row.id,{status:'blocked',worker_id:'not-settled',lease_expires_at:'2000-01-01T00:00:00Z'});
  await assert.rejects(recoverSocialContentExecution(input,ports),/original_receipt_required/);
 }
});

test('concurrent reconciliation controls serialize and replay the same original job; no receipt cannot assert provider authority',async()=>{
 const store=createProductionTestStore(),repository=createStarter198Repository(store),create=store.create.bind(store);
 // This test store really enforces the durable lease unique key.
 store.create=async<T>(collection:string,data:Record<string,unknown>):Promise<T|null>=>{if(collection==='durable_operation_leases'&&[...store.rows.entries()].some(([key,row])=>key.startsWith(collection+'/')&&row.tenant_id===data.tenant_id&&row.lease_scope===data.lease_scope&&row.subject_id===data.subject_id))return null;return create<T>(collection,data);};
 await store.create('starter_social_content_tasks',{tenant_id:'tenant',task_id:'task',run_id:'run',version:'14'});
 const row=await store.create<any>('content_execution_jobs',{tenant_id:'tenant',task_id:'task',run_id:'run',job_key:'original-job',user_id:'owner',account_id:'_unassigned',task_type:'social_content_instant',status:'blocked',provider_state:'accepted',provider_receipts:[],checkpoints:{},last_error:'keep-error'});
 const input={repository,tenantId:'tenant',userId:'owner',taskId:'task',idempotencyKey:'same',command:{action:'resume_existing_execution' as const,jobId:row.id,runId:'run',expectedVersion:'14'}};
 await assert.rejects(recoverSocialContentExecution(input),/original_receipt_required/);
 await store.update('content_execution_jobs',row.id,{provider_receipts:[{provider:'heygen',requestId:'original',state:'unknown',firstRecordedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}]});
 const results=await Promise.allSettled([recoverSocialContentExecution(input),recoverSocialContentExecution(input)]);
 assert.ok(results.some(result=>result.status==='fulfilled'&&result.value.status==='reconciling'));
 for(const result of results)if(result.status==='rejected')assert.match(String(result.reason),/content_execution_job_control_busy/);
 assert.equal((await recoverSocialContentExecution(input)).status,'reconciling');assert.equal((await store.getById<any>('content_execution_jobs',row.id)).last_error,'keep-error');
 await store.update('content_execution_jobs',row.id,{status:'blocked',worker_id:'old-worker'});
 await assert.rejects(controlContentExecutionJob({dataStore:store,tenantId:'tenant',jobId:row.id,action:'retry'}),/original_worker_not_settled/);
});
