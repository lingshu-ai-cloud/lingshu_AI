import assert from 'node:assert/strict';
import { isScheduledPostDue, runScheduledPublishingCycle, scheduledRetryDelay } from './scheduledPublisher.js';
import type { PostRecord } from './waLink.js';
import { store } from '../storage/index.js';

const now = Date.parse('2026-07-29T10:00:00.000Z');

function post(status: string, overrides: Partial<PostRecord> = {}, stats: Record<string, unknown> = {}): PostRecord {
  return {
    id: 'post-1',
    tenant_id: 'tenant-1',
    platform: 'youtube',
    published_at: '2026-07-29T09:00:00.000Z',
    track_code: 'V1000',
    stats: { status, publishAttempts: 0, ...stats },
    ...overrides,
  };
}

assert.equal(isScheduledPostDue(post('scheduled'), now), true, 'an overdue scheduled post should run');
assert.equal(
  isScheduledPostDue(post('scheduled', {}, { workflowRunId: 'run-1', realPublishingAuthorized: false }), now),
  false,
  'a digital-employee post without explicit real-publishing consent must never run',
);
assert.equal(
  isScheduledPostDue(post('scheduled', {}, { workflowRunId: 'run-1', realPublishingAuthorized: true }), now),
  true,
  'an approved digital-employee post may run only with frozen real-publishing consent',
);
assert.equal(
  isScheduledPostDue(post('scheduled', { published_at: '2026-07-29T11:00:00.000Z' }), now),
  false,
  'a future scheduled post must wait',
);
assert.equal(isScheduledPostDue(post(''), now), false, 'legacy posts without an explicit scheduled status must not run');
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T10:01:00.000Z' }), now),
  false,
  'a failed post must wait until its retry time',
);
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T09:59:00.000Z' }), now),
  true,
  'a failed post should retry after the retry time',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:40:00.000Z' }), now),
  true,
  'a stale publishing lock should recover',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:50:00.000Z' }), now),
  false,
  'an active publishing lock must not run twice',
);
assert.equal(isScheduledPostDue(post('failed', {}, { publishAttempts: 3 }), now), false, 'exhausted tasks must stop retrying');

assert.equal(scheduledRetryDelay(1), 60_000);
assert.equal(scheduledRetryDelay(2), 300_000);
assert.equal(scheduledRetryDelay(3), 900_000);
assert.equal(scheduledRetryDelay(99), 900_000);

const run = { id: 'run-1', tenant_id: 'tenant-1', status: 'running' };
let current = post('scheduled', {}, { workflowRunId: run.id, realPublishingAuthorized: true, targetAccountIds: ['account-1', 'account-2'], videoPath: '/mock-owned-video.mp4' });
const original = { list: store.list, getById: store.getById, update: store.update };
let calls = 0;
let pauseAfterFirstReceipt = false;
store.list = (async () => ({ items: [current], totalItems: 1, totalPages: 1, page: 1, perPage: 500 })) as typeof store.list;
store.getById = (async (collection: string, id: string) => collection === 'workflow_runs' && id === run.id ? run : collection === 'posts' && id === current.id ? current : null) as typeof store.getById;
store.update = (async (_collection: string, _id: string, patch: Record<string, unknown>) => {
  Object.assign(current, patch);
  const results = (current.stats as Record<string, unknown>).publishResults as Record<string, unknown> | undefined;
  if (pauseAfterFirstReceipt && (results?.['account-1'] as any)?.status === 'published') run.status = 'paused';
  return true;
}) as typeof store.update;
const dependencies = {
  publish: async () => {
    calls += 1;
    return { video: {}, tracking: current, publishRecord: null, platformPostId: `provider-post-${calls}` };
  },
  finalize: async (_id: string, patch: { stats?: Record<string, unknown> }) => { Object.assign(current, patch); },
};
try {
  for (const status of ['paused', 'cancelled', 'waiting_human', 'failed', 'succeeded']) {
    run.status = status;
    await runScheduledPublishingCycle(now, dependencies);
    assert.equal(calls, 0, `${status} runs must never publish`);
    assert.equal((current.stats as Record<string, unknown>).publishAttempts, 0);
  }
  run.status = 'running';
  run.tenant_id = 'other-tenant';
  await runScheduledPublishingCycle(now, dependencies);
  assert.equal(calls, 0, 'cross-tenant run references must fail closed');
  run.tenant_id = 'tenant-1';
  pauseAfterFirstReceipt = true;
  await runScheduledPublishingCycle(now, dependencies);
  assert.equal(calls, 1, 'a pause after the first account must prevent the second account publishing');
  const pausedStats = current.stats as Record<string, any>;
  assert.equal(pausedStats.publishResults['account-1'].platformPostId, 'provider-post-1', 'preserve already accepted provider receipts');
  assert.equal(pausedStats.workflowBlockedReason, 'workflow_run_paused');
  pauseAfterFirstReceipt = false;
  run.status = 'running';
  await runScheduledPublishingCycle(now, dependencies);
  assert.equal(calls, 2, 'resume must publish only the remaining account, not duplicate the first');
  assert.equal((current.stats as Record<string, unknown>).status, 'published');
} finally {
  store.list = original.list;
  store.getById = original.getById;
  store.update = original.update;
}

