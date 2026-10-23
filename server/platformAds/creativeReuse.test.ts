import assert from 'node:assert/strict';
import { findReusableMetaVideo } from './creativeReuse.js';
const connection: any = { id: 'connection', tenant_id: 'tenant', provider: 'meta', accountId: '123' };
const file = { fileRef: 'socialfile:exact', sha256: 'a'.repeat(64), mimeType: 'video/mp4', size: 100 };
const donor: any = { ...file, id: 'original', tenant_id: 'tenant', provider: 'meta', connectionId: 'connection', sourceTaskId: 'source', artifactId: 'version', status: 'ready', platformVideoId: '999',
  uploadReceipt: { requestId: 'actual_upload', status: 'ready', sha256: file.sha256, accountId: '123', videoId: '999', mappingExecutionId: 'old_ad_receipt' } };
let reads = 0;
const base = { tenantId: 'tenant', connection, file, sourceTaskId: 'source', artifactId: 'version', candidates: [donor], readStatus: async (id: string) => { reads++; assert.equal(id, '999'); return 'ready'; } };
const before = JSON.stringify(donor);
const result = await findReusableMetaVideo(base);
assert.equal(result?.platformVideoId, '999'); assert.equal(reads, 1);
assert.equal(result?.uploadReceipt.reusedFromCreativeId, 'original');
assert.equal(result?.uploadReceipt.requestId, 'actual_upload');
assert.ok(!('mappingExecutionId' in result!.uploadReceipt), 'never copy another plan execution identity');
assert.equal(JSON.stringify(donor), before, 'donor receipt stays unchanged');
for (const patch of [{ tenant_id: 'other' }, { connectionId: 'other-account' }, { sourceTaskId: 'other' }, { artifactId: 'other' }, { sha256: 'b'.repeat(64) }, { fileRef: 'socialfile:other' }, { provider: 'tiktok' }]) {
  assert.equal(await findReusableMetaVideo({ ...base, candidates: [{ ...donor, ...patch }] }), null);
}
assert.equal((await findReusableMetaVideo({ ...base, candidates: [{ ...donor, connectionId: 'old-connection' }], sourceAccountIds: { 'old-connection': '123' } }))?.platformVideoId, '999', 'same platform account may have another local connection');
for (const patch of [{ size: 101 }, { mimeType: 'video/other' }, { status: 'unknown' }, { status: 'processing' }, { uploadReceipt: {} }, { uploadReceipt: { ...donor.uploadReceipt, accountId: '456' } }, { uploadReceipt: { ...donor.uploadReceipt, sha256: 'bad' } }, { uploadReceipt: { ...donor.uploadReceipt, requestId: '' } }]) {
  await assert.rejects(findReusableMetaVideo({ ...base, candidates: [{ ...donor, ...patch }] }), /不要重复上传/);
}
await assert.rejects(findReusableMetaVideo({ ...base, readStatus: async () => 'processing' }), /不会重新上传/);
await assert.rejects(findReusableMetaVideo({ ...base, readStatus: async () => { throw new Error('credential unavailable'); } }), /不会重新上传/);
assert.equal(await findReusableMetaVideo({ ...base, candidates: [] }), null);
assert.equal(await findReusableMetaVideo({ ...base, candidates: [{ ...donor, platformVideoId: '', status: 'failed', uploadReceipt: { requestId: 'rejected_upload', status: 'failed' } }] }), null, 'definitely failed upload without video is not treated as an existing successful upload');
console.log('Meta reuse: exact tenant/account/version, durable upload receipts, read-only readiness, donor immutability and no copied ad evidence passed.');
