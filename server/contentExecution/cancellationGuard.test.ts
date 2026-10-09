import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { assertCurrentContentExecutionActive, runWithContentExecutionContext, recordCurrentContentProviderReceipt, CONTENT_EXECUTION_JOB_COLLECTION } from './context.js';
function fixture() {
  let nextId = 0;
  const rows = new Map<string, Record<string, unknown>>([
    [`${CONTENT_EXECUTION_JOB_COLLECTION}:job`, { id: 'job', tenant_id: 'tenant', run_id: 'run', status: 'running' }],
    ['workflow_runs:run', { id: 'run', tenant_id: 'tenant', status: 'running' }],
  ]);
  const store = {
    async getById(collection: string, id: string) { return structuredClone(rows.get(`${collection}:${id}`) ?? null); },
    async list(collection: string, options: { where?: Record<string, unknown> } = {}) {
      const items = [...rows.entries()]
        .filter(([key]) => key.startsWith(`${collection}:`))
        .map(([, row]) => row)
        .filter(row => Object.entries(options.where ?? {}).every(([key, value]) => row[key] === value))
        .map(row => structuredClone(row));
      return { items, totalItems: items.length };
    },
    async create(collection: string, input: Record<string, unknown>) {
      const id = `${collection}-${++nextId}`;
      const row = { id, ...structuredClone(input) };
      rows.set(`${collection}:${id}`, row);
      return structuredClone(row);
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) { const row=rows.get(`${collection}:${id}`); if (!row) return false; Object.assign(row,structuredClone(patch));return true; },
    async delete(collection: string, id: string) { return rows.delete(`${collection}:${id}`); },
  } as unknown as DataStore;
  return { rows, store };
}
test('cancellation between paid stages stops a new submission but preserves accepted/completed receipts', async () => {
  const { rows, store }=fixture();let paidCalls=0;
  await runWithContentExecutionContext({dataStore:store,jobId:'job',action:async()=>{
    await recordCurrentContentProviderReceipt({provider:'provider',requestId:'first',state:'submitting'});paidCalls++;
    await store.update(CONTENT_EXECUTION_JOB_COLLECTION,'job',{status:'cancelled'});
    await recordCurrentContentProviderReceipt({provider:'provider',requestId:'first',state:'accepted',providerTaskId:'actual-provider-task'});
    await recordCurrentContentProviderReceipt({provider:'provider',requestId:'first',state:'completed',providerTaskId:'actual-provider-task'});
    await assert.rejects(async()=>{
      await recordCurrentContentProviderReceipt({provider:'provider',requestId:'second',state:'submitting'});paidCalls++;
    },/content_execution_stopped/);
    await assert.rejects(()=>assertCurrentContentExecutionActive(),/content_execution_stopped/);
  }});
  assert.equal(paidCalls,1);
  assert.equal(rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.status,'cancelled');
  const receipts=rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.provider_receipts as any[];
  assert.equal(receipts.length,1);assert.equal(receipts[0].state,'completed');assert.equal(receipts[0].providerTaskId,'actual-provider-task');
});
test('cancelled run, paused job, missing run and cross-tenant run each fail closed before new work',async()=>{
  for (const condition of ['cancelled_run','paused_job','missing_run','other_tenant']) {
    const {rows,store}=fixture();
    if(condition==='cancelled_run') rows.get('workflow_runs:run')!.status='cancelling';
    if(condition==='paused_job') rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.status='paused';
    if(condition==='missing_run') rows.delete('workflow_runs:run');
    if(condition==='other_tenant') rows.get('workflow_runs:run')!.tenant_id='other';
    await assert.rejects(()=>runWithContentExecutionContext({dataStore:store,jobId:'job',action:()=>recordCurrentContentProviderReceipt({provider:'provider',requestId:'never-submitted',state:'submitting'})}),/content_execution_stopped/);
    assert.equal(rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.provider_receipts,undefined);
  }
});
test('unknown outcome may still be recorded after a run is cancelled',async()=>{
  const {rows,store}=fixture();
  await runWithContentExecutionContext({dataStore:store,jobId:'job',action:async()=>{
    await recordCurrentContentProviderReceipt({provider:'provider',requestId:'first',state:'submitting'});
    await store.update('workflow_runs','run',{status:'cancelled'});
    await recordCurrentContentProviderReceipt({provider:'provider',requestId:'first',state:'unknown'});
  }});
  assert.equal((rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.provider_receipts as any[])[0].state,'unknown');
});

test('late production failure reporting cannot revive a cancelled run',async()=>{
  const {failExecution}=await import('../starter198/socialContentProductionRuntimeSupport.js');
  let updates=0;
  for(const status of ['cancelling','cancelled','paused','completed']) {
    const repository={dataStore:fixture().store,async get(){return {id:'run',tenant_id:'tenant',status};},async update(){updates++;}} as any;
    await failExecution({repository,tenantId:'tenant',taskId:'task',runId:'run',userId:'user',error:new Error('content_execution_stopped')});
  }
  const repository = { dataStore: { async list() { return { items: [{ status: 'cancelled' }], totalItems: 1 }; } }, async get() { return { id: 'run', tenant_id: 'tenant', status: 'running' }; }, async update() { updates++; } } as any;
  await failExecution({ repository, tenantId: 'tenant', taskId: 'task', runId: 'run', userId: 'user', error: new Error('content_execution_stopped') });
  assert.equal(updates,0);
});

test('late video finalization cannot mark a cancelled job or run complete', async () => {
  const {finishExecution}=await import('../starter198/socialContentProductionRuntimeSupport.js');
  const {rows,store}=fixture();
  rows.get(`${CONTENT_EXECUTION_JOB_COLLECTION}:job`)!.status='cancelled';
  rows.get('workflow_runs:run')!.status='cancelled';
  let touched=0;
  const repository={dataStore:store, async get(){touched++;return null;}, async list(){touched++;throw new Error('must_not_finalize');}, async update(){touched++;}} as any;
  await assert.rejects(()=>runWithContentExecutionContext({dataStore:store,jobId:'job',action:()=>finishExecution({repository,tenantId:'tenant',taskId:'task',runId:'run',userId:'user',artifactId:'artifact'})}),/content_execution_stopped/);
  assert.equal(touched,0);
  assert.equal(rows.get('workflow_runs:run')!.status,'cancelled');
});
