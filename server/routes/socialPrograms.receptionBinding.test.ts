import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialProgramService } from '../socialPrograms/service.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { createSocialProgramsRouter } from './socialPrograms.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const next = list.filter(row => row.id !== id);
      rows.set(collection, next);
      return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(row => (
        Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)
      ));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => {
          const a = left[field];
          const b = right[field];
          const comparison = typeof a === 'number' && typeof b === 'number'
            ? a - b : String(a ?? '').localeCompare(String(b ?? ''));
          return comparison * (descending ? -1 : 1);
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return {
        items: structuredClone(items.slice(start, start + perPage)) as T[],
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / perPage)),
        page,
        perPage,
      };
    },
  };
}

test('HTTP explicit reception bindings isolate scope and preserve frozen package versions', async t => {
  const dataStore = memoryStore(); const service = createSocialProgramService(dataStore);
  const program = await service.createProgram('tenant-a', 'owner', { brandName: 'Factory', market: 'US', targetAudience: 'Buyers', candidatePlatforms: ['youtube'], route: 'cold_start' });
  const account = await service.createAccount('tenant-a', 'owner', program.programId, { platform: 'youtube', displayName: 'Factory Channel', businessRole: '主账号', audiencePromise: 'Buyers', contentPromise: 'Product evidence' });
  const packages = createWeeklyOperatingPackageService(dataStore);
  const pkg = await packages.create('tenant-a', 'owner', program.programId, { weekStart: '2026-10-05', objective: 'Test reception', successCriteria: ['Reception verified'], accountPlans: [{ accountId: account.accountId, publicationCount: 1 }], publicationTasks: [{ cta: 'Contact sales' }] });
  const publication = pkg.socialContentPackage.publicationTasks[0]; assert.ok(publication);
  const frozenRows = structuredClone((await dataStore.list('social_weekly_operating_packages')).items);
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.header('x-test-tenant') ?? 'tenant-a'; res.locals.userId = 'owner'; next(); });
  app.use('/api/overseas/social-programs', createSocialProgramsRouter(dataStore, false));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/social-programs/${program.programId}/operating-packages/${pkg.packageId}/publications/${publication.publicationTaskId}/reception-binding`;
  const post = (version: number, targetUrl = url, tenant = 'tenant-a') => fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-tenant': tenant }, body: JSON.stringify({ packageVersion: version, cta: 'Contact sales', enterpriseFactHash: 'facts-v1', targets: [{ id: 'cta', required: true, ownerId: 'owner', destination: { kind: 'messaging', channel: 'whatsapp', receptionMode: 'human' }, requiredDocumentUrls: [] }] }) });
  const current = await post(pkg.version); assert.equal(current.status, 200); const currentBody = await current.json(); assert.equal(currentBody.planningRevisionRequired, true);
  const next = await post(pkg.version + 1); assert.equal(next.status, 200); const nextBody = await next.json(); assert.notEqual(currentBody.item.bindingId, nextBody.item.bindingId);
  const rows = (await dataStore.list<any>('social_weekly_reception_bindings')).items;
  assert.deepEqual(rows.map(row => row.payload.packageVersion).sort(), [pkg.version, pkg.version + 1]);
  assert.equal(rows[0].payload.cta, publication.cta); assert.equal(rows[1].payload.cta, 'Contact sales');
  assert.equal((await post(pkg.version + 2)).status, 409);
  assert.equal((await post(pkg.version, url, 'tenant-other')).status, 404);
  assert.equal((await post(pkg.version, url.replace(`/publications/${publication.publicationTaskId}/`, '/publications/not-in-package/'))).status, 404);
  assert.deepEqual((await dataStore.list('social_weekly_operating_packages')).items, frozenRows, 'binding save cannot mutate frozen package or create a revision');
});

test('parent router mounts sales handoff reads with authenticated tenant and explicit version', async () => {
  const dataStore = memoryStore();
  const service = createSocialProgramService(dataStore);
  const program = await service.createProgram('tenant-a', 'owner', { brandName: 'Factory', market: 'US', targetAudience: 'Buyers', candidatePlatforms: ['youtube'], route: 'cold_start' });
  await dataStore.create('users', { id: 'owner', tenantId: 'tenant-a', role: 'social_operator' });
  const account = await service.createAccount('tenant-a', 'owner', program.programId, { platform: 'youtube', displayName: 'Factory Channel', businessRole: '主账号', audiencePromise: 'Buyers', contentPromise: 'Product evidence' });
  const pkg = await createWeeklyOperatingPackageService(dataStore).create('tenant-a', 'owner', program.programId, { weekStart: '2026-10-05', objective: 'Sales handoff', successCriteria: ['真实交接'], accountPlans: [{ accountId: account.accountId, publicationCount: 1 }] });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = req.header('x-test-tenant') ?? 'tenant-a'; res.locals.userId = 'owner'; next(); });
  app.use('/api/overseas/social-programs', createSocialProgramsRouter(dataStore, false));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/social-programs/${program.programId}/operating-packages/${pkg.packageId}/sales-handoffs`;
  try {
    assert.equal((await fetch(url)).status, 400);
    const read = await fetch(`${url}?version=1`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { items: [] });
    assert.equal((await fetch(`${url}?version=1`, { headers: { 'x-test-tenant': 'tenant-other' } })).status, 404);
    assert.equal((await fetch(`${url}/not-created?version=1`)).status, 404);
    assert.equal((await dataStore.list('social_weekly_sales_handoffs')).items.length, 0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
