import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createLinkedInCompanyReceiptStore } from './linkedinCompanyReceiptStore.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const scope = { tenantId: 'tenant-a', runId: 'run-a', companyUrl: 'https://www.linkedin.com/company/factory/', limit: 3, dateFrom: '', dateTo: '' };
const binding = { scope, approvalRecordHash: hash('approval'), actorId: 'actor-a', actorInputSha256: hash('input'), operationId: 'operation-a', tokenFingerprint: hash('token') };
const response = { phase: 'actor_submit' as const, actorId: binding.actorId, operationId: binding.operationId,
  requestHash: hash('request'), httpStatus: 200, responseBody: '{"data":{"id":"run-a"}}' };

test('LinkedIn raw receipt is fsynced, write-once and identity-bound', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-receipt-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createLinkedInCompanyReceiptStore({ root, ...binding });
  const ref = await store.persistRawReceipt(response);
  assert.deepEqual(store.read(ref), response);
  assert.equal(await store.persistRawReceipt(response), ref);
  await assert.rejects(store.persistRawReceipt({ ...response, responseBody: 'changed' }), /receipt_conflict/);
  const otherTenant = createLinkedInCompanyReceiptStore({ root, ...binding, scope: { ...scope, tenantId: 'tenant-b' } });
  assert.throws(() => otherTenant.read(ref), /receipt_ref_invalid/);
  const receiptFile = fs.readdirSync(path.join(root, '.linkedin-company-receipts')).find(name => name.endsWith('.json'));
  assert.ok(receiptFile);
  fs.writeFileSync(path.join(root, '.linkedin-company-receipts', receiptFile), '{"tampered":true}');
  assert.throws(() => store.read(ref), /receipt_corrupt/);
});

test('LinkedIn raw receipt rejects missing shared root, changed operation and unbounded response', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-receipt-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => createLinkedInCompanyReceiptStore({ root: path.join(root, 'missing'), ...binding }), /shared_root_unavailable/);
  const store = createLinkedInCompanyReceiptStore({ root, ...binding });
  await assert.rejects(store.persistRawReceipt({ ...response, operationId: 'other' }), /receipt_invalid/);
  await assert.rejects(store.persistRawReceipt({ ...response, responseBody: 'x'.repeat(8 * 1024 * 1024 + 1) }), /receipt_invalid/);
  await assert.rejects(store.persistRawReceipt({ ...response, phase: 'dataset_read' }), /receipt_invalid/);
});
