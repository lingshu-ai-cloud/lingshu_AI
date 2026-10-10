import assert from 'node:assert/strict';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
} from '../runtime/durableLease.js';
import {
  createPlatformAdTaskLock,
  PLATFORM_AD_TASK_LEASE_SCOPE,
  PLATFORM_AD_TASK_LOCK_MESSAGE,
  PlatformAdTaskLockError,
  platformAdTaskLeaseSubject,
} from './taskLock.js';

type Row = Record_ & Record<string, unknown>;

function memoryStore(): { dataStore: DataStore; rows: Row[]; setUnavailable(value: boolean): void; updateCount(): number } {
  const rows: Row[] = [];
  let sequence = 0;
  let unavailable = false;
  let updates = 0;
  const clone = <T>(value: T): T => structuredClone(value);
  const ensureAvailable = () => { if (unavailable) throw new Error('injected storage outage'); };
  const dataStore: DataStore = {
    async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
      ensureAvailable();
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      return clone(rows.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
      ensureAvailable();
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const conflict = rows.some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id);
      if (conflict) return null;
      const row = { id: `lease${String(++sequence).padStart(10, '0')}`, ...clone(data) } as Row;
      rows.push(row);
      return clone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
      ensureAvailable();
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const row = rows.find(candidate => candidate.id === id);
      if (!row) return false;
      Object.assign(row, clone(data));
      updates += 1;
      return true;
    },
    async delete(collection: string, id: string): Promise<boolean> {
      ensureAvailable();
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      ensureAvailable();
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      const matches = rows.filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
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
  return { dataStore, rows, setUnavailable(value) { unavailable = value; }, updateCount() { return updates; } };
}

const tenantId = 'tenant-a';
const taskId = 'task-a';
const start = new Date('2026-09-14T00:00:00.000Z');

{
  const shared = memoryStore();
  const instanceA = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-instance-a' });
  const instanceB = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-instance-b' });
  let releaseFirst!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  let entered = 0;
  const first = instanceA(tenantId, taskId, async () => { entered += 1; await held; return 'first'; });
  while (!shared.rows.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    instanceB(tenantId, taskId, async () => { entered += 1; return 'second'; }),
    error => error instanceof PlatformAdTaskLockError
      && error.code === 'platform_ad_task_busy'
      && error.message === PLATFORM_AD_TASK_LOCK_MESSAGE,
    'a second process-local instance must lose database arbitration',
  );
  assert.equal(entered, 1);
  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(shared.rows.length, 0, 'successful completion releases the durable lease');
  assert.equal(await instanceB(tenantId, taskId, async () => 'after-release'), 'after-release');
}

{
  const shared = memoryStore();
  const instance = createPlatformAdTaskLock({
    dataStore: shared.dataStore,
    ownerId: 'platform-ads-heartbeat',
    heartbeatIntervalMs: 5,
  });
  await instance(tenantId, taskId, async guard => {
    const afterInitialFence = shared.updateCount();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(shared.updateCount() > afterInitialFence, 'a held callback continuously renews its database lease');
    await guard.beforeEffect();
  });
  assert.equal(shared.rows.length, 0);
}

{
  const shared = memoryStore();
  const instance = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-fenced' });
  let providerCalled = false;
  await instance(tenantId, taskId, async guard => {
    shared.rows[0]!.lease_token = 'successor-generation';
    await assert.rejects(
      guard.beforeEffect(),
      error => error instanceof PlatformAdTaskLockError && error.code === 'platform_ad_task_lock_unavailable',
      'a stolen/expired lease generation fences the old worker before its next provider effect',
    );
    try {
      await guard.beforeEffect();
      providerCalled = true;
    } catch { /* expected fail-closed fence */ }
  });
  assert.equal(providerCalled, false);
}

{
  const shared = memoryStore();
  const instance = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-nested' });
  await instance(tenantId, taskId, async () => {
    await assert.rejects(
      instance(tenantId, taskId, async () => 'must-not-run'),
      new RegExp(PLATFORM_AD_TASK_LOCK_MESSAGE),
      'nested same-task contention remains fail-closed instead of becoming re-entrant',
    );
  });
}

{
  const shared = memoryStore();
  const instance = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-exception' });
  await assert.rejects(instance(tenantId, taskId, async () => { throw new Error('injected action failure'); }), /injected action failure/);
  assert.equal(shared.rows.length, 0, 'an action exception still releases its owned generation');
  assert.equal(await instance(tenantId, taskId, async () => 'recovered'), 'recovered');
}

{
  const shared = memoryStore();
  const crashed = await acquireDurableOperationLease({
    dataStore: shared.dataStore,
    tenantId,
    scope: PLATFORM_AD_TASK_LEASE_SCOPE,
    subjectId: platformAdTaskLeaseSubject(taskId),
    ownerId: 'platform-ads-crashed-instance',
    now: start,
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  });
  assert.ok(crashed);
  let currentTime = new Date(start.getTime() + 34_999);
  const successor = createPlatformAdTaskLock({
    dataStore: shared.dataStore,
    ownerId: 'platform-ads-successor',
    now: () => currentTime,
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  });
  await assert.rejects(successor(tenantId, taskId, async () => 'too-early'), /正在执行或需要恢复核对/);
  currentTime = new Date(start.getTime() + 35_000);
  assert.equal(await successor(tenantId, taskId, async () => 'reclaimed'), 'reclaimed',
    'an abandoned generation is taken over only after expiry plus grace');
  assert.equal(shared.rows.length, 0);
}

{
  const shared = memoryStore();
  shared.setUnavailable(true);
  const instance = createPlatformAdTaskLock({ dataStore: shared.dataStore, ownerId: 'platform-ads-storage-outage' });
  let entered = false;
  await assert.rejects(
    instance(tenantId, taskId, async () => { entered = true; }),
    error => error instanceof PlatformAdTaskLockError
      && error.code === 'platform_ad_task_lock_unavailable'
      && error.statusCode === 503
      && error.message === PLATFORM_AD_TASK_LOCK_MESSAGE,
  );
  assert.equal(entered, false, 'storage errors fail closed before the protected action');
}

console.log('platform ad durable task lock tests passed');
