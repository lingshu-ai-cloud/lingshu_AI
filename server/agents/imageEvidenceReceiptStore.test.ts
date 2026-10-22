import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createImageEvidenceReceiptStore } from './imageEvidenceReceiptStore.js';

test('raw provider response is immutable, scope-bound and readable after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-evidence-receipt-'));
  const scope = { tenantId: 'tenant-1', taskId: 'image-evidence:record-1', runId: 'a'.repeat(64), planHash: 'b'.repeat(64) };
  const identity = { root, scope, operationId: 'review-1', requestSha256: 'c'.repeat(64) };
  const response = { status: 200, body: '{"choices":[]}' };
  try {
    const first = createImageEvidenceReceiptStore(identity);
    const ref = await first.persist({ requestSha256: identity.requestSha256, response });
    assert.deepEqual(createImageEvidenceReceiptStore(identity).read(ref), response);
    assert.equal(await first.persist({ requestSha256: identity.requestSha256, response }), ref);
    await assert.rejects(first.persist({ requestSha256: identity.requestSha256, response: { status: 200, body: 'different' } }), /receipt_conflict/);
    assert.throws(() => createImageEvidenceReceiptStore({ ...identity, scope: { ...scope, tenantId: 'tenant-2' } }).read(ref), /receipt_ref_invalid/);
    const file = fs.readdirSync(root).find(name => name.endsWith('.json'))!;
    fs.writeFileSync(path.join(root, file), '{"forged":true}');
    assert.throws(() => first.read(ref), /receipt_corrupt/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
