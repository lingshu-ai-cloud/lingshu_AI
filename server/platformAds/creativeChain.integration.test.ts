import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-creative-chain-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
process.env.META_ADS_API_VERSION = 'v25.0';
process.env.PLATFORM_ADS_RELEASE_MODE = 'full';
process.env.TENANT_PLATFORM_APP_KEY = 'isolated-ad-creative-chain-test-key';
const mediaKey = `ad-chain-${process.pid}`;
const mediaDir = path.join(process.cwd(), 'data/social-content-sources', mediaKey);
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createPlatformAdTask } = await import('./tasks.js');
  const { bindPlatformAdCreative } = await import('./creatives.js');
  const { uploadPlatformAdCreative, reconcilePlatformAdCreative } = await import('./creativeUpload.js');
  const { preflightAdAction } = await import('./preflight.js');
  const { executeAdAction } = await import('./execution.js');
  const bytes = Buffer.from('isolated mock MP4 bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, `${sha256}.mp4`), bytes);
  await store.create('starter_social_content_files', { id: 'chainfile000001', tenant_id: 'tenant', task_id: 'source', file_id: 'socialfile_1234567890abcdef12345678', usage: 'artifact_media', byte_size: bytes.length, content_sha256: sha256, name: 'Final.mp4', mime_type: 'video/mp4', storage_kind: 'local', storage_key: `${mediaKey}/${sha256}.mp4` });
  await store.create('starter_social_content_artifacts', { id: 'chainartifact01', tenant_id: 'tenant', task_id: 'source', artifact_id: 'artifact', status: 'approved', origin: 'manual', artifact_kind: 'short_video', resource_ref: 'socialfile:socialfile_1234567890abcdef12345678', version: '1' });
  const task = await createPlatformAdTask('tenant', 'user', { name: 'Chain', video: 'Final', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  const account = await store.create<any>('platform_ad_connections', { tenant_id: 'tenant', provider: 'meta', accountId: '1', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('test-token') });
  const { creative, taskVersion } = await bindPlatformAdCreative('tenant', task.id, { expectedVersion: task.version, sourceTaskId: 'source', artifactId: 'artifact', connectionId: account.id });
  let uploads = 0, adWrites = 0;
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:1/')) return originalFetch(url, init);
    assert.ok(target.startsWith('https://graph.facebook.com/v25.0/'), `unexpected network: ${target}`);
    if (target.endsWith('/advideos')) { uploads++; assert.ok(init?.body instanceof FormData); return Response.json({ id: '500' }); }
    if (init?.method === 'POST') {
      const receipts = await store.list<any>('platform_ad_executions', { where: { tenant_id: 'tenant', taskId: task.id } });
      assert.equal(receipts.items[0].result.creativeBindingId, creative.id, 'source evidence is durable before every provider write');
      assert.equal(receipts.items[0].result.creativeSha256, sha256);
      if (target.endsWith('/adcreatives')) {
        const params = init.body as URLSearchParams;
        assert.equal(JSON.parse(params.get('object_story_spec')!).video_data.video_id, '500');
      }
      return Response.json({ id: String(100 + ++adWrites) });
    }
    if (target.includes('/500?')) return Response.json({ id: '500', status: { video_status: 'ready' } });
    return Response.json({ id: target.includes('/102?') ? '102' : '101', status: 'PAUSED', account_id: '1', daily_budget: '500' });
  }) as typeof fetch;
  const uploadInput = { expectedVersion: taskVersion, requestId: 'upload_chain_1' };
  assert.equal((await uploadPlatformAdCreative('tenant', task.id, creative.id, uploadInput)).status, 'processing');
  await uploadPlatformAdCreative('tenant', task.id, creative.id, uploadInput);
  assert.equal(uploads, 1);
  assert.equal((await reconcilePlatformAdCreative('tenant', task.id, creative.id)).status, 'ready');
  const input = { creativeId: creative.id, expectedVersion: taskVersion, requestId: 'create_chain_1', connectionId: account.id, action: 'create', meta: { pageId: '1', videoId: '500', imageUrl: 'https://example.com/cover.jpg', linkUrl: 'https://example.com', countries: ['US'], dailyBudget: 5 } };
  assert.equal((await preflightAdAction('tenant', task.id, input)).canSubmit, true);
  assert.equal(adWrites, 0, 'preflight does not create ads');
  const execution = await executeAdAction('tenant', task.id, input);
  assert.equal(execution.status, 'VERIFIED');
  const evidence = execution.result as Record<string, string>;
  assert.equal(evidence.creativeBindingId, creative.id);
  assert.equal(evidence.creativeId, '103', 'Meta creative ID must not overwrite source binding identity');
  assert.equal(evidence.creativeSha256, sha256);
  assert.equal(evidence.creativeVideoId, '500');
  assert.equal(adWrites, 4);
  await executeAdAction('tenant', task.id, input);
  assert.equal(adWrites, 4, 'replaying execution does not recreate resources');
  console.log('Creative chain passed: source binding, upload/readback, preflight and paused creation with durable provenance; all provider calls mocked.');
} finally { globalThis.fetch = originalFetch; fs.rmSync(temp, { recursive: true, force: true }); fs.rmSync(mediaDir, { recursive: true, force: true }); }
