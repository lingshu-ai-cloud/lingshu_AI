import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { runWithContentExecutionContext } from './context.js';
import { beginContentProviderOperation, completeContentProviderOperation, markContentProviderOperationUnknown } from './providerGateway.js';

function store(job: Record<string, unknown>) {
  let sequence = 0;
  const rows = new Map<string, Record<string, unknown>>([
    [`content_execution_jobs:${job.id}`, job],
    [`workflow_runs:${job.run_id}`, { id: job.run_id, tenant_id: job.tenant_id, status: 'running', current_controller: 'system' }],
  ]);
  return {
    getById: async (collection: string, id: string) => structuredClone(rows.get(`${collection}:${id}`) ?? null),
    list: async (collection: string, options: { where?: Record<string, unknown> } = {}) => {
      const items = [...rows.entries()].filter(([key]) => key.startsWith(`${collection}:`)).map(([, row]) => row)
        .filter(row => Object.entries(options.where ?? {}).every(([key, value]) => row[key] === value)).map(row => structuredClone(row));
      return { page: 1, perPage: 100, totalItems: items.length, totalPages: 1, items };
    },
    create: async (collection: string, input: Record<string, unknown>) => {
      const id = `${collection}-${++sequence}`; const row = { id, ...structuredClone(input) };
      rows.set(`${collection}:${id}`, row); return structuredClone(row);
    },
    update: async (collection: string, id: string, patch: Record<string, unknown>) => {
      const row = rows.get(`${collection}:${id}`); if (!row) return false; Object.assign(row, structuredClone(patch)); return true;
    },
    delete: async (collection: string, id: string) => rows.delete(`${collection}:${id}`),
  } as unknown as DataStore;
}

test('gateway writes before submit and an ambiguous restart can only reconcile', async () => {
  const job: Record<string, unknown> = { id: 'job', tenant_id: 'tenant', task_id: 'task', run_id: 'run', status: 'running', provider_receipts: [] };
  const dataStore = store(job);
  const first = await runWithContentExecutionContext({ dataStore, jobId: 'job', providerReceipts: job.provider_receipts, action: async () => {
    const admitted = await beginContentProviderOperation({ provider: 'provider', requestId: 'request' });
    await markContentProviderOperationUnknown({ provider: 'provider', requestId: 'request' });
    return admitted;
  } });
  assert.equal(first.action, 'submit');
  const restarted = await runWithContentExecutionContext({ dataStore, jobId: 'job', providerReceipts: job.provider_receipts,
    action: () => beginContentProviderOperation({ provider: 'provider', requestId: 'request' }) });
  assert.equal(restarted.action, 'reconcile');
});

test('completed operation is reusable and never resubmitted', async () => {
  const job: Record<string, unknown> = { id: 'job', tenant_id: 'tenant', task_id: 'task', run_id: 'run', status: 'running', provider_receipts: [] };
  const dataStore = store(job);
  await runWithContentExecutionContext({ dataStore, jobId: 'job', providerReceipts: [], action: async () => {
    await beginContentProviderOperation({ provider: 'provider', requestId: 'request' });
    await completeContentProviderOperation({ provider: 'provider', requestId: 'request', providerTaskId: 'task-id' });
  } });
  const decision = await runWithContentExecutionContext({ dataStore, jobId: 'job', providerReceipts: job.provider_receipts,
    action: () => beginContentProviderOperation({ provider: 'provider', requestId: 'request' }) });
  assert.equal(decision.action, 'reuse_completed');
});
