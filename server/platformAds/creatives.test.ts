import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-ad-creative-'));
process.env.LOCAL_STORE_DIR = tempDir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
const mediaDir = path.join(process.cwd(), 'data', 'social-content-sources', `ad-test-${process.pid}`);
try {
  const { store } = await import('../storage/index.js');
  const { createPlatformAdTask, getPlatformAdTask } = await import('./tasks.js');
  const { bindPlatformAdCreative, listPlatformAdCreativeSources, getPlatformAdCreative, openPlatformAdCreativeMedia, validatePlatformAdCreativeSource, listPlatformAdCreatives } = await import('./creatives.js');
  const data = Buffer.from('persisted fixture video bytes');
  const sha256 = createHash('sha256').update(data).digest('hex');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, `${sha256}.mp4`), data);
  const fileId = 'socialfile_1234567890abcdef12345678';
  await store.create('starter_social_content_files', { id: 'fixturefile0001', tenant_id: 'tenant-a', task_id: 'source-a', file_id: fileId, usage: 'artifact_media', byte_size: data.length, content_sha256: sha256, name: 'Final.mp4', mime_type: 'video/mp4', storage_kind: 'local', storage_key: `ad-test-${process.pid}/${sha256}.mp4` });
  const artifact = { tenant_id: 'tenant-a', task_id: 'source-a', artifact_id: 'artifact-a', status: 'approved', origin: 'manual', artifact_kind: 'short_video', resource_ref: `socialfile:${fileId}`, version: '1', created_at: new Date().toISOString() };
  await store.create('starter_social_content_artifacts', { id: 'artifactrecord1', ...artifact });
  await store.create('starter_social_content_artifacts', { id: 'artifactrecord2', ...artifact, tenant_id: 'tenant-b', artifact_id: 'artifact-b' });
  await store.create('platform_ad_connections', { id: 'connection-a', tenant_id: 'tenant-a', provider: 'meta', status: 'connected', currency: 'USD' });
  const input = { name: 'Plan', video: 'Video', goal: '提升有效视频观看', market: '美国', budget: 500, channels: ['Facebook'] };
  const task = await createPlatformAdTask('tenant-a', 'user-a', input);
  const bind = { expectedVersion: task.version, sourceTaskId: 'source-a', artifactId: 'artifact-a', connectionId: 'connection-a' };
  await assert.rejects(bindPlatformAdCreative('tenant-b', task.id, bind), /未找到/);
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, expectedVersion: 9 }), /刷新/);
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, url: 'https://untrusted.invalid/video.mp4' }), /标识/);
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, artifactId: 'artifact-b' }), /not_found/);
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, platformVideoId: '123' }), /验证上传/);
  const mixed = await createPlatformAdTask('tenant-a', 'user-a', { ...input, channels: ['Facebook', 'TikTok'] });
  await assert.rejects(bindPlatformAdCreative('tenant-a', mixed.id, { ...bind, expectedVersion: mixed.version }), /渠道/);
  await store.update('platform_ad_connections', 'connection-a', { currency: 'CNY' });
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, bind), /币种/);
  await store.update('platform_ad_connections', 'connection-a', { currency: 'USD' });
  const sources = await listPlatformAdCreativeSources('tenant-a', { perPage: 999 });
  assert.equal(sources.perPage, 50);
  assert.equal(sources.items.length, 1);
  assert.equal(sources.items[0].artifactId, 'artifact-a');
  assert.ok(!JSON.stringify(sources).includes('socialfile:'));
  const schemaTask = await createPlatformAdTask('tenant-a', 'user-a', input);
  const originalCreate = store.create;
  store.create = async (collection, data) => {
    if (collection === 'platform_ad_creatives') {
      const { taskVersion: _missingVersion, ...dropped } = data;
      return originalCreate(collection, dropped);
    }
    return originalCreate(collection, data);
  };
  try {
    await assert.rejects(bindPlatformAdCreative('tenant-a', schemaTask.id, { ...bind, expectedVersion: schemaTask.version }), /读回校验失败/);
  } finally { store.create = originalCreate; }
  const bound = await bindPlatformAdCreative('tenant-a', task.id, bind);
  assert.equal(bound.taskVersion, 2);
  assert.equal(bound.creative.status, 'pending');
  assert.equal(bound.creative.platformVideoId, '');
  assert.equal((await getPlatformAdTask('tenant-a', task.id))?.version, 2);
  assert.ok(!('fileRef' in bound.creative));
  assert.ok(!('tenant_id' in bound.creative));
  assert.equal(await getPlatformAdCreative('tenant-b', bound.creative.id), null);
  assert.equal((await listPlatformAdCreatives('tenant-a', task.id)).length, 1);
  const opened = await openPlatformAdCreativeMedia('tenant-a', bound.creative.id);
  const chunks = []; for await (const chunk of opened.body) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), data);
  await store.update('platform_ad_creatives', bound.creative.id, { status: 'unknown' });
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, expectedVersion: 2 }), /上传待核对/);
  await store.update('platform_ad_creatives', bound.creative.id, { status: 'pending' });
  await store.update('starter_social_content_artifacts', 'artifactrecord1', { resource_ref: 'https://untrusted.invalid/video.mp4' });
  await assert.rejects(validatePlatformAdCreativeSource('tenant-a', bound.creative.id), /ref_invalid/);
  await store.update('starter_social_content_artifacts', 'artifactrecord1', { resource_ref: `socialfile:${fileId}` });
  await store.create('platform_ad_executions', { tenant_id: 'tenant-a', taskId: task.id, status: 'UNKNOWN' });
  await assert.rejects(bindPlatformAdCreative('tenant-a', task.id, { ...bind, expectedVersion: 2 }), /平台执行记录/);
  console.log('Platform advertising creative ownership, source integrity, version, execution lock and redaction tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(mediaDir, { recursive: true, force: true });
}
