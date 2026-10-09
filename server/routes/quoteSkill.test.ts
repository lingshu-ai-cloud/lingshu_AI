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

test('切换目录产品不能沿用旧产品交期，客户目标日期不能替代企业履约依据', async () => {
  const { dataStore } = memoryStore();
  const app = express();
  app.use(express.json());
  app.use('/quotes', createQuoteSkillRouter({
    dataStore,
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'A'; res.locals.userId = 'user-A'; next(); },
    canConfirm: async () => true,
    readEnterpriseProfile: async () => ({
      products: { items: [
        { sku: 'OLD-01', name: 'Old housing', material: 'ABS', attributes: { unit: 'pcs', unitPrice: 3.8, currency: 'USD', leadTime: '30 days' } },
        { sku: 'NEW-01', name: 'New housing', material: 'ABS', attributes: { unit: 'pcs', unitPrice: 5, currency: 'USD' } },
      ] },
      bizRules: { paymentTerms: '30% deposit' },
    } as any),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quotes`;
  const call = (path: string, method: string, body: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const targetDate of ['', ' Delivery within 20 days.']) {
      const createdResponse = await call('/drafts', 'POST', {
        customerId: `buyer-${targetDate ? 'date' : 'no-date'}`,
        messages: [`Quote 1500 pcs of SKU OLD-01 in ABS. Destination Germany. DAP.${targetDate}`],
      });
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()).draft;
      assert.equal(created.leadTime, '30 days');
      assert.equal(created.status, 'ready_for_review');
      const patchedResponse = await call(`/drafts/${created.id}`, 'PATCH', {
        expectedRevision: 1, catalogProductRef: 'NEW-01', leadTime: '30 days',
      });
      assert.equal(patchedResponse.status, 200);
      const patched = (await patchedResponse.json()).draft;
      assert.equal(patched.unitPrice, 5);
      assert.equal(patched.leadTime, '');
      assert.equal(patched.status, 'needs_clarification');
      assert.ok(targetDate ? patched.blockers.some((item: string) => item.includes('目标交期')) : patched.missingFields.includes('交期'));
      assert.equal((await call(`/drafts/${created.id}/confirm`, 'POST', { expectedRevision: 2 })).status, 409);
      const reviewedResponse = await call(`/drafts/${created.id}`, 'PATCH', {
        expectedRevision: 2, catalogProductRef: 'NEW-01', leadTime: '45 days',
      });
      assert.equal(reviewedResponse.status, 200);
      const reviewed = (await reviewedResponse.json()).draft;
      assert.equal(reviewed.leadTime, '45 days', '同一产品经人工重新核实的履约信息允许保存');
      assert.equal(reviewed.status, 'ready_for_review');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('报价 API：租户隔离、并发控制、人工确认、安全回复与审计', async () => {
  const { dataStore, records } = memoryStore();
  const sentImages: Array<{ to: string; caption: string; bytes: Buffer }> = [];
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
    readEnterpriseProfile: async () => ({
      products: { items: [
        { sku: 'IMH-ABS-01', name: 'Injection molded electronics housing', material: 'ABS', moq: '1000', attributes: { unit: 'pcs', unitPrice: 3.8, currency: 'USD', leadTime: '30 days' } },
        { sku: 'COVER-NP-01', name: 'Unpriced custom cover', material: 'ABS', moq: '25', attributes: { unit: 'pcs', currency: 'USD', leadTime: '20 days' } },
      ] },
      bizRules: {},
    } as any),
    renderCard: async () => Buffer.from('png-card'),
    messagingReady: async () => true,
    findCustomer: (_tenantId, customerId) => ({ id: customerId, waNumber: '15550001111', whatsappProfileName: 'Emily WA', timeline: [{ actor: 'buyer', timestamp: Date.now() }] }),
    sendImage: async input => {
      sentImages.push({ to: input.to, caption: input.caption, bytes: input.bytes });
      return { messageId: 'wamid.quote-1', recipientId: input.to, raw: {} };
    },
    recordOutbound: () => ({} as any),
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
    const catalogResponse = await call('/catalog');
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()).items;
    assert.equal(catalog.length, 2);
    assert.deepEqual({ name: catalog[0].name, sku: catalog[0].sku, unitPrice: catalog[0].unitPrice, currency: catalog[0].currency }, { name: 'Injection molded electronics housing', sku: 'IMH-ABS-01', unitPrice: 3.8, currency: 'USD' });
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
    assert.equal(created.customerName, 'Emily WA');
    assert.equal(created.customerNameSource, 'whatsapp_profile');
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
      leadTime: '20 days',
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
    const cardResponse = await call(`/drafts/${created.id}/card`);
    assert.equal(cardResponse.status, 200);
    assert.equal(cardResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await cardResponse.arrayBuffer()), Buffer.from('png-card'));
    const sentResponse = await call(`/drafts/${created.id}/send-card`, 'POST');
    assert.equal(sentResponse.status, 200);
    const sent = await sentResponse.json();
    assert.equal(sent.status, 'sent');
    assert.equal(sent.providerMessageId, 'wamid.quote-1');
    assert.equal(sentImages.length, 1);
    assert.equal(sentImages[0].to, '15550001111');
    assert.match(sentImages[0].caption, /QT-\d{8}-[A-F0-9]{6} · V1/);
    assert.equal((await call(`/drafts/${created.id}/send-card`, 'POST')).status, 409);
    assert.equal((await call('/customers/buyer/latest', 'GET', undefined, 'B').then(response => response.json())).draft, null);

    const actions = [...records.entries()].filter(([key]) => key.startsWith('quote_skill_events/')).map(([, event]) => event.action);
    assert.deepEqual(actions, ['created', 'updated', 'confirmed', 'reply_generated', 'card_sent']);
    const replyEvent = [...records.entries()].find(([, event]) => event.action === 'reply_generated')?.[1];
    assert.equal(typeof (replyEvent?.details as Record<string, unknown>)?.replyLength, 'number');
    assert.equal('reply' in ((replyEvent?.details as Record<string, unknown>) || {}), false);

    const catalogDraft = (await (await call('/drafts', 'POST', {
      customerId: 'catalog-buyer', productHint: 'custom housing', messages: ['Please quote 1000 pcs in ABS, delivery to Berlin, DAP, within 30 days.'],
    })).json()).draft;
    const catalogSelectedResponse = await call(`/drafts/${catalogDraft.id}`, 'PATCH', {
      expectedRevision: 1,
      catalogProductRef: 'IMH-ABS-01',
      paymentTerms: '100% in advance',
    });
    assert.equal(catalogSelectedResponse.status, 200);
    const catalogSelected = (await catalogSelectedResponse.json()).draft;
    assert.equal(catalogSelected.sku, 'IMH-ABS-01');
    assert.equal(catalogSelected.unitPrice, 3.8);
    assert.equal(catalogSelected.unitPriceSource, 'product_catalog');
    assert.equal(catalogSelected.matchedProduct.priceSource, '企业产品目录 unitPrice');
    assert.match(catalogSelected.pricingExplanation.join('\n'), /价格来源：企业产品目录 unitPrice/);

    const confirmedCatalogResponse = await call(`/drafts/${catalogDraft.id}/confirm`, 'POST', { expectedRevision: 2 });
    assert.equal(confirmedCatalogResponse.status, 200);
    const confirmedCatalog = (await confirmedCatalogResponse.json()).draft;
    const clonedCatalogResponse = await call('/drafts', 'POST', {
      customerId: 'catalog-buyer', productHint: 'custom housing', messages: [], clonePrevious: true,
    });
    assert.equal(clonedCatalogResponse.status, 201);
    const clonedCatalog = (await clonedCatalogResponse.json()).draft;
    assert.equal(clonedCatalog.supersedesId, confirmedCatalog.id);
    assert.equal(clonedCatalog.matchedProduct.sku, 'IMH-ABS-01');
    assert.equal(clonedCatalog.matchedProduct.moq, 1000);
    assert.equal(clonedCatalog.unitPrice, 3.8);
    assert.equal(clonedCatalog.unitPriceSource, 'product_catalog');
    assert.match(clonedCatalog.pricingExplanation.join('\n'), /价格来源：企业产品目录 unitPrice/);
    assert.ok(clonedCatalog.evidence.some((item: { field: string; source: string }) => item.field === 'productName' && item.source === 'product_catalog'));

    const negotiatedDraft = (await (await call('/drafts', 'POST', {
      customerId: 'negotiated-catalog-buyer', productHint: 'custom housing',
      messages: ['Please quote 1000 pcs in ABS, delivery to Hamburg, DAP, within 30 days.'],
    })).json()).draft;
    const negotiatedResponse = await call(`/drafts/${negotiatedDraft.id}`, 'PATCH', {
      expectedRevision: 1,
      catalogProductRef: 'IMH-ABS-01',
      catalogPriceMode: 'manual',
      unitPrice: 3.35,
      currency: 'USD',
      paymentTerms: '30% deposit, balance before shipment',
    });
    assert.equal(negotiatedResponse.status, 200);
    const negotiated = (await negotiatedResponse.json()).draft;
    assert.equal(negotiated.unitPrice, 3.35, '议价后的人工单价不得被目录价 3.8 覆盖');
    assert.equal(negotiated.unitPriceSource, 'human');
    assert.equal(negotiated.matchedProduct.sku, 'IMH-ABS-01');
    assert.equal(negotiated.matchedProduct.moq, 1000);
    assert.match(negotiated.pricingExplanation.join('\n'), /价格来源：人工填写/);

    const manualCatalogDraft = (await (await call('/drafts', 'POST', {
      customerId: 'manual-catalog-buyer', productHint: 'legacy cover',
      messages: ['Please quote 50 pcs in ABS, delivery to Berlin, DAP, within 20 days.'],
    })).json()).draft;
    assert.equal((await call(`/drafts/${manualCatalogDraft.id}`, 'PATCH', {
      expectedRevision: 1,
      catalogProductRef: 'COVER-NP-01',
      catalogPriceMode: 'unsupported',
      unitPrice: 9.5,
      currency: 'EUR',
    })).status, 400);
    const manualCatalogResponse = await call(`/drafts/${manualCatalogDraft.id}`, 'PATCH', {
      expectedRevision: 1,
      catalogProductRef: 'COVER-NP-01',
      catalogPriceMode: 'manual',
      unitPrice: 9.5,
      currency: 'EUR',
      paymentTerms: '50% deposit, balance before shipment',
    });
    assert.equal(manualCatalogResponse.status, 200);
    const manualCatalog = (await manualCatalogResponse.json()).draft;
    assert.equal(manualCatalog.unitPrice, 9.5);
    assert.equal(manualCatalog.currency, 'EUR');
    assert.equal(manualCatalog.unitPriceSource, 'human');
    assert.equal(manualCatalog.matchedProduct.sku, 'COVER-NP-01');
    assert.equal(manualCatalog.matchedProduct.unitPrice, null);
    assert.equal(manualCatalog.matchedProduct.moq, 25);
    assert.match(manualCatalog.pricingExplanation.join('\n'), /价格来源：人工填写/);
    const reloadedManualCatalog = (await call('/customers/manual-catalog-buyer/latest').then(response => response.json())).draft;
    assert.equal(reloadedManualCatalog.unitPriceSource, 'human');
    assert.match(reloadedManualCatalog.pricingExplanation.join('\n'), /价格来源：人工填写/);
    const confirmedManualCatalogResponse = await call(`/drafts/${manualCatalogDraft.id}/confirm`, 'POST', { expectedRevision: 2 });
    assert.equal(confirmedManualCatalogResponse.status, 200);
    const confirmedManualCatalog = (await confirmedManualCatalogResponse.json()).draft;
    const clonedManualCatalog = (await (await call('/drafts', 'POST', {
      customerId: 'manual-catalog-buyer', productHint: 'legacy cover', messages: [], clonePrevious: true,
    })).json()).draft;
    assert.equal(clonedManualCatalog.supersedesId, confirmedManualCatalog.id);
    assert.equal(clonedManualCatalog.matchedProduct.sku, 'COVER-NP-01');
    assert.equal(clonedManualCatalog.matchedProduct.moq, 25);
    assert.equal(clonedManualCatalog.unitPrice, 9.5);
    assert.equal(clonedManualCatalog.unitPriceSource, 'human');
    assert.match(clonedManualCatalog.pricingExplanation.join('\n'), /价格来源：人工填写/);
    assert.ok(clonedManualCatalog.evidence.some((item: { field: string; source: string }) => item.field === 'productName' && item.source === 'human'));

    const nextVersionResponse = await call('/drafts', 'POST', {
      customerId: 'buyer', customerName: 'Emily', customerLanguage: 'English', productHint: 'aluminum brackets', messages: [], clonePrevious: true,
    });
    assert.equal(nextVersionResponse.status, 201);
    const nextVersion = (await nextVersionResponse.json()).draft;
    assert.equal(nextVersion.version, 2);
    assert.equal(nextVersion.supersedesId, created.id);
    assert.equal(nextVersion.unitPrice, 42.5);
    assert.equal(nextVersion.currency, 'USD');
    assert.equal(nextVersion.status, 'ready_for_review');
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

test('报价卡发送先持久化 claim，并在结果未知或回写失败后阻断重复发送', async () => {
  const base = memoryStore();
  let failSendingWrite = false;
  let failSentWrite = false;
  let sendBehavior: 'success' | 'unknown' = 'success';
  let sendAttempts = 0;
  const dataStore: DataStore = {
    ...base.dataStore,
    async update(collection, id, data) {
      const payload = data.payload && typeof data.payload === 'object'
        ? data.payload as Record<string, unknown>
        : {};
      const delivery = payload.delivery && typeof payload.delivery === 'object'
        ? payload.delivery as Record<string, unknown>
        : {};
      if (failSendingWrite && delivery.status === 'sending') {
        failSendingWrite = false;
        return false;
      }
      if (failSentWrite && delivery.status === 'sent') {
        failSentWrite = false;
        return false;
      }
      return base.dataStore.update(collection, id, data);
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/quotes', createQuoteSkillRouter({
    dataStore,
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'A'; res.locals.userId = 'user-A'; next(); },
    canConfirm: async () => true,
    readEnterpriseProfile: async () => ({
      products: { items: [{ sku: 'WIDGET-01', name: 'Widget', material: 'ABS', moq: '10', attributes: { unit: 'pcs', unitPrice: 10, currency: 'USD', leadTime: '20 days' } }] },
      bizRules: { paymentTerms: '100% before shipment' },
    } as any),
    renderCard: async () => Buffer.from('png-card'),
    messagingReady: async () => true,
    findCustomer: (_tenantId, customerId) => ({ id: customerId, waNumber: `1555${customerId}`, whatsappProfileName: 'Verified Buyer', timeline: [{ actor: 'buyer', timestamp: Date.now() }] }),
    sendImage: async input => {
      sendAttempts += 1;
      if (sendBehavior === 'unknown') throw new Error('simulated_provider_timeout');
      return { messageId: `wamid.${sendAttempts}`, recipientId: input.to, raw: {} };
    },
    recordOutbound: () => ({} as any),
    reportError: () => {},
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/quotes`;
  const call = (path: string, method = 'GET', body?: unknown) => fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const createConfirmed = async (customerId: string) => {
    const createdResponse = await call('/drafts', 'POST', {
      customerId,
      productHint: 'Widget',
      customerLanguage: 'English',
      messages: ['Please quote 100 pcs Widget in ABS, delivery to Berlin, DAP, within 20 days.'],
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).draft;
    assert.equal(created.status, 'ready_for_review');
    const confirmedResponse = await call(`/drafts/${created.id}/confirm`, 'POST', { expectedRevision: 1 });
    assert.equal(confirmedResponse.status, 200);
    return (await confirmedResponse.json()).draft;
  };

  try {
    const writebackFailureDraft = await createConfirmed('writeback-failure');
    failSentWrite = true;
    const failedWritebackResponse = await call(`/drafts/${writebackFailureDraft.id}/send-card`, 'POST');
    assert.equal(failedWritebackResponse.status, 503);
    assert.equal((await failedWritebackResponse.json()).error, 'quote_send_state_persist_failed');
    assert.equal(sendAttempts, 1);
    const claimed = (await call('/customers/writeback-failure/latest').then(response => response.json())).draft;
    assert.equal(claimed.delivery.status, 'sending');
    assert.equal(typeof claimed.delivery.attemptId, 'string');
    const blockedWritebackRetry = await call(`/drafts/${writebackFailureDraft.id}/send-card`, 'POST');
    assert.equal(blockedWritebackRetry.status, 409);
    assert.equal((await blockedWritebackRetry.json()).error, 'quote_send_in_progress');
    assert.equal(sendAttempts, 1, '发送后回写失败不得再次调用 WhatsApp');

    const unknownOutcomeDraft = await createConfirmed('unknown-outcome');
    sendBehavior = 'unknown';
    const unknownResponse = await call(`/drafts/${unknownOutcomeDraft.id}/send-card`, 'POST');
    assert.equal(unknownResponse.status, 502);
    assert.equal((await unknownResponse.json()).error, 'quote_send_outcome_unknown');
    assert.equal(sendAttempts, 2);
    const unknown = (await call('/customers/unknown-outcome/latest').then(response => response.json())).draft;
    assert.equal(unknown.delivery.status, 'outcome_unknown');
    const blockedUnknownRetry = await call(`/drafts/${unknownOutcomeDraft.id}/send-card`, 'POST');
    assert.equal(blockedUnknownRetry.status, 409);
    assert.equal((await blockedUnknownRetry.json()).error, 'quote_send_outcome_unknown');
    assert.equal(sendAttempts, 2, '结果未知时不得自动重发');

    const claimFailureDraft = await createConfirmed('claim-failure');
    sendBehavior = 'success';
    failSendingWrite = true;
    const claimFailureResponse = await call(`/drafts/${claimFailureDraft.id}/send-card`, 'POST');
    assert.equal(claimFailureResponse.status, 503);
    assert.equal((await claimFailureResponse.json()).error, 'quote_send_claim_failed');
    assert.equal(sendAttempts, 2, 'claim 未落盘时不得调用 WhatsApp');
    const unclaimed = (await call('/customers/claim-failure/latest').then(response => response.json())).draft;
    assert.equal(unclaimed.delivery, undefined);
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
