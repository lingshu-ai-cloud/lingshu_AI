import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-launch-'));
process.env.LOCAL_STORE_DIR = directory;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.META_ADS_API_VERSION = 'v99.0';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createPlatformAdTask, changePlatformAdManagement } = await import('./tasks.js');
  const { saveAdLaunch, runAdLaunch, AD_LAUNCHES, reconcileAdLaunch } = await import('./launch.js');
  const connection = await store.create('platform_ad_connections', { tenant_id: 'tenant', provider: 'meta', accountId: '100', currency: 'USD', status: 'connected', tokenCipher: encryptSecret('fake-test-token') });
  const task = await createPlatformAdTask('tenant', 'user', { name: '测试', video: '测试视频', goal: '提升网站访问', market: '美国', budget: 500, channels: ['Facebook'] }, { creationSource: 'ai_managed' });
  const managed = (await changePlatformAdManagement('tenant', 'user', task.id, { expectedVersion: task.version, managementMode: 'managed', authorization: { accountIds: [connection!.id], allowedActions: ['create', 'activate'], maxDailyBudget: 100, maxTotalBudget: 500, maxAdjustmentPercent: 20, expiresAt: new Date(Date.now() + 86400000).toISOString() } }))!;
  const launch = await saveAdLaunch('tenant', task.id, { expectedVersion: managed.version, connectionId: connection!.id, meta: { pageId: '101', videoId: '102', imageUrl: 'https://example.com/image.jpg', linkUrl: 'https://example.com', message: 'test', countries: ['US'], dailyBudget: 50 } });
  let creates = 0, writes = 0;
  const statuses: Record<string, string> = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== 'graph.facebook.com') return originalFetch(url, init);
    let result: unknown;
    const id = parsed.pathname.split('/').pop()!;
    if (init?.method === 'POST') {
      writes++;
      if (/\/(campaigns|adsets|adcreatives|ads)$/.test(parsed.pathname)) { const createdId = String(200 + creates++); statuses[createdId] = 'PAUSED'; result = { id: createdId }; }
      else { statuses[id] = new URLSearchParams(String(init.body)).get('status')!; result = { success: true }; }
    } else if (parsed.searchParams.get('fields') === 'account_id') result = { account_id: '100' };
    else result = { id, status: statuses[id] || 'PAUSED', daily_budget: '5000', spend_cap: '50000' };
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  const oldReleaseMode = process.env.PLATFORM_ADS_RELEASE_MODE;
  try {
    process.env.PLATFORM_ADS_RELEASE_MODE = 'paused_only';
    await runAdLaunch(launch);
    assert.equal(writes, 0, 'queued legacy activation must be blocked before creating anything');
    assert.equal((await store.getById(AD_LAUNCHES, launch.id))?.status, 'BLOCKED');
  } finally { if (oldReleaseMode === undefined) delete process.env.PLATFORM_ADS_RELEASE_MODE; else process.env.PLATFORM_ADS_RELEASE_MODE = oldReleaseMode; }
  await store.update(AD_LAUNCHES, launch.id, { status: 'PENDING' });
  await runAdLaunch(launch);
  const result = await store.getById(AD_LAUNCHES, launch.id);
  assert.equal(result?.status, 'ACTIVE', JSON.stringify(result));
  assert.equal(creates, 4, 'campaign, adset, creative and ad all created');
  assert.equal(writes, 7, 'four creates and three activation writes');
  await runAdLaunch(launch);
  assert.equal(writes, 7);
  await store.update(AD_LAUNCHES, launch.id, { status: 'UNKNOWN' });
  assert.equal((await reconcileAdLaunch('tenant', task.id, launch.id)).status, 'ACTIVE');
  assert.equal(writes, 7, 'recovery never repeats writes');
  const pausedTask = await createPlatformAdTask('tenant', 'user', { name: '仅暂停创建', video: '测试视频', goal: '提升网站访问', market: '美国', budget: 500, channels: ['Facebook'] }, { creationSource: 'ai_managed' });
  const pausedManaged = (await changePlatformAdManagement('tenant', 'user', pausedTask.id, { expectedVersion: pausedTask.version, managementMode: 'managed', authorization: { ...managed.authorization, allowedActions: ['create'] } }))!;
  const pausedInput = { expectedVersion: pausedManaged.version, connectionId: connection!.id, meta: launch.meta };
  const originalCreate = store.create.bind(store);
  let droppedModeId = '';
  store.create = (async (collection: string, data: Record<string, unknown>) => {
    if (collection !== AD_LAUNCHES) return originalCreate(collection, data);
    assert.equal(data.status, 'DRAFT', 'launch must be inert before mode persistence is verified');
    const { launchMode: _dropped, ...withoutMode } = data;
    const row = await originalCreate(collection, withoutMode);
    droppedModeId = row!.id;
    return row;
  }) as typeof store.create;
  try {
    await assert.rejects(saveAdLaunch('tenant', pausedTask.id, { ...pausedInput, launchMode: 'create_paused' }), /未正确持久化/);
  } finally { store.create = originalCreate; }
  const blockedMode = await store.getById<any>(AD_LAUNCHES, droppedModeId);
  assert.equal(blockedMode.status, 'BLOCKED');
  await runAdLaunch(blockedMode);
  assert.equal(writes, 7, 'dropped launchMode never reaches provider writes');
  await assert.rejects(saveAdLaunch('tenant', pausedTask.id, { ...pausedInput, launchMode: 'create_and_activate' }), /授权/);
  await assert.rejects(saveAdLaunch('tenant', pausedTask.id, { ...pausedInput, launchMode: 'invalid' }), /有效/);
  const pausedLaunch = await saveAdLaunch('tenant', pausedTask.id, { ...pausedInput, launchMode: 'create_paused' });
  await runAdLaunch(pausedLaunch);
  assert.equal((await store.getById(AD_LAUNCHES, pausedLaunch.id))?.status, 'PAUSED');
  assert.equal(writes, 11, 'paused launch writes only the four creation resources');
  await runAdLaunch(pausedLaunch);
  assert.equal(writes, 11, 'terminal paused launch cannot run again');
  await store.update(AD_LAUNCHES, pausedLaunch.id, { status: 'UNKNOWN' });
  assert.equal((await reconcileAdLaunch('tenant', pausedTask.id, pausedLaunch.id)).status, 'PAUSED');
  await runAdLaunch(pausedLaunch);
  assert.equal(writes, 11, 'reconciliation never activates a paused launch');
  await store.update(AD_LAUNCHES, pausedLaunch.id, { status: 'CREATED' });
  await runAdLaunch(pausedLaunch);
  assert.equal((await store.getById(AD_LAUNCHES, pausedLaunch.id))?.status, 'PAUSED');
  assert.equal(writes, 11, 'recovered CREATED intermediate state remains paused');
  await store.update(AD_LAUNCHES, pausedLaunch.id, { status: 'ACTIVATING' });
  const { executeAutomaticAdAction } = await import('./execution.js');
  await assert.rejects(executeAutomaticAdAction('tenant', pausedTask.id, { expectedVersion: pausedManaged.version, requestId: `launch_${pausedLaunch.id}_activate`, launchId: pausedLaunch.id, connectionId: connection!.id, action: 'activate', resourceId: '204' }), /禁止自动启用/);
  assert.equal(writes, 11, 'forged activation is rejected before provider writes');
  await store.update(AD_LAUNCHES, pausedLaunch.id, { status: 'PAUSED' });
  const viewTask = await createPlatformAdTask('tenant', 'user', { name: '观看目标', video: '测试视频', goal: '提升有效视频观看', market: '美国', budget: 500, channels: ['Facebook'] });
  const viewManaged = (await changePlatformAdManagement('tenant', 'user', viewTask.id, { expectedVersion: viewTask.version, managementMode: 'managed', authorization: managed.authorization }))!;
  const viewLaunch = await saveAdLaunch('tenant', viewTask.id, { expectedVersion: viewManaged.version, connectionId: connection!.id, meta: { ...launch.meta, linkUrl: '' } });
  assert.equal(viewLaunch.meta.linkUrl, '', 'video-view launch does not require a website URL');
  await store.update(AD_LAUNCHES, viewLaunch.id, { launchMode: undefined });
  await runAdLaunch(viewLaunch);
  assert.equal((await store.getById(AD_LAUNCHES, viewLaunch.id))?.status, 'ACTIVE', 'legacy records without launchMode preserve create-and-activate behavior');
  await store.update('platform_ad_connections', connection!.id, { provider: 'tiktok' });
  await assert.rejects(saveAdLaunch('tenant', viewTask.id, { expectedVersion: viewManaged.version, connectionId: connection!.id, meta: viewLaunch.meta }), /仅支持 Meta/);
  console.log('platform ads managed launch tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); }
