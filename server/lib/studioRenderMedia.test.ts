import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { studioRenderMediaRouter } from './studioRenderMedia.js';

test('local exports support range/HEAD, isolate tenants, and reject traversal/symlinks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-render-media-'));
  fs.mkdirSync(path.join(root, 'tenant_a'));
  fs.mkdirSync(path.join(root, 'tenant_b'));
  fs.writeFileSync(path.join(root, 'tenant_a', 'sample.mp4'), '0123456789');
  fs.symlinkSync(path.join(root, 'tenant_a', 'sample.mp4'), path.join(root, 'tenant_b', 'linked.mp4'));
  const app = express();
  app.use((req, res, next) => { res.locals.tenantId = req.headers['x-test-tenant'] || ''; next(); });
  app.use('/media', studioRenderMediaRouter(root));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/media/`;
  const get = (file: string, tenant = 'tenant_a', options: RequestInit = {}) => fetch(base + file, { ...options, headers: { 'x-test-tenant': tenant, ...options.headers } });
  try {
    const partial = await get('sample.mp4', 'tenant_a', { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await partial.text(), '2345');
    assert.equal((await get('sample.mp4', 'tenant_a', { method: 'HEAD' })).headers.get('content-length'), '10');
    assert.equal((await get('sample.mp4', 'tenant_b')).status, 404);
    assert.equal((await get('linked.mp4', 'tenant_b')).status, 404);
    assert.equal((await get('missing.mp4')).status, 404);
    assert.equal((await get('sample.mp4', '')).status, 404);
    assert.equal((await get('..%2Ftenant_a%2Fsample.mp4', 'tenant_b')).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
