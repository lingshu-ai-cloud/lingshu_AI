import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialProgramService } from '../socialPrograms/service.js';
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

test('social program routes expose the weekly operating package lifecycle', async t => {
  const dataStore = memoryStore();
  const service = createSocialProgramService(dataStore);
  const program = await service.createProgram('tenant-a', 'owner', {
    brandName: 'Route Factory', market: '北美', targetAudience: '品牌采购',
    candidatePlatforms: ['tiktok', 'facebook', 'instagram', 'youtube'], route: 'cold_start',
  });
  for (const [platform, count] of [['tiktok', 2], ['facebook', 2], ['instagram', 1], ['youtube', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      await service.createAccount('tenant-a', 'owner', program.programId, {
        platform, displayName: `${platform}-${index}`, businessRole: index ? '协同账号' : '核心账号',
        audiencePromise: '服务目标采购', contentPromise: '可验证内容',
      });
    }
  }

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.tenantId = 'tenant-a';
    res.locals.userId = 'owner';
    next();
  });
  app.use('/api/overseas/social-programs', createSocialProgramsRouter(dataStore, false));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/social-programs/${program.programId}`;

  const emptyConstraints = await fetch(`${base}/operating-constraints`);
  assert.equal(emptyConstraints.status, 200);
  assert.equal((await emptyConstraints.json()).item, null);
  const savedConstraints = await fetch(`${base}/operating-constraints`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      expectedVersion: 0, weeklyBudgetCny: 1000, costPerOriginalCny: 50, costPerAdaptationCny: 20,
      materialUnitsPerOriginal: 1, productionItemsPerDay: 5, interactionItemsPerWeek: 100,
      salesLeadsPerWeek: 20, expectedInteractionsPerPublication: 5, expectedLeadsPerPublication: 1,
      accountWeeklyPublicationCapacity: {}, ready: true, policy: { automaticExecutionAllowed: true },
    }),
  });
  assert.equal(savedConstraints.status, 201);
  const resolvedResponse = await fetch(`${base}/operating-plan/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: '2026-10-05', ready: true, capacityPlan: { publicationQuota: 999 }, automationPolicy: { automaticExecutionAllowed: true } }),
  });
  assert.equal(resolvedResponse.status, 201);
  const resolved = await resolvedResponse.json();
  assert.equal(resolved.item.snapshot.status, 'blocked', 'missing server authorities must fail closed despite forged client readiness');
  assert.deepEqual(Object.keys(resolved.weeklyAuthority), ['operatingDecisionSnapshotRef']);

  const createdResponse = await fetch(`${base}/operating-packages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: '2026-10-05', objective: '路由闭环', successCriteria: ['接口可用'] }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).item;
  assert.equal(created.socialContentPackage.publicationTaskTarget, 26);

  const listResponse = await fetch(`${base}/operating-packages?weekStart=2026-10-05`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).items.length, 1);

  const activatedResponse = await fetch(`${base}/operating-packages/${created.packageId}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, expectedProgramVersion: 1, authorizePublishing: true }),
  });
  assert.equal(activatedResponse.status, 409);
  assert.equal((await activatedResponse.json()).error, 'weekly_operating_package_activation_blocked');

  const retiredResponse = await fetch(`${base}/operating-packages/${created.packageId}/retire`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, expectedProgramVersion: 1 }),
  });
  assert.equal(retiredResponse.status, 200);
  const retired = (await retiredResponse.json()).item;
  assert.equal(retired.status, 'retired');
  assert.equal(retired.socialContentPackage.authorization.allowRealPublishing, false);
});