// Store snapshots are detached, like a real storage backend. A finalization
// error must not roll successful account receipts back to the queue snapshot.
let rows: PostRecord[] = [];
let providerCalls = 0;
let finalizeCalls = 0;
let failFinalization = true;
const clone = <T>(value: T): T => structuredClone(value);
store.list = (async (_collection: string, query: { page?: number; perPage?: number } = {}) => {
  const page = query.page || 1, perPage = query.perPage || 500;
  return { items: clone(rows.slice((page - 1) * perPage, page * perPage)), totalItems: rows.length, totalPages: Math.ceil(rows.length / perPage), page, perPage };
}) as typeof store.list;
store.getById = (async (_collection: string, id: string) => clone(rows.find(row => row.id === id) || null)) as typeof store.getById;
store.update = (async (_collection: string, id: string, patch: Record<string, unknown>) => {
  const row = rows.find(row => row.id === id);
  if (!row) return false;
  Object.assign(row, clone(patch)); return true;
}) as typeof store.update;
const localDependencies = {
  publish: async () => {
    providerCalls += 1;
    return { video: {}, tracking: rows[0], publishRecord: null, platformPostId: `receipt-${providerCalls}` };
  },
  finalize: async (id: string, patch: { stats?: Record<string, unknown> }) => {
    finalizeCalls += 1;
    if (failFinalization) throw Error('injected finalization outage');
    await store.update('posts', id, patch);
  },
};
try {
  rows = [post('scheduled', {}, { targetAccountIds: ['a', 'b'], videoPath: '/isolated.mp4', publishAttempts: 2 })];
  await runScheduledPublishingCycle(now, localDependencies);
  assert.equal(providerCalls, 2);
  assert.equal((rows[0].stats as any).status, 'finalize_pending');
  assert.equal((rows[0].stats as any).publishResults.a.platformPostId, 'receipt-1');
  assert.equal((rows[0].stats as any).publishResults.b.platformPostId, 'receipt-2');
  const retryAt = Date.parse((rows[0].stats as any).nextPublishAttemptAt);
  assert.equal(isScheduledPostDue(rows[0], retryAt - 1), false);
  failFinalization = false;
  await runScheduledPublishingCycle(retryAt, localDependencies);
  assert.equal(providerCalls, 2, 'finalization retries must not republish either account');
  assert.equal(finalizeCalls, 2);
  assert.equal((rows[0].stats as any).status, 'published', 'local finalization recovers after delivery attempts exhausted');

  rows = Array.from({ length: 501 }, (_, i) => post('published', { id: `history-${i}` }));
  rows.push(post('scheduled', { id: 'new-due' }, { targetAccountIds: ['c'], videoPath: '/isolated.mp4' }));
  assert.equal(await runScheduledPublishingCycle(now, localDependencies), 1);
  assert.equal((rows[501].stats as any).status, 'published', 'old completed rows cannot starve later pages');
  assert.equal(providerCalls, 3);
  rows = [post('scheduled', {}, { targetAccountIds: ['c'], videoPath: '/isolated.mp4' })];
  let ambiguousCalls = 0;
  await runScheduledPublishingCycle(now, { ...localDependencies, publish: async () => { ambiguousCalls++; throw new Error('socket closed after acceptance'); } });
  assert.equal((rows[0].stats as any).status, 'needs_attention');
  assert.equal((rows[0].stats as any).publishResults.c.status, 'unknown');
  assert.match((rows[0].stats as any).publishResults.c.attemptId, /^[0-9a-f-]{36}$/);
  await runScheduledPublishingCycle(now + 86400000, localDependencies);
  assert.equal(ambiguousCalls, 1); assert.equal(providerCalls, 3, 'ambiguous request must never be resent');
  rows = [post('publishing', {}, { targetAccountIds: ['c'], videoPath: '/isolated.mp4', lastPublishAttemptAt: new Date(now - 3600000).toISOString(), publishResults: { c: { status: 'in_flight', attemptId: 'crashed-attempt' } } })];
  await runScheduledPublishingCycle(now, localDependencies);
  assert.equal((rows[0].stats as any).publishResults.c.status, 'unknown');
  assert.equal(providerCalls, 3, 'restart with no first receipt requires reconciliation');
  rows = [post('scheduled', {}, { targetAccountIds: ['c'], videoPath: '/isolated.mp4' })];
  const updating = store.update;
  let failFirstReceipt = true;
  store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
    if (failFirstReceipt && (patch.stats as any)?.publishResults?.c?.status === 'published') { failFirstReceipt = false; return false; }
    return updating(collection, id, patch);
  }) as typeof store.update;
  await runScheduledPublishingCycle(now, localDependencies);
  assert.equal(providerCalls, 4);
  assert.equal((rows[0].stats as any).publishResults.c.status, 'unknown', 'first receipt write loss retains durable attempt');
  await runScheduledPublishingCycle(now + 86400000, localDependencies);
  assert.equal(providerCalls, 4, 'first receipt persistence outage cannot cause duplicate delivery');
} finally {
  Object.assign(store, original);
}

console.log('scheduledPublisher passed');
