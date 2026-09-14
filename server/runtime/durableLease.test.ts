import assert from 'node:assert/strict';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
  releaseDurableOperationLease,
  renewDurableOperationLease,
} from './durableLease.js';

type Row = Record_ & Record<string, unknown>;

function memoryStore(): { store: DataStore; rows: Row[] } {
  const rows: Row[] = [];
  let sequence = 0;
  const clone = <T>(value: T): T => structuredClone(value);
  const store: DataStore = {
    async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
      if (collection !== DURABLE_OPERATION_LEASE_COLLECTION) return null;
      return clone(rows.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const conflict = rows.some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id);
      if (conflict) return null;
      const row = { id: `lease${String(++sequence).padStart(10, '0')}`, ...clone(data) } as Row;
      rows.push(row);
      return clone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const row = rows.find(candidate => candidate.id === id);
      if (!row) return false;
      Object.assign(row, clone(data));
      return true;
    },
    async delete(collection: string, id: string): Promise<boolean> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const matches = rows.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 20;
      return {
        items: clone(matches.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: matches.length,
        totalPages: Math.ceil(matches.length / perPage),
        page,
        perPage,
      };
    },
  };
  return { store, rows };
}

const start = new Date('2026-09-13T00:00:00.000Z');
const input = { tenantId: 'tenant-1', scope: 'scheduled-publish', subjectId: 'post-1', ownerId: 'worker-a' };

{
  const { store } = memoryStore();
  const first = await acquireDurableOperationLease({ dataStore: store, ...input, now: start, leaseDurationMs: 60_000 });
  assert.ok(first);
  assert.equal(await acquireDurableOperationLease({
    dataStore: store, ...input, ownerId: 'worker-b', now: new Date(start.getTime() + 10_000), leaseDurationMs: 60_000,
  }), null, 'the database uniqueness winner owns the operation across processes');
  await assertDurableOperationLease({ dataStore: store, lease: first, now: new Date(start.getTime() + 20_000) });
  const renewed = await renewDurableOperationLease({
    dataStore: store, lease: first, now: new Date(start.getTime() + 30_000), leaseDurationMs: 90_000,
  });
  assert.equal(renewed.expiresAt, new Date(start.getTime() + 120_000).toISOString());
  await releaseDurableOperationLease({ dataStore: store, lease: renewed });
  assert.ok(await acquireDurableOperationLease({
    dataStore: store, ...input, ownerId: 'worker-b', now: new Date(start.getTime() + 31_000), leaseDurationMs: 60_000,
  }));
}

{
  const { store, rows } = memoryStore();
  const stale = await acquireDurableOperationLease({ dataStore: store, ...input, now: start, leaseDurationMs: 30_000 });
  assert.ok(stale);
  assert.equal(await acquireDurableOperationLease({
    dataStore: store, ...input, ownerId: 'worker-b', now: new Date(start.getTime() + 31_000),
    leaseDurationMs: 30_000, reclaimGraceMs: 10_000,
  }), null, 'the reclaim grace prevents a clock-skew takeover immediately after expiry');
  const successor = await acquireDurableOperationLease({
    dataStore: store, ...input, ownerId: 'worker-b', now: new Date(start.getTime() + 41_000),
    leaseDurationMs: 30_000, reclaimGraceMs: 10_000,
  });
  assert.ok(successor);
  assert.notEqual(successor.id, stale.id);
  await assert.rejects(
    assertDurableOperationLease({ dataStore: store, lease: stale, now: new Date(start.getTime() + 41_000) }),
    /durable_lease_lost/,
  );
  await releaseDurableOperationLease({ dataStore: store, lease: stale });
  assert.equal(rows.length, 1, 'an expired owner cannot release its successor generation');
  await assertDurableOperationLease({ dataStore: store, lease: successor, now: new Date(start.getTime() + 42_000) });
}

{
  const { store } = memoryStore();
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => acquireDurableOperationLease({
    dataStore: store,
    ...input,
    ownerId: `worker-${index}`,
    now: start,
    leaseDurationMs: 60_000,
  })));
  assert.equal(attempts.filter(Boolean).length, 1, 'one unique-index winner must arbitrate concurrent claims');
}

console.log('durable operation lease tests passed');
