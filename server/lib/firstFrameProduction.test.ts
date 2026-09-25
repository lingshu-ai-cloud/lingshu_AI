import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstFrameBudget } from './firstFrameBudget.js';
import { firstFrameInputFingerprint, FirstFrameProviderError, type FirstFrameGenerator, type FirstFrameRequest } from './firstFrameGenerator.js';
import { produceFirstFrame } from './firstFrameProduction.js';

function input(): FirstFrameRequest {
  const one = Buffer.from('one'); const two = Buffer.from('two');
  const value: FirstFrameRequest = { tenantId: 'tenant', videoId: 'video', compositionId: 'front', presenterVersion: 'v1', prompt: 'replace', ratio: '9:16', idempotencyKey: '', references: [
    { role: 'source_composition', bytes: one, mimeType: 'image/jpeg', sha256: createHash('sha256').update(one).digest('hex') },
    { role: 'authorized_presenter', bytes: two, mimeType: 'image/jpeg', sha256: createHash('sha256').update(two).digest('hex') },
  ] };
  value.idempotencyKey = firstFrameInputFingerprint(value, 'seedream', 'model'); return value;
}

test('completed first frame is persisted and idempotent replay returns the receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'first-frame-production-')); let calls = 0; let stored = Buffer.alloc(0);
  try {
    const budget = new FirstFrameBudget(root, () => 2, () => 3);
    const generator: FirstFrameGenerator = { provider: 'seedream', model: 'model', estimatedCostCny: 0.22, async generate() { calls += 1; return { bytes: Buffer.from('result'), mimeType: 'image/jpeg', provider: 'seedream', model: 'model', providerRequestId: 'request-1', estimatedCostCny: 0.22 }; } };
    const dependencies = { budget, upload: async ({ body }: any) => { stored = body; return '/stored'; }, head: async () => ({ size: stored.length, contentType: 'image/jpeg' }) };
    const first = await produceFirstFrame(input(), generator, dependencies); const replay = await produceFirstFrame(input(), generator, dependencies);
    assert.deepEqual(replay, first); assert.equal(calls, 1); assert.match(first.objectKey, /^first-frames\/tenants\/tenant\/video\//);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('uncertain supplier state remains reserved and cannot be automatically resubmitted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'first-frame-production-')); let calls = 0;
  try {
    const budget = new FirstFrameBudget(root, () => 2, () => 3); const generator: FirstFrameGenerator = { provider: 'seedream', model: 'model', estimatedCostCny: 0.22, async generate() { calls += 1; throw new FirstFrameProviderError('timeout', 'uncertain'); } };
    await assert.rejects(() => produceFirstFrame(input(), generator, { budget }), /timeout/);
    await assert.rejects(() => produceFirstFrame(input(), generator, { budget }), /禁止自动重提/); assert.equal(calls, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
