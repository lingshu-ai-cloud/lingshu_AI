import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithDataAuthority } from './dataAuthority.js';

const original = {
  pbUrl: process.env.PB_URL,
  adminEmail: process.env.PB_ADMIN_EMAIL,
  adminPassword: process.env.PB_ADMIN_PASSWORD,
  fetch: globalThis.fetch,
};

process.env.PB_URL = 'http://pocketbase-cas.test';
delete process.env.PB_ADMIN_EMAIL;
delete process.env.PB_ADMIN_PASSWORD;

const { pbStore } = await import('./pbStore.js');
const compareAndSwap = pbStore.compareAndSwap;
assert.ok(compareAndSwap, 'PocketBase store must expose compareAndSwap');

type StoredRecord = Record<string, unknown> & { id: string };

function createPocketBaseHarness(blockFirstRead = false, blockFirstOwnershipRead = false) {
  const target: StoredRecord = { id: 'record000000001', version: 1, value: 'before' };
  const claims = new Map<string, StoredRecord>();
  let claimAttempts = 0;
  let releaseConcurrentReads!: () => void;
  const concurrentReadsReady = new Promise<void>(resolve => { releaseConcurrentReads = resolve; });
  let preserveClaims = false;
  let targetReadFailures = 0;
  let targetPatchCount = 0;
  let ownershipReads = 0;
  let releaseOwnershipRead!: () => void;
  let signalOwnershipRead!: () => void;
  const ownershipReadBlocked = new Promise<void>(resolve => { signalOwnershipRead = resolve; });
  const ownershipReadRelease = new Promise<void>(resolve => { releaseOwnershipRead = resolve; });

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const segments = url.pathname.split('/').filter(Boolean);
    const collection = decodeURIComponent(segments[2] ?? '');
    const id = segments[4] ? decodeURIComponent(segments[4]) : '';

    if (collection === 'datastore_cas_claims' && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as StoredRecord;
      claimAttempts += 1;
      if (claimAttempts >= 2) releaseConcurrentReads();
      if ([...claims.values()].some(claim => claim.target_key === body.target_key)) {
        return Response.json({ message: 'duplicate target_key' }, { status: 400 });
      }
      claims.set(body.id, structuredClone(body));
      return Response.json(body);
    }
    if (collection === 'datastore_cas_claims' && method === 'GET') {
      if (!id) {
        const items = [...claims.values()].map(claim => structuredClone(claim));
        return Response.json({ items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: 1 });
      }
      ownershipReads += 1;
      if (blockFirstOwnershipRead && ownershipReads === 1) {
        signalOwnershipRead();
        await ownershipReadRelease;
      }
      const claim = claims.get(id);
      return claim ? Response.json(claim) : new Response(null, { status: 404 });
    }
    if (collection === 'datastore_cas_claims' && method === 'DELETE') {
      if (!preserveClaims) claims.delete(id);
      return new Response(null, { status: 204 });
    }
    if (collection === 'widgets' && id === target.id && method === 'GET') {
      if (targetReadFailures > 0) {
        targetReadFailures -= 1;
        return new Response('target read unavailable', { status: 503 });
      }
      if (blockFirstRead && claimAttempts === 1) await concurrentReadsReady;
      return Response.json(structuredClone(target));
    }
    if (collection === 'widgets' && id === target.id && method === 'PATCH') {
      targetPatchCount += 1;
      Object.assign(target, JSON.parse(String(init.body ?? '{}')));
      return Response.json(structuredClone(target));
    }
    return new Response(null, { status: 404 });
  };

  return {
    fetch,
    target,
    claims,
    setPreserveClaims(value: boolean) { preserveClaims = value; },
    failNextTargetRead() { targetReadFailures += 1; },
    expireClaims() {
      for (const claim of claims.values()) claim.lease_expires_at = new Date(0).toISOString();
    },
    waitForOwnershipRead() { return ownershipReadBlocked; },
    releaseBlockedOwnershipRead() { releaseOwnershipRead(); },
    targetPatchCount() { return targetPatchCount; },
  };
}

