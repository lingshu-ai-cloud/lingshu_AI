import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore } from '../storage/datastore.js';
import { completeWeeklyProductionRuntimeProbes, runWeeklyProductionRuntimeProbe, WEEKLY_PRODUCTION_RUNTIME_PROBES } from './weeklyProductionRuntimeProbe.js';

function memoryStore() {
  const rows = new Map<string, Record<string, unknown>>();
  const store: DataStore = {
    supportsAtomicCompareAndSwap: () => true,
    getById: async (_collection, id) => structuredClone(rows.get(id) ?? null) as never,
    create: async (_collection, data) => {
      const id = String(data.id); if (rows.has(id)) return null;
      const row = { ...structuredClone(data), id }; rows.set(id, row); return structuredClone(row) as never;
    },
    update: async (_collection, id, data) => {
      const row = rows.get(id); if (!row) return false; rows.set(id, { ...row, ...structuredClone(data) }); return true;
    },
    compareAndSwap: async (_collection, id, expected, data) => {
      const row = rows.get(id); if (!row || Object.entries(expected).some(([key, value]) => row[key] !== value)) return false;
      rows.set(id, { ...row, ...structuredClone(data) }); return true;
    },
    delete: async (_collection, id) => rows.delete(id),
    list: async (_collection, query) => {
      const items = [...rows.values()].filter(row => Object.entries(query?.where ?? {}).every(([key, value]) => row[key] === value));
      return { items: structuredClone(items) as never[], totalItems: items.length, totalPages: 1, page: 1, perPage: 20 };
    },
  };
  return { store, rows };
}

test('durable canary proves web enqueue, exact-build worker claim and checkpoint readback without business jobs', async () => {
  const { store, rows } = memoryStore();
  const build = 'a'.repeat(40);
  const web = runWeeklyProductionRuntimeProbe({ dataStore: store, webBuildSha: build, timeoutMs: 1_000, pollIntervalMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await completeWeeklyProductionRuntimeProbes({ dataStore: store, workerBuildSha: build }), 1);
  assert.equal(await web, true);
  assert.equal(rows.size, 0, 'technical canary is removed after verification');
});

test('canary fails closed for build mismatch and never enters the business queue', async () => {
  const { store, rows } = memoryStore();
  const web = runWeeklyProductionRuntimeProbe({ dataStore: store, webBuildSha: 'a'.repeat(40), timeoutMs: 80, pollIntervalMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await completeWeeklyProductionRuntimeProbes({ dataStore: store, workerBuildSha: 'b'.repeat(40) }), 0);
  assert.equal(await web, false);
  assert.equal(rows.size, 0);
  assert.equal([...rows.values()].some(row => row.collection === 'content_execution_jobs'), false);
});

test('worker refuses canaries without database CAS support', async () => {
  const { store } = memoryStore();
  store.supportsAtomicCompareAndSwap = () => false;
  await store.create(WEEKLY_PRODUCTION_RUNTIME_PROBES, { id: 'probe0000000001', probe_id: 'p', status: 'queued', challenge_hash: 'a'.repeat(64), web_build_sha: 'a'.repeat(40), enqueued_at: new Date().toISOString() });
  assert.equal(await completeWeeklyProductionRuntimeProbes({ dataStore: store, workerBuildSha: 'a'.repeat(40) }), 0);
});

test('failed canary readback blocks readiness without failing the business worker', async () => {
  const { store, rows } = memoryStore();
  const build = 'a'.repeat(40);
  await store.create(WEEKLY_PRODUCTION_RUNTIME_PROBES, {
    id: 'probe0000000002', probe_id: 'probe', status: 'queued', challenge_hash: 'a'.repeat(64),
    web_build_sha: build, enqueued_at: new Date().toISOString(),
  });
  const read = store.getById.bind(store);
  store.getById = async (collection, id) => {
    const row = await read<Record<string, unknown>>(collection, id);
    return row?.status === 'completed' ? { ...row, checkpoint: { format: 'changed' } } as never : row as never;
  };
  assert.equal(await completeWeeklyProductionRuntimeProbes({ dataStore: store, workerBuildSha: build }), 0);
  assert.equal(rows.size, 0, 'invalid technical evidence is removed instead of crashing the worker');
});

test('worker removes expired technical probes without touching business collections', async () => {
  const { store, rows } = memoryStore();
  const now = new Date('2026-10-20T01:10:00.000Z');
  await store.create(WEEKLY_PRODUCTION_RUNTIME_PROBES, { id: 'queued000000001', probe_id: 'q', status: 'queued', challenge_hash: 'a'.repeat(64), web_build_sha: 'a'.repeat(40), enqueued_at: '2026-10-20T01:00:00.000Z' });
  await store.create(WEEKLY_PRODUCTION_RUNTIME_PROBES, { id: 'done00000000001', probe_id: 'd', status: 'completed', challenge_hash: 'b'.repeat(64), web_build_sha: 'a'.repeat(40), completed_at: '2026-10-20T01:00:00.000Z' });
  assert.equal(await completeWeeklyProductionRuntimeProbes({ dataStore: store, workerBuildSha: 'a'.repeat(40), now }), 0);
  assert.equal(rows.size, 0);
});
