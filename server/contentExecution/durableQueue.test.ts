import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDataAuthority, runWithDataAuthority } from '../storage/dataAuthority.js';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import {
  CONTENT_EXECUTION_JOB_COLLECTION,
  readCurrentContentExecutionCheckpoint,
  recordCurrentContentExecutionCheckpoint,
  recordCurrentContentProviderReceipt,
  runWithContentExecutionContext,
} from './context.js';
import {
  admitContentExecutionJob,
  DurableContentExecutionWorker,
  controlContentExecutionJob,
  readContentExecutionJob,
  setContentExecutionLimit,
} from './durableQueue.js';
import { classifyContentExecutionFailure } from './retryPolicy.js';
import { generateSeedanceConceptVideo } from '../lib/generativeVideoGateway.js';
import { buildContentExecutionRuntime } from '../digitalEmployees/contentExecutionRuntime.js';

class MemoryStore implements DataStore {
  rows = new Map<string, Map<string, Record<string, unknown> & { id: string }>>();
  private sequence = 0;

  private collection(name: string) {
    let collection = this.rows.get(name);
    if (!collection) { collection = new Map(); this.rows.set(name, collection); }
    return collection;
  }

  async getById<T>(collection: string, id: string): Promise<T | null> {
    return (this.collection(collection).get(id) as T | undefined) ?? null;
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const target = this.collection(collection);
    const id = String(data.id || `row${String(++this.sequence).padStart(12, '0')}`).slice(0, 15);
    if (target.has(id)) return null;
    if (collection === 'durable_operation_leases') {
      const duplicate = [...target.values()].some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id);
      if (duplicate) return null;
    }
    const row = { ...data, id } as Record<string, unknown> & { id: string };
    target.set(id, row);
    return row as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const target = this.collection(collection);
    const prior = target.get(id);
    if (!prior) return false;
    target.set(id, { ...prior, ...data, id });
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.collection(collection).delete(id);
  }

  async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let items = [...this.collection(collection).values()].filter(row => (
      Object.entries(query.where || {}).every(([key, value]) => row[key] === value)
    ));
    const terms = String(query.sort || '').split(',').map(item => item.trim()).filter(Boolean);
    if (terms.length) items = items.sort((left, right) => {
      for (const term of terms) {
        const descending = term.startsWith('-');
        const key = descending ? term.slice(1) : term;
        const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
        if (compared) return descending ? -compared : compared;
      }
      return left.id.localeCompare(right.id);
    });
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    const totalItems = items.length;
    return {
      items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems,
      totalPages: Math.ceil(totalItems / perPage), page, perPage,
    };
  }
}

const env = {
  CONTENT_EXECUTION_WORKER_CONCURRENCY: '4',
  CONTENT_EXECUTION_POLL_INTERVAL_MS: '60000',
  CONTENT_EXECUTION_LEASE_MS: '60000',
  CONTENT_MAX_RUNNING_PER_TENANT: '2',
  CONTENT_MAX_RUNNING_PER_ACCOUNT: '1',
  CONTENT_MAX_RUNNING_PER_TASK_TYPE: '2',
  CONTENT_NETWORK_MAX_ATTEMPTS: '4',
  CONTENT_SYSTEM_MAX_ATTEMPTS: '3',
  CONTENT_RECONCILIATION_MAX_ATTEMPTS: '12',
} as NodeJS.ProcessEnv;

test('retry policy separates balance, rejection, network, system and provider reconciliation', () => {
  assert.equal(classifyContentExecutionFailure(new Error('余额不足'), { attempt: 1, env }).failureClass, 'insufficient_balance');
  assert.equal(classifyContentExecutionFailure(new Error('Qwen Image 422: content rejected'), { attempt: 1, env }).failureClass, 'content_rejected');
  const network = classifyContentExecutionFailure(new Error('fetch failed ETIMEDOUT'), { attempt: 1, env });
  assert.equal(network.failureClass, 'network_timeout');
  assert.equal(network.disposition, 'retry');
  assert.equal(classifyContentExecutionFailure(new Error('unexpected local crash'), { attempt: 1, env }).failureClass, 'system_fault');
  assert.equal(classifyContentExecutionFailure(new Error('socket closed'), {
    attempt: 1, hasUnsettledProviderReceipt: true, env,
  }).failureClass, 'provider_reconciliation');
});