test('PocketBase CAS elects one cross-instance winner for the same expected state', async () => {
  const harness = createPocketBaseHarness(true);
  globalThis.fetch = harness.fetch;
  const [first, second] = await runWithDataAuthority('pocketbase', () => Promise.all([
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'first' }),
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'second' }),
  ]));
  assert.deepEqual([first, second].sort(), [false, true]);
  assert.equal(harness.target.version, 2);
  assert.ok(['first', 'second'].includes(String(harness.target.value)));
});

test('PocketBase target mutex prevents an ordinary update from interleaving with CAS', async () => {
  const harness = createPocketBaseHarness(true);
  globalThis.fetch = harness.fetch;
  const [guarded, ordinary] = await runWithDataAuthority('pocketbase', () => Promise.all([
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'guarded' }),
    pbStore.update('widgets', harness.target.id, { value: 'ordinary' }),
  ]));
  assert.equal(guarded, true);
  assert.equal(ordinary, false);
  assert.deepEqual(harness.target, { id: harness.target.id, version: 2, value: 'guarded' });
});

test('PocketBase target mutex prevents CAS from interleaving with an ordinary update winner', async () => {
  const harness = createPocketBaseHarness();
  globalThis.fetch = harness.fetch;
  const [ordinary, guarded] = await runWithDataAuthority('pocketbase', () => Promise.all([
    pbStore.update('widgets', harness.target.id, { value: 'ordinary' }),
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'guarded' }),
  ]));
  assert.equal(ordinary, true);
  assert.equal(guarded, false);
  assert.deepEqual(harness.target, { id: harness.target.id, version: 1, value: 'ordinary' });
});

test('PocketBase CAS recognizes only an exact committed replay behind a retained claim', async () => {
  const harness = createPocketBaseHarness();
  harness.setPreserveClaims(true);
  globalThis.fetch = harness.fetch;
  const first = await runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'winner' })
  ));
  assert.equal(first, true);
  assert.equal(harness.claims.size, 1, 'simulated cleanup failure retains a server-visible claim');

  const replay = await runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'winner' })
  ));
  assert.equal(replay, true, 'the exact committed operation is safe to replay');

  const contender = await runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'different' })
  ));
  assert.equal(contender, false, 'a different operation cannot borrow the winner claim');
  assert.equal(harness.target.value, 'winner');
});

test('PocketBase CAS keeps its claim and fails closed when post-claim verification is unavailable', async () => {
  const harness = createPocketBaseHarness();
  harness.failNextTargetRead();
  globalThis.fetch = harness.fetch;
  await assert.rejects(
    () => runWithDataAuthority('pocketbase', () => (
      compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'unsafe' })
    )),
    /widgets\/record000000001 read failed \(503\)/,
  );
  assert.equal(harness.claims.size, 1, 'an indeterminate winner claim must not be deleted');
  assert.equal(harness.target.value, 'before', 'no unverified write may be reported as successful');

  harness.expireClaims();
  const recovered = await runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'unsafe' })
  ));
  assert.equal(recovered, true, 'the exact operation can recover after the conservative lease expires');
  assert.equal(harness.target.value, 'unsafe');
});

test('an expired owner cannot write after an exact replay takes over its target claim', async () => {
  const harness = createPocketBaseHarness(false, true);
  globalThis.fetch = harness.fetch;
  const first = runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'winner' })
  ));
  await harness.waitForOwnershipRead();
  harness.expireClaims();
  const replacement = await runWithDataAuthority('pocketbase', () => (
    compareAndSwap('widgets', harness.target.id, { version: 1 }, { version: 2, value: 'winner' })
  ));
  harness.releaseBlockedOwnershipRead();
  assert.equal(replacement, true);
  assert.equal(await first, false, 'the old owner must fail its owner-token check before PATCH');
  assert.equal(harness.targetPatchCount(), 1, 'only the replacement owner may mutate the target');
  assert.deepEqual(harness.target, { id: harness.target.id, version: 2, value: 'winner' });
});

test.after(() => {
  globalThis.fetch = original.fetch;
  if (original.pbUrl === undefined) delete process.env.PB_URL; else process.env.PB_URL = original.pbUrl;
  if (original.adminEmail === undefined) delete process.env.PB_ADMIN_EMAIL; else process.env.PB_ADMIN_EMAIL = original.adminEmail;
  if (original.adminPassword === undefined) delete process.env.PB_ADMIN_PASSWORD; else process.env.PB_ADMIN_PASSWORD = original.adminPassword;
});
