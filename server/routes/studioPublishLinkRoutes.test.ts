import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { loadStudioPublishLinks, registerStudioPublishLinkRoutes } from './studioPublishLinkRoutes.js';

test('publish links remain tenant-scoped and require a terminal published receipt', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'studio-publish-links-'));
  const file = path.join(temporary, 'links.json');
  writeFileSync(file, JSON.stringify([
    { id: 'a', tenantId: 'tenant-a', projectId: 'project-a', metrics: { views: 100, likes: 10, comments: 5, shares: 5, leads: 2 } },
    { id: 'b', tenantId: 'tenant-b', projectId: 'project-b', metrics: { views: 500, likes: 50 } },
  ]));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = req.get('x-tenant') || ''; next(); });
  registerStudioPublishLinkRoutes(app, file);
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
    return { status: response.status, body: await response.json() as any };
  };
  try {
    assert.deepEqual(loadStudioPublishLinks('tenant-a', file).map(item => item.id), ['a']);
    assert.deepEqual((await request('tenant-a', '/publish-links')).body.map((item: { id: string }) => item.id), ['a']);
    assert.equal((await request('tenant-b', '/publish-links/a/metrics', 'PATCH', { views: 999 })).status, 404);
    const performance = (await request('tenant-a', '/publish-performance')).body;
    assert.equal(performance.length, 1);
    assert.equal(performance[0].views, 100);
    assert.equal(performance[0].engagementRate, 20);
    assert.equal((await request('tenant-a', '/publish-links', 'POST', { projectId: 'project-a', publishResult: { ok: true, deliveryStatus: 'queued' } })).status, 409);
    const updated = await request('tenant-a', '/publish-links/a/metrics', 'PATCH', { views: 200, likes: 20 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.link.metrics.views, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
