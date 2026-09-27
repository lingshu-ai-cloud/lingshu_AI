import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createCreativeUploadService } from './creativeUpload.js';
import { AdProviderError } from './metaAdapter.js';
const bytes = new Uint8Array([1, 2, 3]);
function setup(options: { networkFailure?: boolean; receiptFailure?: boolean; dropReceipt?: boolean } = {}) {
  let uploads = 0, reads = 0, updates = 0, opens = 0;
  let creative: any = { id: 'c', tenant_id: 't', taskId: 'task', taskVersion: 1, provider: 'meta', connectionId: 'conn', size: 3, mimeType: 'video/mp4', sha256: createHash('sha256').update(bytes).digest('hex'), uploadReceipt: {}, status: 'pending' };
  const deps: any = {
    withPlatformAdTaskLock: async (_t: string, _id: string, fn: any) => fn({ beforeEffect: async () => {} }),
    getPlatformAdTask: async () => ({ version: 1, managementMode: 'manual', status: 'draft', currency: 'USD', channels: ['Facebook'] }),
    getPlatformAdCreative: async () => creative,
    getConnectionCredential: async () => ({ connection: { accountId: '123', currency: 'USD', provider: 'meta', status: 'connected' }, accessToken: 'token' }),
    openPlatformAdCreativeMedia: async () => { opens++; return { creative, body: (async function* () { yield bytes; })() }; },
    store: { list: async () => ({ items: [] }), update: async (_collection: string, _id: string, patch: any) => { updates++; if (options.receiptFailure && updates === 2) return null; creative = { ...creative, ...patch }; if (options.dropReceipt) creative.uploadReceipt = {}; return creative; } },
    adapter: () => ({ upload: async () => { uploads++; if (options.networkFailure) throw new AdProviderError('unknown', 'NETWORK_ERROR', true); return '999'; }, status: async () => { reads++; return 'ready'; } }),
  };
  return { service: createCreativeUploadService(deps), counters: () => ({ uploads, reads, opens }), creative: () => creative };
}
const input = { requestId: 'request_001', expectedVersion: 1 };
test('upload is durable, idempotent and ready only after readback', async () => {
  const s = setup();
  assert.equal((await s.service.upload('t', 'task', 'c', input)).status, 'processing');
  await s.service.upload('t', 'task', 'c', input);
  assert.equal(s.counters().uploads, 1);
  assert.equal((await s.service.reconcile('t', 'task', 'c')).status, 'ready');
  assert.equal(s.counters().reads, 1);
});
test('uncertain provider outcome forbids new request and cannot reconcile without id', async () => {
  const s = setup({ networkFailure: true });
  await assert.rejects(s.service.upload('t', 'task', 'c', input));
  assert.equal(s.creative().status, 'unknown');
  await assert.rejects(s.service.upload('t', 'task', 'c', { ...input, requestId: 'request_002' }));
  await assert.rejects(s.service.reconcile('t', 'task', 'c'));
  assert.equal(s.counters().uploads, 1);
});
test('provider accepted but receipt failed leaves durable fence against duplicate upload', async () => {
  const s = setup({ receiptFailure: true });
  await assert.rejects(s.service.upload('t', 'task', 'c', input));
  assert.equal(s.creative().status, 'uploading');
  await assert.rejects(s.service.upload('t', 'task', 'c', { ...input, requestId: 'request_002' }));
  assert.equal(s.counters().uploads, 1);
});
test('version mismatch prevents reading or uploading bytes', async () => {
  const s = setup();
  await assert.rejects(s.service.upload('t', 'task', 'c', { ...input, expectedVersion: 2 }));
  assert.equal(s.counters().uploads, 0);
});

test('oversize metadata and non-MP4 are rejected before media is opened', async () => {
  for (const patch of [{ size: 65 * 1024 * 1024 }, { mimeType: 'video/webm' }]) {
    const s = setup(); Object.assign(s.creative(), patch);
    await assert.rejects(s.service.upload('t', 'task', 'c', input), (error: any) => error.code === 'INVALID_MEDIA');
    assert.equal(s.counters().uploads, 0); assert.equal(s.counters().opens, 0);
  }
});

test('silently dropped receipt blocks provider POST and future retries', async () => {
  const s = setup({ dropReceipt: true });
  await assert.rejects(s.service.upload('t', 'task', 'c', input), (e: any) => e.code === 'STORAGE_ERROR');
  assert.equal(s.counters().uploads, 0);
  await assert.rejects(s.service.upload('t', 'task', 'c', input), (e: any) => e.code === 'RECONCILIATION_REQUIRED');
  assert.equal(s.counters().uploads, 0);
});
test('orphaned upload states and platform id never authorize a fresh upload', async () => {
  for (const patch of [{ status: 'uploading' }, { status: 'unknown' }, { status: 'processing' }, { platformVideoId: '999' }]) {
    const s = setup(); Object.assign(s.creative(), patch);
    await assert.rejects(s.service.upload('t', 'task', 'c', input), (e: any) => e.code === 'RECONCILIATION_REQUIRED');
    assert.equal(s.counters().uploads, 0);
  }
});