test('durable admission is idempotent and provider receipts survive execution context loss', async () => {
  const store = new MemoryStore();
  const first = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', runId: 'run-a',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z'),
  });
  const replay = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', runId: 'run-a',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:01:00Z'),
  });
  assert.equal(replay.id, first.id);
  assert.equal((await store.list(CONTENT_EXECUTION_JOB_COLLECTION)).totalItems, 1);

  await runWithContentExecutionContext({
    dataStore: store, jobId: first.id, action: async () => {
      await recordCurrentContentProviderReceipt({
        provider: 'seedance', requestId: 'request-a', state: 'accepted', providerTaskId: 'provider-task-a',
        metadata: { reservationId: 'reservation-a', reservedCny: 1.5 },
      });
    },
  });
  const persisted = await readContentExecutionJob(store, 'tenant-a', 'task-a', 'run-a');
  assert.equal(persisted?.providerState, 'accepted');
  assert.equal(persisted?.providerReceipts[0]?.providerTaskId, 'provider-task-a');
});

test('versioned checkpoints survive a new execution context and stale workers are fenced', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-checkpoint', userId: 'user-a', taskId: 'task-checkpoint',
    runId: 'run-checkpoint', taskType: 'social_content_weekly',
  });
  await store.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
    status: 'running', worker_id: 'worker-a', attempt: 1,
  });
  await runWithContentExecutionContext({
    dataStore: store, jobId: job.id, expectedWorkerId: 'worker-a', expectedAttempt: 1,
    action: () => recordCurrentContentExecutionCheckpoint({
      stage: 'social.director_storyboard', version: '1', inputHash: 'input-v1',
      payload: { scenes: [{ sceneId: 'scene-1', materialId: 'asset-1' }] },
    }),
  });
  const persisted = await readContentExecutionJob(
    store, 'tenant-checkpoint', 'task-checkpoint', 'run-checkpoint',
  );
  await runWithContentExecutionContext({
    dataStore: store, jobId: job.id, checkpoints: persisted?.checkpoints,
    action: async () => {
      assert.deepEqual(readCurrentContentExecutionCheckpoint({
        stage: 'social.director_storyboard', version: '1', inputHash: 'input-v1',
      }), { scenes: [{ sceneId: 'scene-1', materialId: 'asset-1' }] });
      assert.equal(readCurrentContentExecutionCheckpoint({
        stage: 'social.director_storyboard', version: '1', inputHash: 'changed-input',
      }), null, 'changed inputs must never reuse an old intermediate result');
    },
  });

  await assert.rejects(runWithContentExecutionContext({
    dataStore: store, jobId: job.id, checkpoints: persisted?.checkpoints,
    expectedWorkerId: 'worker-a', expectedAttempt: 1,
    action: async () => {
      await store.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
        worker_id: 'worker-b', attempt: 2,
      });
      await recordCurrentContentExecutionCheckpoint({
        stage: 'social.director_storyboard', version: '1', inputHash: 'stale-write', payload: {},
      });
    },
  }), /content_execution_stopped/);
  const afterFence = await readContentExecutionJob(
    store, 'tenant-checkpoint', 'task-checkpoint', 'run-checkpoint',
  );
  assert.equal(afterFence?.checkpoints['social.director_storyboard']?.inputHash, 'input-v1');
});

