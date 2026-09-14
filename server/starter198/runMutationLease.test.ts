import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
} from '../runtime/durableLease.js';
import {
  Starter198RunMutationLeaseError,
  withStarter198RunMutationLease,
} from './runMutationLease.js';

type Row = { id: string } & Record<string, unknown>;

function memoryStore(): DataStore {
  const rows = new Map<string, Row[]>();
  let serial = 0;
  const bucket = (collection: string) => {
    const value = rows.get(collection) ?? [];
    rows.set(collection, value);
    return value;
  };
  return {
    async getById(collection, id) {
      return structuredClone(bucket(collection).find(row => row.id === id) ?? null) as never;
    },
    async list(collection, query: ListQuery = {}) {
      const selected = bucket(collection).filter(row => Object.entries(query.where ?? {})
        .every(([field, value]) => String(row[field] ?? '') === String(value)));
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 20;
      return {
        items: structuredClone(selected.slice((page - 1) * perPage, page * perPage)) as never[],
        totalItems: selected.length,
        totalPages: Math.ceil(selected.length / perPage),
        page,
        perPage,
      };
    },
    async create(collection, data) {
      const target = bucket(collection);
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION
        && target.some(row => row.tenant_id === data.tenant_id
          && row.lease_scope === data.lease_scope
          && row.subject_id === data.subject_id)) return null;
      const row = { id: `row-${++serial}`, ...structuredClone(data) } as Row;
      target.push(row);
      return structuredClone(row) as never;
    },
    async update(collection, id, patch) {
      const row = bucket(collection).find(candidate => candidate.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(patch));
      return true;
    },
    async delete(collection, id) {
      const target = bucket(collection);
      const index = target.findIndex(row => row.id === id);
      if (index < 0) return false;
      target.splice(index, 1);
      return true;
    },
  };
}

const dataStore = memoryStore();
const tenantId = 'starter-run-lease-tenant';
const runId = 'starter-run-lease-run';
let nestedCalls = 0;
await withStarter198RunMutationLease({
  dataStore,
  tenantId,
  runId,
  action: async () => withStarter198RunMutationLease({
    dataStore,
    tenantId,
    runId,
    action: async () => { nestedCalls += 1; },
  }),
});
assert.equal(nestedCalls, 1, 'nested run writes must reuse the held durable generation');

const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
await assert.rejects(
  () => withStarter198RunMutationLease({ tenantId, runId: 'missing-store-run', action: async () => undefined }),
  (error: unknown) => error instanceof Starter198RunMutationLeaseError
    && error.code === 'starter_run_mutation_unavailable',
);
if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = priorNodeEnv;

const foreign = await acquireDurableOperationLease({
  dataStore,
  tenantId,
  scope: 'starter-run-mutation',
  subjectId: runId,
  ownerId: 'another-runtime',
  leaseDurationMs: 60_000,
});
assert.ok(foreign);
await assert.rejects(
  () => withStarter198RunMutationLease({ dataStore, tenantId, runId, action: async () => undefined }),
  (error: unknown) => error instanceof Starter198RunMutationLeaseError
    && error.code === 'starter_run_mutation_busy',
);

console.log('starter run mutation lease tests passed');
