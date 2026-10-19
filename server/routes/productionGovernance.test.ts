import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createProductionTestStore } from '../production/testStore.js';
import { createOrReuseProductionInputRequest } from '../production/productionInputRequests.js';
import { createOrReuseProductionCostQuote } from '../production/productionCostQuotes.js';
import { createProductionCostQuotesRouter, createProductionInputRequestsRouter } from './productionGovernance.js';

test('production governance HTTP routes are tenant-scoped read projections and reject untrusted writes', async () => {
  const store = createProductionTestStore();
  const scene = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'system-worker', request: {
      kind: 'scene_plate', title: '办公室底板', subjectRef: 'scene:office', bindings: [{ taskId: 'task-1' }],
    },
  });
  const product = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'system-worker', request: {
      kind: 'product_label_artwork', title: '标签稿', productId: 'sku-a', bindings: [{ taskId: 'task-1', shotId: 'shot-2' }],
    },
  });
  const quote = (await createOrReuseProductionCostQuote({
    store, tenantId: 'tenant-a', quote: {
      idempotencyKey: 'route-quote-001', taskId: 'task-1', runId: 'run-1', pricingVersion: 'v1', budgetLimitCny: 1,
      lines: [{ lineKey: 'generation', label: '生成', expectedUnitCostCny: 0.2, upperBoundUnitCostCny: 0.4, pricingSource: 'provider-v1', explanation: '一次生成加重试保护' }],
    },
  })).quote;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const tenantId = String(req.headers['x-test-tenant'] || '');
    if (!tenantId) { res.sendStatus(401); return; }
    Object.assign(res.locals, { tenantId, userId: `user-${tenantId}` });
    next();
  });
  app.use('/inputs', createProductionInputRequestsRouter(store));
  app.use('/product-inputs', createProductionInputRequestsRouter(store, { productOnly: true }));
  app.use('/quotes', createProductionCostQuotesRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, tenant = 'tenant-a') => fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-test-tenant': tenant, ...(init.headers || {}) },
  });
  try {
    const inputs = await (await call('/inputs?taskId=task-1')).json();
    assert.deepEqual(inputs.items.map((item: { id: string }) => item.id).sort(), [product.request.id, scene.request.id].sort());
    const productInputs = await (await call('/product-inputs?taskId=task-1')).json();
    assert.deepEqual(productInputs.items.map((item: { id: string }) => item.id), [product.request.id]);
    assert.equal((await call(`/product-inputs/${scene.request.id}`)).status, 404);
    assert.equal((await call(`/quotes/${quote.id}`)).status, 200);
    assert.equal((await call(`/quotes/${quote.id}`, {}, 'tenant-b')).status, 404);
    assert.equal((await (await call('/inputs', {}, 'tenant-b')).json()).items.length, 0);
    const invalidCategory = await call('/inputs?category=not-a-category');
    assert.equal(invalidCategory.status, 400);
    const writes = [
      ['/inputs', { kind: 'scene_plate' }],
      [`/inputs/${scene.request.id}/fulfill`, { type: 'material', materialId: 'fake' }],
      [`/inputs/${scene.request.id}/waive`, { reason: '跳过' }],
      ['/quotes', { budgetLimitCny: 0 }],
      [`/quotes/${quote.id}/authorize`, { proposedTotalCostCny: 0 }],
      [`/quotes/${quote.id}/reserve`, {}],
      [`/quotes/${quote.id}/settle`, { actualLines: [{ lineKey: 'generation', actualCostCny: 0 }] }],
      [`/quotes/${quote.id}/fail`, { actualCostCny: 0, reason: '伪造' }],
    ] as const;
    for (const [path, body] of writes) {
      const response = await call(path, { method: 'POST', body: JSON.stringify(body) });
      assert.equal(response.status, 403, `${path} must reject browser-authenticated mutation`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
