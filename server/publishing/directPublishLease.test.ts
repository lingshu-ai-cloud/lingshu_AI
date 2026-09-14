import assert from 'node:assert/strict';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
} from '../runtime/durableLease.js';
import {
  DIRECT_PUBLISH_LEASE_SCOPE,
  DirectPublishingLeaseError,
  directPublishingContentFingerprint,
  directPublishingLeaseSubject,
  withDirectPublishingLease,
} from './pendingPublishGuard.js';

type Row = Record_ & Record<string, unknown>;

function memoryStore(): { dataStore: DataStore; rows: Row[] } {
  const rows: Row[] = [];
  let sequence = 0;
  const clone = <T>(value: T): T => structuredClone(value);
  const dataStore: DataStore = {
    async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      return clone(rows.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
      assert.equal(collection, DURABLE_OPERATION_LEASE_COLLECTION);
      if (rows.some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
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
      return {
        items: clone(matches) as T[], totalItems: matches.length, totalPages: matches.length ? 1 : 0,
        page: query.page ?? 1, perPage: query.perPage ?? 20,
      };
    },
  };
  return { dataStore, rows };
}

const input = {
  tenantId: 'tenant-a', platform: 'youtube', accountId: 'account-a',
  contentId: 'content-a', videoPath: '/isolated/content-a.mp4',
};

assert.equal(
  directPublishingContentFingerprint(input),
  directPublishingContentFingerprint({ ...input }),
  'stable content identity must produce a stable direct-publish lock key',
);
assert.notEqual(directPublishingContentFingerprint(input), directPublishingContentFingerprint({ ...input, contentId: 'other-content' }));

{
  const shared = memoryStore();
  let releaseFirst!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  let entered = 0;
  const first = withDirectPublishingLease(input, async () => { entered += 1; await held; return 'first'; }, {
    dataStore: shared.dataStore, ownerId: 'direct-instance-a',
  });
  while (!shared.rows.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    withDirectPublishingLease(input, async () => { entered += 1; return 'second'; }, {
      dataStore: shared.dataStore, ownerId: 'direct-instance-b',
    }),
    error => error instanceof DirectPublishingLeaseError && error.code === 'direct_publish_busy',
  );
  assert.equal(entered, 1);
  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(shared.rows.length, 0);
}

{
  const shared = memoryStore();
  let now = new Date('2026-09-14T00:00:00.000Z');
  let providerCalled = false;
  await withDirectPublishingLease(input, async guard => {
    now = new Date(now.getTime() + 29_000);
    await guard.beforeEffect();
    assert.ok(Date.parse(String(shared.rows[0]?.expires_at)) >= now.getTime() + 30_000);
    shared.rows[0]!.lease_token = 'successor-generation';
    await assert.rejects(
      guard.beforeEffect(),
      error => error instanceof DirectPublishingLeaseError && error.code === 'direct_publish_lock_unavailable',
    );
    try { await guard.beforeEffect(); providerCalled = true; } catch { /* fenced */ }
  }, {
    dataStore: shared.dataStore,
    ownerId: 'direct-expiry-owner',
    now: () => now,
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  });
  assert.equal(providerCalled, false, 'a lost generation must be fenced before provider submission');
}

{
  const shared = memoryStore();
  const start = new Date('2026-09-14T00:00:00.000Z');
  const crashed = await acquireDurableOperationLease({
    dataStore: shared.dataStore,
    tenantId: input.tenantId,
    scope: DIRECT_PUBLISH_LEASE_SCOPE,
    subjectId: directPublishingLeaseSubject({
      platform: input.platform,
      accountId: input.accountId,
      contentFingerprint: directPublishingContentFingerprint(input),
    }),
    ownerId: 'direct-crashed-instance',
    now: start,
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  });
  assert.ok(crashed);
  let now = new Date(start.getTime() + 34_999);
  const dependencies = {
    dataStore: shared.dataStore,
    ownerId: 'direct-successor-instance',
    now: () => now,
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  };
  await assert.rejects(
    withDirectPublishingLease(input, async () => 'too-early', dependencies),
    error => error instanceof DirectPublishingLeaseError && error.code === 'direct_publish_busy',
  );
  now = new Date(start.getTime() + 35_000);
  assert.equal(
    await withDirectPublishingLease(input, async () => 'reclaimed', dependencies),
    'reclaimed',
    'an abandoned direct-publish generation is reclaimed only after expiry plus grace',
  );
  assert.equal(shared.rows.length, 0);
}

{
  const original = {
    nodeEnv: process.env.NODE_ENV,
    enableFallback: process.env.ENABLE_LOCAL_DEV_FALLBACK,
    disableFallback: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
    testAuthority: process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK,
  };
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
  delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
  delete process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK;
  let entered = false;
  try {
    await assert.rejects(
      withDirectPublishingLease(input, async () => { entered = true; }),
      error => error instanceof DirectPublishingLeaseError
        && error.code === 'direct_publish_lock_unavailable'
        && error.statusCode === 503,
    );
    assert.equal(entered, false, 'local JSON fallback must never authorize a real publish');
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.enableFallback === undefined) delete process.env.ENABLE_LOCAL_DEV_FALLBACK; else process.env.ENABLE_LOCAL_DEV_FALLBACK = original.enableFallback;
    if (original.disableFallback === undefined) delete process.env.DISABLE_LOCAL_AUTH_FALLBACK; else process.env.DISABLE_LOCAL_AUTH_FALLBACK = original.disableFallback;
    if (original.testAuthority === undefined) delete process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK; else process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = original.testAuthority;
  }
}

console.log('direct publishing durable lease tests passed');
