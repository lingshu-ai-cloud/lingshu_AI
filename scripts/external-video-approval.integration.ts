import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pbBin = process.env.PB_BIN || '/tmp/lingshu-pb-0.39.5/pocketbase';
if (!fs.existsSync(pbBin)) throw new Error('PB_BIN is required for real PocketBase integration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-external-approval-'));
const pbData = path.join(root, 'pb-data');
const migrations = path.join(repositoryRoot, 'pb_migrations');
const adminEmail = 'external-approval-harness@example.invalid';
const adminPassword = 'external-approval-harness-password-2026';
let pb: ChildProcess | null = null;
let api: ReturnType<typeof express.application.listen> | null = null;
const originalCwd = process.cwd();

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function pbCommand(args: string[]): void {
  const result = spawnSync(pbBin, args, { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, `PocketBase ${args[0]} failed: ${result.stdout}\n${result.stderr}`);
}

try {
  pbCommand(['migrate', 'up', `--dir=${pbData}`, `--migrationsDir=${migrations}`]);
  pbCommand(['superuser', 'upsert', adminEmail, adminPassword, `--dir=${pbData}`]);
  const pbPort = await freePort();
  const pbUrl = `http://127.0.0.1:${pbPort}`;
  pb = spawn(pbBin, ['serve', `--http=127.0.0.1:${pbPort}`, `--dir=${pbData}`, `--migrationsDir=${migrations}`, '--automigrate=false'], {
    cwd: repositoryRoot, stdio: 'ignore',
  });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { healthy = (await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* wait */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy, 'PocketBase must start');
  process.env.PB_URL = pbUrl;
  process.env.PB_ADMIN_EMAIL = adminEmail;
  process.env.PB_ADMIN_PASSWORD = adminPassword;
  process.env.NODE_ENV = 'test';
  process.chdir(root);

  const [{ publishingRouter }, { store, auth }, { bindDataAuthority, dataAuthorityRequestScope }, { runScheduledPublishingCycle }, { finalizeTrackedPost }] = await Promise.all([
    import('../server/routes/publishing.js'),
    import('../server/storage/index.js'),
    import('../server/storage/dataAuthority.js'),
    import('../server/publishing/scheduledPublisher.js'),
    import('../server/publishing/waLink.js'),
  ]);
  auth.verifyToken = (async (header?: string) => {
    const tenantId = String(header || '').replace(/^Bearer\s+/, '');
    if (!['tenant-a', 'tenant-b'].includes(tenantId)) return null;
    bindDataAuthority('pocketbase');
    return { userId: `owner-${tenantId}`, tenantId, dataAuthority: 'pocketbase' as const };
  }) as typeof auth.verifyToken;
  const accounts = {} as Record<'youtube' | 'facebook' | 'instagram' | 'tiktok', { id: string }>;
  accounts.youtube = (await store.create<any>('youtube_accounts', { tenantId: 'tenant-a', channelTitle: 'Harness channel', status: 'connected' }))!;
  for (const platform of ['facebook', 'instagram', 'tiktok'] as const) {
    accounts[platform] = (await store.create<any>('social_accounts', {
      tenantId: 'tenant-a', platform, title: `${platform} harness`, status: 'connected',
    }))!;
  }
  for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok'] as const) {
    assert.ok(accounts[platform]?.id, `real PocketBase must persist connected ${platform} account`);
  }

  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use(express.json());
  app.use('/api/overseas/publishing', publishingRouter);
  api = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => api!.once('listening', resolve));
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}/api/overseas/publishing`;
  const request = async (tenantId: string, route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${route}`, {
      method, headers: { authorization: `Bearer ${tenantId}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };

  const suppliedVideo = process.env.EXTERNAL_VIDEO_TEST_FILE;
  const videoBytes = suppliedVideo ? fs.readFileSync(suppliedVideo) : Buffer.from('authorized-video-v1');
  const upload = await fetch(`${base}/local-videos`, {
    method: 'POST', headers: { authorization: 'Bearer tenant-a', 'x-file-name': 'authorized.mp4', 'content-type': 'application/octet-stream' },
    body: videoBytes,
  });
  if (upload.status !== 201) throw new Error(`HTTP upload failed (${upload.status}): ${await upload.text()}`);
  const uploaded = await upload.json() as { video: { videoPath: string } };
  const videoPath = uploaded.video.videoPath;
  assert.equal(createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex'), createHash('sha256').update(videoBytes).digest('hex'),
    'the controlled upload must preserve the exact source video bytes');
  const schedule = new Date(Date.now() + 15 * 60_000).toISOString();
  const create = async (title: string, platform: 'youtube' | 'facebook' | 'instagram' | 'tiktok' = 'youtube') => request('tenant-a', '/external-video-approvals', 'POST', {
    videoPath, title, description: 'Authorized test', platform,
    targetAccountIds: [accounts[platform].id], scheduledAt: schedule,
  });

  const pendingByPlatform = {} as Record<'youtube' | 'facebook' | 'instagram' | 'tiktok', any>;
  for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok'] as const) {
    const pending = await create(`${platform} approved version`, platform);
    assert.equal(pending.status, 201, `${platform}: ${JSON.stringify(pending.body)}`);
    pendingByPlatform[platform] = pending.body.approval;
    assert.equal(pendingByPlatform[platform].status, 'awaiting_approval');
    assert.deepEqual(pendingByPlatform[platform].targetAccountIds, [accounts[platform].id]);
  }
  const first = pendingByPlatform.youtube;
  assert.equal((await request('tenant-b', `/external-video-approvals/${first.id}`)).status, 404);
  assert.equal((await request('tenant-b', `/external-video-approvals/${first.id}/approve`, 'POST', { contentHash: first.contentHash })).status, 404);
  assert.equal((await request('tenant-a', `/calendar/${first.id}`, 'PATCH', { title: 'Tampered title' })).status, 409);

  let providerCalls = 0;
  const providerCallsByPlatform = new Map<string, number>();
  const dependencies = {
    assertLegacyAccess: async () => {},
    executeLegacyEffect: async <T>(_tenantId: string, effect: () => Promise<T>) => effect(),
    acquirePublishLease: async () => ({ beforeEffect: async () => {}, release: async () => {} }),
    finalize: finalizeTrackedPost,
    publish: async (input: { platform: string; accountId: string }) => { providerCalls += 1;
      providerCallsByPlatform.set(input.platform, (providerCallsByPlatform.get(input.platform) || 0) + 1);
      assert.equal(input.accountId, accounts[input.platform as keyof typeof accounts].id);
      return {
      video: {}, tracking: {} as any, publishRecord: null, platformPostId: `provider-${input.platform}-${providerCallsByPlatform.get(input.platform)}`,
      deliveryStatus: 'published' as const,
    }; },
  };
  const cycleAt = Date.parse(schedule) + 1_000;
  await runScheduledPublishingCycle(cycleAt, dependencies as any);
  assert.equal(providerCalls, 0, 'unapproved persistent post must not call provider');
  for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok'] as const) {
    const approval = pendingByPlatform[platform];
    const approved = await request('tenant-a', `/external-video-approvals/${approval.id}/approve`, 'POST', { contentHash: approval.contentHash });
    assert.equal(approved.status, 200, `${platform}: ${JSON.stringify(approved.body)}`);
  }
  await runScheduledPublishingCycle(cycleAt, dependencies as any);
  assert.equal(providerCalls, 4, 'four approved persistent posts must each call provider once');
  for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok'] as const) {
    const published = await request('tenant-a', `/external-video-approvals/${pendingByPlatform[platform].id}`);
    assert.equal(published.body.approval.status, 'published', `${platform} final state`);
    assert.equal(published.body.approval.platformPostId, `provider-${platform}-1`, `${platform} final receipt`);
    assert.equal(providerCallsByPlatform.get(platform), 1, `${platform} cannot call provider twice`);
  }
  await runScheduledPublishingCycle(cycleAt, dependencies as any);
  assert.equal(providerCalls, 4, 'final receipts must not republish');

  const changed = await create('File mutation approval');
  assert.equal(changed.status, 201);
  fs.writeFileSync(videoPath, 'authorized-video-v2');
  assert.equal((await request('tenant-a', `/external-video-approvals/${changed.body.approval.id}/approve`, 'POST', { contentHash: changed.body.approval.contentHash })).status, 409,
    'changed video bytes must invalidate pending approval');

  const approvedThenChanged = await create('Approved before file mutation');
  assert.equal(approvedThenChanged.status, 201);
  assert.equal((await request('tenant-a', `/external-video-approvals/${approvedThenChanged.body.approval.id}/approve`, 'POST', { contentHash: approvedThenChanged.body.approval.contentHash })).status, 200);
  fs.writeFileSync(videoPath, 'authorized-video-v3');
  await runScheduledPublishingCycle(cycleAt, dependencies as any);
  assert.equal(providerCalls, 4, 'changed file after approval must not call provider');

  const approvedThenEdited = await create('Approved before content mutation');
  assert.equal(approvedThenEdited.status, 201);
  assert.equal((await request('tenant-a', `/external-video-approvals/${approvedThenEdited.body.approval.id}/approve`, 'POST', { contentHash: approvedThenEdited.body.approval.contentHash })).status, 200);
  await store.update('posts', approvedThenEdited.body.approval.id, { title: 'Unauthorized content edit' });
  await runScheduledPublishingCycle(cycleAt, dependencies as any);
  assert.equal(providerCalls, 4, 'changed content after approval must not call provider');

  const unknown = await create('Unknown outcome approval');
  assert.equal(unknown.status, 201);
  assert.equal((await request('tenant-a', `/external-video-approvals/${unknown.body.approval.id}/approve`, 'POST', { contentHash: unknown.body.approval.contentHash })).status, 200);
  const unknownDeps = { ...dependencies, publish: async () => { providerCalls += 1; throw new Error('provider_result_unknown'); } };
  await runScheduledPublishingCycle(cycleAt, unknownDeps as any);
  assert.equal(providerCalls, 5);
  await runScheduledPublishingCycle(cycleAt + 60_000, unknownDeps as any);
  assert.equal(providerCalls, 5, 'unknown provider outcome must never blindly resend');
  const uncertain = await request('tenant-a', `/external-video-approvals/${unknown.body.approval.id}`);
  assert.equal(uncertain.body.approval.status, 'needs_attention');

  console.log('external video approval real PocketBase + HTTP + Worker integration passed');
} finally {
  if (api) {
    api.closeAllConnections();
    await new Promise<void>(resolve => api!.close(() => resolve()));
  }
  if (pb && pb.exitCode === null) {
    pb.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { pb!.kill('SIGKILL'); resolve(); }, 5_000);
      pb!.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
}
