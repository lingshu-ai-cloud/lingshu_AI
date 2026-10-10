import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const original = {
  nodeEnv: process.env.NODE_ENV,
  enable: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  disable: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  localStoreDir: process.env.LOCAL_STORE_DIR,
  pbUrl: process.env.PB_URL,
  fetch: globalThis.fetch,
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-pb-policy-'));
process.env.NODE_ENV = 'development';
delete process.env.ENABLE_LOCAL_DEV_FALLBACK;
delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
process.env.LOCAL_STORE_DIR = temporary;
process.env.PB_URL = 'http://pocketbase-policy.test';
delete process.env.PB_ADMIN_EMAIL;
delete process.env.PB_ADMIN_PASSWORD;

fs.writeFileSync(path.join(temporary, 'widgets.json'), JSON.stringify([
  { id: 'seeded-widget', tenant_id: 'tenant-a', name: 'demo record' },
]));

const [{ localFallbacksEnabled }, { pbStore }, { runWithDataAuthority }, { acquireDurableOperationLease }] = await Promise.all([
  import('../lib/localFallbackPolicy.js'),
  import('./pbStore.js'),
  import('./dataAuthority.js'),
  import('../runtime/durableLease.js'),
]);

try {
  assert.equal(localFallbacksEnabled(), false, 'ordinary development must not silently enable demo storage');

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('/api/collections/widgets/records?')) {
      return Response.json({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 20 });
    }
    return new Response(null, { status: 404 });
  };
  process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
  const authoritativeEmpty = await pbStore.list('widgets', { where: { tenant_id: 'tenant-a' } });
  assert.equal(authoritativeEmpty.totalItems, 0);
  assert.deepEqual(authoritativeEmpty.items, [], 'a valid PocketBase empty result must not be replaced by demo rows');

  globalThis.fetch = async () => new Response('database unavailable', { status: 503 });
  const explicitDemoFallback = await pbStore.list<{ id: string }>('widgets', { where: { tenant_id: 'tenant-a' } });
  assert.deepEqual(explicitDemoFallback.items.map(item => item.id), ['seeded-widget']);

  delete process.env.ENABLE_LOCAL_DEV_FALLBACK;
  await assert.rejects(
    () => pbStore.list('widgets', { where: { tenant_id: 'tenant-a' } }),
    /widgets read failed \(503\): database unavailable/,
  );

  process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
  assert.equal(localFallbacksEnabled(), true, 'legacy test flag remains an explicit opt-in');

  const leaseInput = {
    dataStore: pbStore,
    tenantId: 'tenant-local',
    scope: 'content_queue_scheduler',
    subjectId: 'global',
    now: new Date('2026-10-11T00:00:00.000Z'),
    leaseDurationMs: 60_000,
  };
  const leaseAttempts = await runWithDataAuthority('local', () => Promise.all(
    Array.from({ length: 8 }, (_, index) => acquireDurableOperationLease({
      ...leaseInput,
      ownerId: `local-worker-${index}`,
    })),
  ));
  assert.equal(leaseAttempts.filter(Boolean).length, 1,
    'local preview storage must elect one durable lease owner for a composite key');
  const storedLeases = JSON.parse(fs.readFileSync(path.join(temporary, 'durable_operation_leases.json'), 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(storedLeases.length, 1, 'concurrent local acquisition must persist one lease generation');

  process.env.NODE_ENV = 'production';
  assert.equal(localFallbacksEnabled(), false, 'production must fail closed regardless of demo flags');
  console.log('PocketBase local fallback policy passed');
} finally {
  globalThis.fetch = original.fetch;
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
  if (original.enable === undefined) delete process.env.ENABLE_LOCAL_DEV_FALLBACK; else process.env.ENABLE_LOCAL_DEV_FALLBACK = original.enable;
  if (original.disable === undefined) delete process.env.DISABLE_LOCAL_AUTH_FALLBACK; else process.env.DISABLE_LOCAL_AUTH_FALLBACK = original.disable;
  if (original.localStoreDir === undefined) delete process.env.LOCAL_STORE_DIR; else process.env.LOCAL_STORE_DIR = original.localStoreDir;
  if (original.pbUrl === undefined) delete process.env.PB_URL; else process.env.PB_URL = original.pbUrl;
  fs.rmSync(temporary, { recursive: true, force: true });
}