test('provider receipt writers merge under a durable lock and stale callbacks cannot downgrade completion', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-receipt', userId: 'user-a', taskId: 'task-receipt',
    runId: 'run-receipt', taskType: 'social_content_weekly',
  });
  await runWithContentExecutionContext({ dataStore: store, jobId: job.id, action: async () => {
    await recordCurrentContentProviderReceipt({
      provider: 'seedance', requestId: 'request-new', state: 'completed', providerTaskId: 'task-new',
    });
  } });
  // This context intentionally starts with an empty/stale in-memory array.
  await runWithContentExecutionContext({ dataStore: store, jobId: job.id, providerReceipts: [], action: async () => {
    await recordCurrentContentProviderReceipt({
      provider: 'heygen', requestId: 'request-old-worker', state: 'accepted', providerTaskId: 'task-old',
    });
    await recordCurrentContentProviderReceipt({
      provider: 'seedance', requestId: 'request-new', state: 'accepted', providerTaskId: 'task-new',
    });
  } });
  const persisted = await readContentExecutionJob(store, 'tenant-receipt', 'task-receipt', 'run-receipt');
  assert.equal(persisted?.providerReceipts.length, 2);
  assert.equal(persisted?.providerReceipts.find(item => item.requestId === 'request-new')?.state, 'completed');
  assert.equal(persisted?.providerReceipts.find(item => item.requestId === 'request-old-worker')?.providerTaskId, 'task-old');
});

test('customer runtime projection explains capacity, queue position and retry without exposing raw failures', async () => {
  const store = new MemoryStore();
  await setContentExecutionLimit({
    dataStore: store, tenantId: 'tenant-a', scope: 'tenant', scopeKey: '*', maxRunning: 1,
    updatedBy: 'admin-a', now: new Date('2026-10-04T00:00:00Z'),
  });
  const running = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-running', runId: 'run-running',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z'),
  });
  const queued = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-queued', runId: 'run-queued',
    accountId: 'account-b', taskType: 'social_content_instant', now: new Date('2026-10-04T00:00:01Z'),
  });
  await store.update(CONTENT_EXECUTION_JOB_COLLECTION, running.id, {
    status: 'running', attempt: 1, worker_id: 'private-worker', last_error: 'private provider payload',
  });
  await store.update(CONTENT_EXECUTION_JOB_COLLECTION, queued.id, {
    status: 'retry_wait', attempt: 2, retry_class: 'network_timeout',
    next_attempt_at: '2026-10-04T00:05:00Z', last_error: 'private socket address',
  });

  const runtime = await buildContentExecutionRuntime({ dataStore: store, tenantId: 'tenant-a', env, now: new Date('2026-10-04T00:02:00Z') });
  assert.deepEqual(runtime.capacity.tenant, { active: 1, max: 1 });
  const retry = runtime.jobs.find(job => job.id === queued.id);
  assert.equal(retry?.queuePosition, 1);
  assert.equal(retry?.waitingOn, 'tenant');
  assert.equal(retry?.maxAttempts, 4);
  assert.match(retry?.publicReason || '', /分级重试/);
  assert.equal(JSON.stringify(runtime).includes('private socket address'), false);
  assert.equal(JSON.stringify(runtime).includes('private-worker'), false);
});

test('pause, cancel, resume and manual retry preserve the same durable job identity', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-control', runId: 'run-control',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z'),
  });
  const paused = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'pause' });
  assert.equal(paused.status, 'paused');
  const resumed = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'resume' });
  assert.equal(resumed.status, 'queued');
  const duplicateResume = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'resume' });
  assert.equal(duplicateResume.id, job.id);
  assert.equal(duplicateResume.status, 'queued');
  const cancelled = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'cancel' });
  assert.equal(cancelled.status, 'cancelled');
  const recovered = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'resume' });
  assert.equal(recovered.status, 'queued');
  await store.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, { status: 'blocked', attempt: 3, last_error: 'private failure' });
  const retried = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'retry' });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attempt, 0);
  assert.equal(retried.lastError, null);
  assert.equal(retried.id, job.id);
  const duplicateRetry = await controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', jobId: job.id, action: 'retry' });
  assert.equal(duplicateRetry.id, job.id);
  assert.equal(duplicateRetry.status, 'queued');
  await assert.rejects(
    controlContentExecutionJob({ dataStore: store, tenantId: 'tenant-b', jobId: job.id, action: 'pause' }),
    /content_execution_job_not_found/,
  );
});

