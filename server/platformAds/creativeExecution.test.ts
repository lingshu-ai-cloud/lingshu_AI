import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdCreativeExecution } from './creativeExecution.js';
import type { StoredPlatformAdCreative } from './creatives.js';
import type { PlatformAdTask } from './tasks.js';
import type { AdConnection } from './connections.js';

const task = { id: 'plan', version: 2, managementMode: 'manual' } as PlatformAdTask;
const connection = { id: 'account', accountId: '123', provider: 'meta' } as AdConnection;
const creative: StoredPlatformAdCreative = { tenant_id: 'tenant', fileRef: 'socialfile:fixture', mimeType: 'video/mp4', size: 10, name: 'Final.mp4', createdAt: '', updatedAt: '', id: 'creative', taskId: 'plan', taskVersion: 2, connectionId: 'account', provider: 'meta', status: 'ready', platformVideoId: '456', sha256: 'a'.repeat(64), sourceTaskId: 'content', artifactId: 'film', uploadReceipt: { accountId: '123', videoId: '456', sha256: 'a'.repeat(64), status: 'ready' } };
const input = { creativeId: 'creative', action: 'create', meta: { pageId: '789' } };
const resolve = async (tenant: string, id: string) => { assert.equal(tenant, 'tenant'); assert.equal(id, 'creative'); return creative; };

test('manual create takes verified platform video from source and emits version provenance', async () => {
  const result = await resolveAdCreativeExecution('tenant', task, connection, input, 'manual', resolve);
  assert.deepEqual(result.meta, { pageId: '789', videoId: '456' });
  assert.deepEqual(result.evidence, { creativeBindingId: 'creative', creativeSha256: creative.sha256, creativeSourceTaskId: 'content', creativeArtifactId: 'film', creativeVideoId: '456' });
  assert.deepEqual(await resolveAdCreativeExecution('tenant', task, connection, { meta: { videoId: '100' } }, 'manual', async () => { throw new Error('must not read a binding'); }), { meta: { videoId: '100' }, evidence: {} });
});
test('cannot claim source provenance for another task/account/version or unverified upload', async () => {
  for (const patch of [{ taskId: 'other' }, { taskVersion: 1 }, { connectionId: 'other' }, { provider: 'tiktok' }, { status: 'processing' }, { uploadReceipt: {} }, { uploadReceipt: { ...creative.uploadReceipt, accountId: 'other' } }, { uploadReceipt: { ...creative.uploadReceipt, status: 'processing' } }]) {
    await assert.rejects(resolveAdCreativeExecution('tenant', task, connection, input, 'manual', async () => ({ ...creative, ...patch } as StoredPlatformAdCreative)));
  }
  await assert.rejects(resolveAdCreativeExecution('tenant', task, connection, { ...input, meta: { videoId: '999' } }, 'manual', resolve), /不一致/);
  await assert.rejects(resolveAdCreativeExecution('tenant', task, connection, input, 'manual', async () => { throw new Error('private filesystem details'); }), error => error instanceof Error && !error.message.includes('private filesystem'));
});
test('only manual Meta creation accepts a binding', async () => {
  for (const mode of ['automatic', 'approved'] as const) await assert.rejects(resolveAdCreativeExecution('tenant', task, connection, input, mode, resolve), /仅用于/);
  await assert.rejects(resolveAdCreativeExecution('tenant', task, { ...connection, provider: 'tiktok' }, input, 'manual', resolve), /仅用于/);
  await assert.rejects(resolveAdCreativeExecution('tenant', task, connection, { ...input, action: 'activate' }, 'manual', resolve), /仅用于/);
});
