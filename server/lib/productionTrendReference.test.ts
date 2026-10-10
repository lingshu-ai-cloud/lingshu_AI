import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore } from '../storage/datastore.js';
import { productionTrendReference } from './productionTrendReference.js';

const id = 'trend_videos_12345678';
const url = `/api/overseas/videos/${id}/media-url`;
const record = { id, tenantId: 'tenant-a', contentFormat: 'video',
  videoFileId: `tenants/tenant-a/reference-videos/${id}.mp4`,
  aiAnalysis: JSON.stringify({ usage: 'reference_only', contentSha256: 'a'.repeat(64) }) };
const input = (value: typeof record = record) => ({
  store: { getById: async () => value } as unknown as DataStore,
  tenantId: 'tenant-a', projectSpec: { videoKickoff: { video: { referenceRecordId: id, videoUrl: url } } },
  shotReference: { videoUrl: url },
});

test('owned retained trend video becomes a versioned first-frame source', async () => {
  const source = await productionTrendReference(input());
  assert.equal(source.id, id);
  assert.equal(source.file, record.videoFileId);
  assert.equal(source.contentSha256, 'a'.repeat(64));
  assert.equal(source.verifyContentSha256, true);
});

test('trend bridge rejects cross-tenant, forged preview and unversioned source', async () => {
  await assert.rejects(() => productionTrendReference(input({ ...record, tenantId: 'tenant-b' })), /不属于当前企业/);
  await assert.rejects(() => productionTrendReference({ ...input(), shotReference: { videoUrl: '/other' } }), /不一致/);
  await assert.rejects(() => productionTrendReference(input({ ...record, aiAnalysis: '{"usage":"reference_only"}' })), /内容版本/);
  await assert.rejects(() => productionTrendReference(input({ ...record, aiAnalysis: JSON.stringify({ contentSha256: 'a'.repeat(64) }) })), /分析用途授权/);
  await assert.rejects(() => productionTrendReference(input({ ...record, videoFileId: '../other.mp4' })), /存储对象/);
});