test('failed success projection cannot retry a durably completed production job', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', userId: 'user-a',
    taskId: 'completed-task', runId: 'completed-run', accountId: 'account-a', taskType: 'social_content_weekly' });
  let executed = 0;
  let projected = 0;
  let retried = 0;
  let blocked = 0;
  const worker = new DurableContentExecutionWorker({ dataStore: store, env,
    async execute() { executed++; },
    async onSucceeded() { projected++; throw new Error('completion_projection_write_failed'); },
    async onRetry() { retried++; },
    async onBlocked() { blocked++; },
  });
  await worker.drain();
  for (let attempt = 0; attempt < 20 && worker.isLocallyActive('tenant-a', 'completed-task'); attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  await worker.drain();
  worker.stop();
  const actual = await readContentExecutionJob(store, 'tenant-a', 'completed-task', 'completed-run');
  assert.equal(actual?.id, job.id);
  assert.equal(actual?.status, 'succeeded');
  assert.ok(actual?.completedAt);
  assert.equal(executed, 1);
  assert.equal(projected, 1);
  assert.equal(retried, 0);
  assert.equal(blocked, 0);
});

test('worker enforces tenant and account caps while allowing another customer to run', async () => {
  const store = new MemoryStore();
  await setContentExecutionLimit({
    dataStore: store, tenantId: 'tenant-a', scope: 'tenant', scopeKey: '*', maxRunning: 1,
    updatedBy: 'admin-a', now: new Date('2026-10-04T00:00:00Z'),
  });
  await admitContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a1', runId: 'run-a1', accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z') });
  await admitContentExecutionJob({ dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a2', runId: 'run-a2', accountId: 'account-b', taskType: 'social_content_instant', now: new Date('2026-10-04T00:00:01Z') });
  await admitContentExecutionJob({ dataStore: store, tenantId: 'tenant-b', userId: 'user-b', taskId: 'task-b1', runId: 'run-b1', accountId: 'account-c', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:02Z') });

  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const worker = new DurableContentExecutionWorker({
    dataStore: store, env,
    execute: job => new Promise<void>(resolve => { started.push(job.taskId); gates.set(job.taskId, resolve); }),
  });
  await worker.drain();
  assert.deepEqual(new Set(started), new Set(['task-a1', 'task-b1']));
  assert.equal(started.includes('task-a2'), false);

  gates.get('task-a1')?.();
  gates.get('task-b1')?.();
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
  await worker.drain();
  assert.equal(started.includes('task-a2'), true);
  gates.get('task-a2')?.();
  worker.stop();
});

test('two worker instances claim one durable job only once', async () => {
  const store = new MemoryStore();
  await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', runId: 'run-a',
    accountId: 'account-a', taskType: 'social_content_instant', now: new Date('2026-10-04T00:00:00Z'),
  });
  let executions = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const execute = async () => { executions += 1; await gate; };
  const first = new DurableContentExecutionWorker({ dataStore: store, env, execute });
  const second = new DurableContentExecutionWorker({ dataStore: store, env, execute });
  await Promise.all([first.drain(), second.drain()]);
  assert.equal(executions, 1);
  release();
  first.stop();
  second.stop();
});

