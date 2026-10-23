import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { registerStudioVariationBatchRoutes } from './studioVariationBatchRoutes.js';

test('variation batches persist tenant-scoped state and retry only failed items', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'studio-variation-'));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = req.get('x-tenant') || ''; next(); });
  registerStudioVariationBatchRoutes(app, path.join(temporary, 'batches.json'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = async (tenantId: string, endpoint: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${endpoint}`, {
      method,
      headers: { 'x-tenant': tenantId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  try {
    const created = await request('tenant-a', '/variation-batches', 'POST', {
      title: 'Four variants', duration: 20,
      dimensions: { product: ['one', 'two'], language: ['en', 'es'] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.batch.items.length, 4);
    assert.equal(created.body.batch.estimatedCostCny, 120);
    const batchId = created.body.batch.id as string;
    assert.deepEqual((await request('tenant-b', '/variation-batches')).body, []);
    assert.equal((await request('tenant-b', `/variation-batches/${batchId}`, 'PATCH', { status: 'paused' })).status, 404);
    const claimed = await request('tenant-a', `/variation-batches/${batchId}/claim-next`, 'POST');
    assert.equal(claimed.body.item.status, 'running');
    const itemId = claimed.body.item.id as string;
    const failed = await request('tenant-a', `/variation-batches/${batchId}/items/${itemId}`, 'PATCH', { status: 'failed' });
    assert.equal(failed.body.item.status, 'failed');
    const retried = await request('tenant-a', `/variation-batches/${batchId}/retry-failed`, 'POST');
    assert.equal(retried.body.retried, 1);
    assert.equal(retried.body.batch.items.find((item: { id: string }) => item.id === itemId).status, 'pending');
    assert.equal((await request('tenant-a', '/variation-batches')).body.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
