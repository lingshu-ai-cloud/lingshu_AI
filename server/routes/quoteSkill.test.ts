import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createQuoteSkillRouter } from './quoteSkill.js';

function memoryStore(): { dataStore: DataStore; records: Map<string, Record<string, unknown>> } {
  const records = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const dataStore: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(records.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { ...structuredClone(data), id: `record-${++counter}` };
      records.set(`${collection}/${row.id}`, row);
      return structuredClone(row) as T;
    },
    async update(collection, id, data) {
      const key = `${collection}/${id}`;
      const current = records.get(key);
      if (!current) return false;
      records.set(key, { ...current, ...structuredClone(data) });
      return true;
    },
    async delete(collection, id) { return records.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) {
      const where = query.where || {};
      let items = [...records.entries()]
        .filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected))
        .map(([, value]) => structuredClone(value));
      if (query.sort === '-updated_at') items = items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      const perPage = query.perPage || 30;
      items = items.slice(0, perPage);
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage };
    },
  };
  return { dataStore, records };
}

test('报价 API：租户隔离、并发控制、人工确认、安全回复与审计', async () => {
  const { dataStore, records } = memoryStore();
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenantId = String(req.headers['x-test-tenant'] || '');
    if (!tenantId) { res.sendStatus(401); return; }
    res.locals.tenantId = tenantId;
    res.locals.userId = `user-${tenantId}`;
    next();
  };
  app.use('/quotes', createQuoteSkillRouter({
    dataStore,
    authMiddleware: auth,
    canConfirm: async req => req.headers['x-test-confirm'] !== 'deny',
    readEnterpriseProfile: async () => ({ products: { items: [] }, bizRules: {} } as any),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quotes`;
  const call = (path: string, method = 'GET', body?: unknown, tenant = 'A') => fetch(base + path, {
    method,
    headers: { ...(tenant ? { 'x-test-tenant': tenant } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  try {
    assert.equal((await call('/customers/buyer/latest', 'GET', undefined, '')).status, 401);
    assert.equal((await call('/drafts', 'POST', { customerId: 'buyer' })).status, 400);

    const createdResponse = await call('/drafts', 'POST', {
      customerId: 'buyer', customerName: 'Emily', customerLanguage: 'English',
      messages: ['Please quote 500 pcs aluminum brackets in 6061-T6, delivery within 20 days.'],
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).draft;
    assert.equal(created.revision, 1);
    assert.equal(created.version, 1);
    assert.equal(created.productName, 'aluminum brackets');
    assert.equal(created.status, 'needs_clarification');
    const storedCreated = records.get(`quote_skill_drafts/${created.id}`)!;
    const legacyPayload = structuredClone(storedCreated.payload as Record<string, unknown>);
    delete legacyPayload.revision;
    delete legacyPayload.incoterm;
    legacyPayload.pricingExplanation = ['价格待人工填写，Agent 不猜测单价'];
    storedCreated.payload = legacyPayload;
    const normalizedLegacy = (await call('/customers/buyer/latest').then(response => response.json())).draft;
    assert.equal(normalizedLegacy.revision, 1);
    assert.equal(normalizedLegacy.incoterm, '');
    assert.equal((await call(`/drafts/${created.id}/confirm`, 'POST', { expectedRevision: 1 })).status, 409);
    assert.equal((await call(`/drafts/${created.id}`, 'PATCH', { unitPrice: 42.5 })).status, 400);
    assert.equal((await call(`/drafts/${created.id}`, 'PATCH', { expectedRevision: 1, unitPrice: 0 })).status, 400);
    assert.equal((await call(`/drafts/${created.id}`, 'PATCH', { expectedRevision: 1, unitPrice: 42.5 }, 'B')).status, 404);

    const updatedResponse = await call(`/drafts/${created.id}`, 'PATCH', {
      expectedRevision: 1,
      unitPrice: 42.5,
      currency: 'USD',
      destination: 'Los Angeles',
      incoterm: 'FOB',
      paymentTerms: '30% deposit, balance before shipment',
    });
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json()).draft;
    assert.equal(updated.revision, 2);
    assert.equal(updated.status, 'ready_for_review');
    assert.equal(updated.subtotal, 21_250);
    assert.equal((await call(`/drafts/${created.id}`, 'PATCH', { expectedRevision: 1, unitPrice: 41 })).status, 409);
    const deniedConfirmation = await fetch(base + `/drafts/${created.id}/confirm`, {
      method: 'POST', headers: { 'x-test-tenant': 'A', 'x-test-confirm': 'deny', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2 }),
    });
    assert.equal(deniedConfirmation.status, 403);

    const confirmedResponse = await call(`/drafts/${created.id}/confirm`, 'POST', { expectedRevision: 2 });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = (await confirmedResponse.json()).draft;
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.revision, 3);
    assert.equal((await call(`/drafts/${created.id}`, 'PATCH', { expectedRevision: 3, unitPrice: 40 })).status, 409);

    const replyResponse = await call(`/drafts/${created.id}/reply`, 'POST');
    assert.equal(replyResponse.status, 200);
    const reply = await replyResponse.json();
    assert.match(reply.reply, /USD 42\.5/);
    assert.equal(reply.safety.autoSendAllowed, false);
    assert.equal((await call('/customers/buyer/latest', 'GET', undefined, 'B').then(response => response.json())).draft, null);

    const actions = [...records.entries()].filter(([key]) => key.startsWith('quote_skill_events/')).map(([, event]) => event.action);
    assert.deepEqual(actions, ['created', 'updated', 'confirmed', 'reply_generated']);
    const replyEvent = [...records.entries()].find(([, event]) => event.action === 'reply_generated')?.[1];
    assert.equal(typeof (replyEvent?.details as Record<string, unknown>)?.replyLength, 'number');
    assert.equal('reply' in ((replyEvent?.details as Record<string, unknown>) || {}), false);

    const nextVersionResponse = await call('/drafts', 'POST', {
      customerId: 'buyer', customerName: 'Emily', customerLanguage: 'English', productHint: 'aluminum brackets', messages: [],
    });
    assert.equal(nextVersionResponse.status, 201);
    const nextVersion = (await nextVersionResponse.json()).draft;
    assert.equal(nextVersion.version, 2);
    assert.equal(nextVersion.supersedesId, created.id);
    const latest = (await call('/customers/buyer/latest').then(response => response.json())).draft;
    assert.equal(latest.id, nextVersion.id);

    const raceDraft = (await (await call('/drafts', 'POST', {
      customerId: 'race-buyer', productHint: 'custom bracket', messages: ['Please quote 10 pcs in 7075'],
    })).json()).draft;
    const race = await Promise.all([
      call(`/drafts/${raceDraft.id}`, 'PATCH', { expectedRevision: 1, unitPrice: 10 }),
      call(`/drafts/${raceDraft.id}`, 'PATCH', { expectedRevision: 1, unitPrice: 11 }),
    ]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);

    const parallelVersions = await Promise.all([1, 2].map(() => call('/drafts', 'POST', {
      customerId: 'parallel-version-buyer', productHint: 'custom bracket', messages: [],
    }).then(response => response.json())));
    assert.deepEqual(parallelVersions.map(result => result.draft.version).sort(), [1, 2]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('报价 API 将内部异常转换为稳定 JSON 错误', async () => {
  const { dataStore } = memoryStore();
  const app = express();
  app.use(express.json());
  app.use('/quotes', createQuoteSkillRouter({
    dataStore,
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'A'; res.locals.userId = 'user-A'; next(); },
    readEnterpriseProfile: async () => { throw new Error('secret infrastructure detail'); },
    reportError: () => {},
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/quotes/drafts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'buyer', productHint: 'bracket' }),
    });
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(result.error, 'quote_skill_internal_error');
    assert.doesNotMatch(JSON.stringify(result), /secret infrastructure detail/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('报价能力可按租户安全关闭', async () => {
  const { dataStore } = memoryStore();
  const app = express();
  app.use('/quotes', createQuoteSkillRouter({
    dataStore,
    enabled: tenantId => tenantId === 'allowed',
    authMiddleware: (req, res, next) => { res.locals.tenantId = String(req.headers['x-test-tenant'] || 'blocked'); res.locals.userId = 'test'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quotes`;
    assert.deepEqual(await fetch(`${url}/availability`, { headers: { 'x-test-tenant': 'allowed' } }).then(response => response.json()), { enabled: true });
    assert.deepEqual(await fetch(`${url}/availability`, { headers: { 'x-test-tenant': 'blocked' } }).then(response => response.json()), { enabled: false });
    const response = await fetch(`${url}/customers/buyer/latest`, { headers: { 'x-test-tenant': 'blocked' } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'quote_skill_disabled');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