test('abandoned accepted provider job enters reconciliation without blind resubmission', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', runId: 'run-a',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z'),
  });
  await store.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
    status: 'running', attempt: 1, worker_id: 'dead-worker', lease_expires_at: '2026-10-04T00:01:00Z',
    provider_state: 'accepted', provider_receipts: [{
      provider: 'heygen', requestId: 'request-a', state: 'accepted', providerTaskId: 'provider-task-a',
      metadata: {}, firstRecordedAt: '2026-10-04T00:00:10Z', updatedAt: '2026-10-04T00:00:10Z',
    }],
  });
  let executions = 0;
  let settled!: () => void;
  const didSettle = new Promise<void>(resolve => { settled = resolve; });
  const worker = new DurableContentExecutionWorker({
    dataStore: store, env, now: () => new Date('2026-10-04T00:02:00Z'),
    execute: async () => { executions += 1; throw new Error('provider_submission_unknown:heygen'); },
    onRetry: async () => settled(),
  });
  await worker.drain();
  await didSettle;
  const recovered = await readContentExecutionJob(store, 'tenant-a', 'task-a', 'run-a');
  assert.equal(executions, 1);
  assert.equal(recovered?.status, 'reconciling');
  assert.equal(recovered?.retryClass, 'provider_reconciliation');
  assert.equal(recovered?.providerReceipts[0]?.providerTaskId, 'provider-task-a');
  worker.stop();
});

test('accepted Seedance receipt resumes polling and never submits a second paid task', async () => {
  const store = new MemoryStore();
  const job = await admitContentExecutionJob({
    dataStore: store, tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', runId: 'run-a',
    accountId: 'account-a', taskType: 'social_content_weekly', now: new Date('2026-10-04T00:00:00Z'),
  });
  await runWithContentExecutionContext({ dataStore: store, jobId: job.id, action: async () => {
    await recordCurrentContentProviderReceipt({
      provider: 'seedance', requestId: 'stable-request', state: 'accepted', providerTaskId: 'provider-task-7',
      metadata: { reservationId: 'reservation-7', reservedCny: 2, model: 'seedance-test' },
    });
  } });
  const persisted = await readContentExecutionJob(store, 'tenant-a', 'task-a', 'run-a');
  const requests: string[] = [];
  const result = await runWithContentExecutionContext({
    dataStore: store, jobId: job.id, providerReceipts: persisted?.providerReceipts,
    action: () => generateSeedanceConceptVideo({
      tenantId: 'tenant-a', prompt: 'resume', durationSeconds: 5, ratio: '9:16',
      idempotencyKey: 'stable-request', timeoutMs: 1_000, apiKey: 'secret', model: 'seedance-test', pollMs: 1,
      transport: async url => {
        const address = String(url); requests.push(address);
        if (address.includes('/tasks/provider-task-7')) {
          return Response.json({ status: 'succeeded', content: { video_url: 'https://media.example/resumed.mp4' } });
        }
        if (address === 'https://media.example/resumed.mp4') return new Response(Buffer.from('resumed-video'));
        throw new Error(`unexpected request:${address}`);
      },
      reserveBudget: () => { throw new Error('must_not_reserve_twice'); },
      releaseBudget: () => { throw new Error('must_not_release_accepted_reservation'); },
    }),
  });
  assert.equal(result.providerTaskId, 'provider-task-7');
  assert.equal(result.bytes.toString(), 'resumed-video');
  assert.equal(requests.some(url => url.endsWith('/contents/generations/tasks')), false);
});


test('worker pins local storage across claims, execution, callbacks and remote wakeups', async () => {
  const store = new MemoryStore();
  await admitContentExecutionJob({ dataStore: store, tenantId: 'tenant-local', userId: 'user-local', taskId: 'task-local', runId: 'run-local', taskType: 'social_content_instant' });
  const calls: string[] = [];
  const scopedStore = new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        assert.equal(currentDataAuthority(), 'local', String(property));
        calls.push(String(property));
        return value.apply(target, args);
      };
    },
  });
  let executed = false;
  let succeeded = false;
  const worker = new DurableContentExecutionWorker({
    dataStore: scopedStore, dataAuthority: 'local', env,
    async execute() { await Promise.resolve(); assert.equal(currentDataAuthority(), 'local'); executed = true; },
    async onSucceeded() { assert.equal(currentDataAuthority(), 'local'); succeeded = true; },
  });
  await runWithDataAuthority('pocketbase', async () => {
    await worker.drain();
    assert.equal(currentDataAuthority(), 'pocketbase', 'worker context must not leak into caller');
  });
  for (let attempt = 0; attempt < 20 && !succeeded; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
  worker.stop();
  assert.ok(executed && succeeded, 'the persisted job reaches successful completion');
  assert.ok(calls.includes('list') && calls.includes('getById') && calls.includes('update') && calls.includes('delete'));
});

