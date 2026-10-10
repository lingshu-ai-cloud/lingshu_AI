import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { AD_WORKER_HEALTH, readAdWorkerStatus, withAdWorkerEvidence } from './workerHealth.js';
const original = { getById: store.getById, list: store.list, create: store.create, update: store.update };
const oldEnabled = process.env.PLATFORM_ADS_AUTOMATION_ENABLED;
const records: Array<Record<string, unknown> & { id: string }> = [];
try {
  store.list = async <T>(collection: string, query?: import('../storage/datastore.js').ListQuery) => {
    assert.equal(collection, AD_WORKER_HEALTH);
    assert.ok(query?.where?.tenant_id, 'every health query is tenant scoped');
    const items = records.filter(record => Object.entries(query?.where || {}).every(([key, value]) => record[key] === value));
    return { items: items as T[], page: 1, perPage: 1, totalPages: 1, totalItems: items.length };
  };
  store.getById = async <T>(_collection: string, id: string) => (records.find(row => row.id === id) || null) as T | null;
  store.create = async <T>(_collection: string, data: Record<string, unknown>) => { const row = { id: String(records.length + 1), ...data }; records.push(row); return row as T; };
  store.update = async (_collection, id, data) => { const row = records.find(row => row.id === id); if (!row) return false; Object.assign(row, data); return true; };
  process.env.PLATFORM_ADS_AUTOMATION_ENABLED = 'true';
  assert.equal((await readAdWorkerStatus('a')).state, 'unknown');
  await withAdWorkerEvidence('a', async () => { assert.equal((await readAdWorkerStatus('a')).state, 'checking'); });
  assert.equal((await readAdWorkerStatus('a')).state, 'completed');
  assert.equal((await readAdWorkerStatus('b')).lastStartedAt, null);
  assert.equal((await readAdWorkerStatus('a', Date.now() + 11 * 60_000)).state, 'stale');
  await assert.rejects(withAdWorkerEvidence('a', async () => { throw new Error('mock'); }));
  assert.equal((await readAdWorkerStatus('a')).state, 'failed');
  const tenantRecord = records.find(row => row.tenant_id === 'a')!;
  const failedAt = tenantRecord.lastFailedAt;
  delete tenantRecord.lastFailedAt;
  assert.equal((await readAdWorkerStatus('a')).state, 'unknown', 'failed requires failure timestamp');
  tenantRecord.lastFailedAt = failedAt;
  tenantRecord.state = 'completed';
  const completedAt = tenantRecord.lastCompletedAt;
  delete tenantRecord.lastCompletedAt;
  assert.equal((await readAdWorkerStatus('a')).state, 'unknown', 'completed requires completion timestamp');
  tenantRecord.lastCompletedAt = completedAt;
  const scopedList = store.list;
  for (const wrong of [{ ...tenantRecord, tenant_id: 'other' }, { ...tenantRecord, workerId: 'other-worker' }]) {
    store.list = async <T>() => ({ items: [wrong] as T[], page: 1, perPage: 1, totalPages: 1, totalItems: 1 });
    const snapshot = JSON.stringify(records);
    await assert.rejects(withAdWorkerEvidence('a', async () => { throw new Error('must not execute'); }), /归属不匹配/);
    assert.equal(JSON.stringify(records), snapshot, 'mismatched existing records must not be updated');
  }
  store.list = scopedList;
  process.env.PLATFORM_ADS_AUTOMATION_ENABLED = 'false';
  assert.equal((await readAdWorkerStatus('b')).configuredEnabled, false);
  store.getById = async <T>(_collection: string, id: string) => { const row = records.find(row => row.id === id); return row ? { id: row.id } as T : null; };
  let called = false;
  await assert.rejects(withAdWorkerEvidence('c', async () => { called = true; }), /完整持久化/);
  assert.equal(called, false);
  console.log('worker evidence tenant isolation and lifecycle passed');
} finally { Object.assign(store, original); if (oldEnabled === undefined) delete process.env.PLATFORM_ADS_AUTOMATION_ENABLED; else process.env.PLATFORM_ADS_AUTOMATION_ENABLED = oldEnabled; }
