import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-render-batch-quota-'));
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
process.env.DEMO_DAILY_RENDER_LIMIT = '6';
process.env.DEMO_USAGE_FILE = path.join(root, 'usage.json');

const { reserveDemoRenderBatchQuota, rollbackDemoRenderBatchQuota } = await import('./demo.js');
const token = `local-demo.${Buffer.from(JSON.stringify({ userId: 'user-quota', tenantId: 'tenant-quota' }), 'utf8').toString('base64url')}`;
const request = { headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1', body: {} } as unknown as Request;
function responseCapture() {
  const capture = { statusCode: 200, body: undefined as unknown };
  const response = {
    status(code: number) { capture.statusCode = code; return this; },
    json(body: unknown) { capture.body = body; return this; },
  } as unknown as Response;
  return { response, capture };
}

try {
  let target = responseCapture();
  assert.deepEqual(await reserveDemoRenderBatchQuota(request, target.response, 'batch-key-1', 3), { ok: true, reused: false, charged: 3 });
  target = responseCapture();
  assert.deepEqual(await reserveDemoRenderBatchQuota(request, target.response, 'batch-key-1', 3), { ok: true, reused: true, charged: 0 });
  target = responseCapture();
  assert.deepEqual(await reserveDemoRenderBatchQuota(request, target.response, 'batch-key-2', 3), { ok: true, reused: false, charged: 3 });
  target = responseCapture();
  assert.equal((await reserveDemoRenderBatchQuota(request, target.response, 'batch-key-3', 3)).ok, false);
  assert.equal(target.capture.statusCode, 429);

  await rollbackDemoRenderBatchQuota(request, 'batch-key-2', 3);
  target = responseCapture();
  assert.deepEqual(await reserveDemoRenderBatchQuota(request, target.response, 'batch-key-3', 3), { ok: true, reused: false, charged: 3 });
  const usage = JSON.parse(fs.readFileSync(process.env.DEMO_USAGE_FILE!, 'utf8')) as Record<string, Record<string, { render: number }>>;
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(usage['tenant:tenant-quota']?.[day]?.render, 6, 'two exactly-three batches consume six renders without partial increments');
  console.log('demo render batch quota tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