test('durable phase pause settles without success or failure projections, then resumes the same provider identity',async()=>{
 const store=new MemoryStore();await store.create('workflow_runs',{id:'phase-run',tenant_id:'tenant-a',status:'running'});
 const original=await admitContentExecutionJob({dataStore:store,tenantId:'tenant-a',userId:'user-a',taskId:'phase-task',runId:'phase-run',accountId:'account-a',taskType:'social_content_weekly'});
 let submissions=0,executions=0,succeeded=0,blocked=0,retried=0;
 const worker=new DurableContentExecutionWorker({dataStore:store,env,async execute(job){executions++;if(executions===1){submissions++;await recordCurrentContentProviderReceipt({provider:'controlled',requestId:'same-request',state:'unknown',providerTaskId:'provider-original'});await controlContentExecutionJob({dataStore:store,tenantId:'tenant-a',jobId:job.id,action:'pause'});return;}
 const receipt=job.providerReceipts.find(row=>row.requestId==='same-request');assert.equal(receipt?.providerTaskId,'provider-original');assert.equal(receipt?.state,'unknown');await recordCurrentContentProviderReceipt({provider:'controlled',requestId:'same-request',state:'completed',providerTaskId:'provider-original'});},async onSucceeded(){succeeded++;},async onBlocked(){blocked++;},async onRetry(){retried++;}});
 const settle=async()=>{await worker.drain();for(let n=0;n<30&&worker.isLocallyActive('tenant-a','phase-task');n++)await new Promise<void>(resolve=>setImmediate(resolve));};
 await settle();const paused=await readContentExecutionJob(store,'tenant-a','phase-task','phase-run');assert.equal(paused?.status,'paused');assert.equal(paused?.completedAt,null);assert.equal(succeeded,0);assert.equal(blocked,0);assert.equal(retried,0);
 const resumed=await controlContentExecutionJob({dataStore:store,tenantId:'tenant-a',jobId:original.id,action:'resume'});assert.equal(resumed.id,original.id);assert.equal(resumed.runId,'phase-run');assert.equal(resumed.status,'reconciling');assert.equal(resumed.providerReceipts[0]?.providerTaskId,'provider-original');
 await settle();worker.stop();const complete=await readContentExecutionJob(store,'tenant-a','phase-task','phase-run');assert.equal(complete?.status,'succeeded');assert.equal(complete?.id,original.id);assert.equal(executions,2);assert.equal(submissions,1);assert.equal(succeeded,1);assert.equal(blocked,0);assert.equal(retried,0);
});

test('an execution stopped after durable pause cannot project a blocked failure',async()=>{
 const store=new MemoryStore();const job=await admitContentExecutionJob({dataStore:store,tenantId:'tenant-a',userId:'user-a',taskId:'stopped-task',runId:'stopped-run',accountId:'account-a',taskType:'social_content_weekly'});let success=0,block=0,retry=0;
 const worker=new DurableContentExecutionWorker({dataStore:store,env,async execute(){await controlContentExecutionJob({dataStore:store,tenantId:'tenant-a',jobId:job.id,action:'pause'});throw Error('content_execution_stopped');},async onSucceeded(){success++;},async onBlocked(){block++;},async onRetry(){retry++;}});
 await worker.drain();for(let n=0;n<30&&worker.isLocallyActive('tenant-a','stopped-task');n++)await new Promise<void>(resolve=>setImmediate(resolve));worker.stop();assert.equal((await readContentExecutionJob(store,'tenant-a','stopped-task','stopped-run'))?.status,'paused');assert.equal(success+block+retry,0);
});
