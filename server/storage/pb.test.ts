import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adminFetch,
  invalidatePbAdminToken,
  pbCompareAndSet,
  pbCreate,
  pbDelete,
  pbGet,
  pbList,
  pbPatch,
  PbError,
} from './pb.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const localStore = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-pb-store-test-'));
process.env.PB_ADMIN_EMAIL = 'admin@example.test';
process.env.PB_ADMIN_PASSWORD = 'test-password';
process.env.PB_URL = 'http://pocketbase.test';
process.env.ENABLE_LOCAL_STORE_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = localStore;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;
let handler: FetchHandler = async () => new Response(null, { status: 404 });
let authCount = 0;
let authHandler: FetchHandler = async () => Response.json({ token: `admin-token-${authCount}` });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/api/collections/_superusers/auth-with-password') || url.endsWith('/api/admins/auth-with-password')) {
    authCount += 1;
    return authHandler(url, init);
  }
  return handler(url, init);
};

async function assertPbError(work: () => Promise<unknown>, status?: number): Promise<PbError> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof PbError, `expected PbError, got ${String(error)}`);
    if (status !== undefined) assert.equal(error.status, status);
    return error;
  }
  assert.fail('expected PocketBase operation to fail');
}

try {
  // A 5xx from the current auth endpoint is not masked by trying the legacy
  // endpoint and reporting its 404 instead.
  invalidatePbAdminToken();
  authCount = 0;
  authHandler = async () => Response.json({ message: 'auth database unavailable' }, { status: 503 });
  const authUnavailable = await assertPbError(() => adminFetch('/api/collections/tenant_profiles/records'), 503);
  assert.equal(authUnavailable.code, 'pb_auth_error');
  assert.equal(authUnavailable.retryable, true);
  assert.equal(authCount, 1);

  // Older PocketBase versions use the legacy admin endpoint; only a 404 on
  // the current endpoint is eligible for this compatibility fallback.
  invalidatePbAdminToken();
  authCount = 0;
  authHandler = async url => url.includes('/_superusers/')
    ? Response.json({ message: 'route missing' }, { status: 404 })
    : Response.json({ token: 'legacy-admin-token' });
  handler = async (_url, init) => Response.json({ authorization: new Headers(init?.headers).get('Authorization') });
  const legacy = await adminFetch('/api/collections/tenant_profiles/records');
  assert.equal((await legacy.json() as { authorization: string }).authorization, 'legacy-admin-token');
  assert.equal(authCount, 2);

  // A stale superuser token is retried exactly once with a fresh token.
  invalidatePbAdminToken();
  authCount = 0;
  authHandler = async () => Response.json({ token: `admin-token-${authCount}` });
  const writes: string[] = [];
  handler = async (url, init) => {
    if (!url.endsWith('/api/collections/tenant_profiles/records')) return new Response(null, { status: 404 });
    const authorization = new Headers(init?.headers).get('Authorization') || '';
    writes.push(authorization);
    return authorization === 'admin-token-1'
      ? Response.json({ message: 'Only superusers can perform this action.' }, { status: 403 })
      : Response.json({ id: 'profile-1' });
  };
  const response = await adminFetch('/api/collections/tenant_profiles/records', { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  assert.equal(authCount, 2);
  assert.deepEqual(writes, ['admin-token-1', 'admin-token-2']);

  // Only a real record 404 is mapped to null.
  invalidatePbAdminToken();
  handler = async () => Response.json({ data: {}, message: "The requested resource wasn't found.", status: 404 }, { status: 404 });
  assert.equal(await pbGet('tenant_profiles', 'missing'), null);
  assert.equal(await pbPatch('tenant_profiles', 'missing', { title: 'none' }), false);
  assert.equal(await pbDelete('tenant_profiles', 'missing'), false);

  // A collection/schema 404 is not a missing record, and a missing atomic
  // hook route must fail closed instead of masquerading as a normal CAS miss.
  handler = async () => Response.json({ data: {}, message: 'Missing collection context.', status: 404 }, { status: 404 });
  await assertPbError(() => pbGet('unknown_collection', 'missing'), 404);
  handler = async () => Response.json({ data: {}, message: "The requested resource wasn't found.", status: 404 }, { status: 404 });
  await assertPbError(() => pbCompareAndSet('workflow_runs', 'missing', { revision: 0 }, { revision: 1 }), 404);
  handler = async () => Response.json({ reason: 'not_found' }, { status: 404 });
  assert.deepEqual(await pbCompareAndSet('workflow_runs', 'missing', { revision: 0 }, { revision: 1 }), { ok: false, reason: 'not_found' });

  // 5xx and validation errors are explicit and never look like empty data.
  handler = async () => Response.json({ message: 'database unavailable' }, { status: 503 });
  const unavailable = await assertPbError(() => pbGet('tenant_profiles', 'record'), 503);
  assert.equal(unavailable.retryable, true);
  await assertPbError(() => pbList('tenant_profiles'), 503);
  handler = async () => Response.json({ data: { tenant_id: { code: 'validation_required' } } }, { status: 400 });
  const validation = await assertPbError(() => pbCreate('tenant_profiles', {}), 400);
  assert.equal(validation.retryable, false);

  // Atomic conflicts are returned as data; infrastructure failures still throw.
  handler = async url => url.includes('/compare-and-set/')
    ? Response.json({ reason: 'conflict', current: { id: 'run-1', status: 'running' } }, { status: 409 })
    : new Response(null, { status: 404 });
  const conflict = await pbCompareAndSet<{ id: string; status: string }>('workflow_runs', 'run-1', { status: 'pending' }, { status: 'running' });
  assert.deepEqual(conflict, { ok: false, reason: 'conflict', current: { id: 'run-1', status: 'running' } });

  // Explicit local fallback may handle transport failure in development, but a
  // later authoritative remote 404 must not resurrect stale local data.
  invalidatePbAdminToken();
  const { pbStore } = await import('./pbStore.js');
  handler = async () => { throw new Error('connection refused'); };
  const local = await pbStore.create<{ id: string; title: string }>('tenant_profiles', { id: 'local-stale', title: 'stale' });
  assert.equal(local?.id, 'local-stale');
  invalidatePbAdminToken();
  handler = async () => Response.json({ data: {}, message: "The requested resource wasn't found.", status: 404 }, { status: 404 });
  assert.equal(await pbStore.getById('tenant_profiles', 'local-stale'), null);

  // PB validation failures are not eligible for local persistence fallback.
  handler = async () => Response.json({ message: 'invalid' }, { status: 400 });
  await assertPbError(() => pbStore.create('tenant_profiles', { id: 'must-not-persist' }), 400);

  // Queue reads translate the one inclusive upper bound and skipTotal hint to
  // PocketBase without weakening the equality predicate or stable sort.
  let queueListUrl = '';
  handler = async url => {
    queueListUrl = url;
    return Response.json({
      items: [{ id: 'post-due', publish_queue_state: 'pending' }],
      totalItems: -1,
      totalPages: -1,
      page: 1,
      perPage: 100,
    });
  };
  const queueList = await pbStore.list('posts', {
    where: { publish_queue_state: 'pending' },
    lte: { publish_available_at: '2026-09-02T12:00:00.000Z' },
    sort: 'publish_available_at,id',
    page: 1,
    perPage: 100,
    skipTotal: true,
  });
  const queueUrl = new URL(queueListUrl);
  assert.equal(queueUrl.searchParams.get('filter'), 'publish_queue_state = "pending" && publish_available_at <= "2026-09-02T12:00:00.000Z"');
  assert.equal(queueUrl.searchParams.get('sort'), 'publish_available_at,id');
  assert.equal(queueUrl.searchParams.get('skipTotal'), '1');
  assert.deepEqual(queueList.items.map(item => item.id), ['post-due']);
  assert.equal(queueList.totalItems, -1);
  assert.equal(queueList.totalPages, -1);
  await assert.rejects(
    () => pbStore.list('posts', { lte: { publish_available_at: '2026-09-02T12:00:00.000Z', published_at: '2026-09-02T12:00:00.000Z' } }),
    /datastore_lte_supports_one_field/,
  );

  // Development fallback preserves the same bounded predicate, multi-column
  // order, missing-value exclusion, and skipped-total sentinel.
  handler = async () => { throw new Error('connection refused'); };
  for (const record of [
    { id: 'post-b', publish_queue_state: 'pending', publish_available_at: '2026-09-02T11:00:00.000Z' },
    { id: 'post-a', publish_queue_state: 'pending', publish_available_at: '2026-09-02T11:00:00.000Z' },
    { id: 'post-future', publish_queue_state: 'pending', publish_available_at: '2026-09-02T13:00:00.000Z' },
    { id: 'post-terminal', publish_queue_state: 'terminal', publish_available_at: '2026-09-02T10:00:00.000Z' },
    { id: 'post-missing-time', publish_queue_state: 'pending' },
  ]) {
    await pbStore.create('posts', record);
  }
  const localQueue = await pbStore.list('posts', {
    where: { publish_queue_state: 'pending' },
    lte: { publish_available_at: '2026-09-02T12:00:00.000Z' },
    sort: 'publish_available_at,id',
    perPage: 100,
    skipTotal: true,
  });
  assert.deepEqual(localQueue.items.map(item => item.id), ['post-a', 'post-b']);
  assert.equal(localQueue.totalItems, -1);
  assert.equal(localQueue.totalPages, -1);

  console.log('PocketBase strict semantics, bounded queue reads, retry, atomic conflict, and fallback isolation passed');
} finally {
  globalThis.fetch = originalFetch;
  invalidatePbAdminToken();
  fs.rmSync(localStore, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}
