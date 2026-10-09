import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-execution-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
// Isolated test JSON records and mocked provider calls only.
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
process.env.META_ADS_API_VERSION = 'v25.0';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createPlatformAdTask } = await import('./tasks.js');
  const { executeAdAction, AD_EXECUTIONS } = await import('./execution.js');
  const task = await createPlatformAdTask('t1', 'u1', { name: 'Test', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  const connection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'meta', accountId: '1', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let writes = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return originalFetch(url, init);
    if (init.method === 'POST') return Response.json({ id: String(100 + ++writes) });
    return Response.json({ id: '101', status: 'PAUSED', account_id: '1', daily_budget: '500' });
  }) as typeof fetch;
  const staleTask = await createPlatformAdTask('t1', 'u1', { name: 'Stale AI plan', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] }, {
    creationSource: 'ai_assisted',
    proposal: {
      rationale: '待复核方案', audienceStrategy: '待核验受众', creativeStrategy: '待核验素材',
      risks: ['待核验'], assumptions: ['待核验'], expectedOutcome: '暂不可预测', generatedAt: new Date().toISOString(),
      enterpriseFactVersion: 'enterprise-facts-stale',
    },
  });
  await assert.rejects(executeAdAction('t1', staleTask.id, {
    requestId: 'stale_fact_request', expectedVersion: staleTask.version, connectionId: connection.id, action: 'create',
    meta: { pageId: '1', videoId: '2', imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com', countries: ['US'], dailyBudget: 5 },
  }), /\u4f01\u4e1a\u8d44\u6599\u5df2\u66f4\u65b0/);
  assert.equal(writes, 0, 'stale enterprise facts must block execution before provider writes');
  const input = { requestId: 'request_1', expectedVersion: task.version, connectionId: connection.id, action: 'create', meta: { pageId: '1', videoId: '2', imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com', countries: ['US'], dailyBudget: 5 } };
  const first = await executeAdAction('t1', task.id, input);
  assert.equal(first.status, 'VERIFIED');
  assert.equal(writes, 4);
  const replay = await executeAdAction('t1', task.id, { ...input, expectedVersion: -1 });
  assert.equal(replay.id, first.id);
  assert.equal(writes, 4);
  const previousReleaseMode = process.env.PLATFORM_ADS_RELEASE_MODE;
  try {
    process.env.PLATFORM_ADS_RELEASE_MODE = 'paused_only';
    for (const action of ['activate', 'resume', 'adjust_budget']) {
      await assert.rejects(executeAdAction('t1', task.id, { ...input, requestId: `release_${action}`, action, resourceId: first.resourceId }), /未开放/);
    }
    assert.equal(writes, 4, 'release policy must reject before provider writes');
  } finally { if (previousReleaseMode === undefined) delete process.env.PLATFORM_ADS_RELEASE_MODE; else process.env.PLATFORM_ADS_RELEASE_MODE = previousReleaseMode; }
  await assert.rejects(executeAdAction('t1', task.id, { ...input, requestId: 'request_2' }), /已创建/);
  await assert.rejects(executeAdAction('t2', task.id, input), /未找到/);
  const task2 = await createPlatformAdTask('t1', 'u1', { name: 'Test2', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  await store.create(AD_EXECUTIONS, { tenant_id: 't1', taskId: task2.id, requestId: 'uncertain_1', status: 'UNKNOWN', action: 'create' });
  await assert.rejects(executeAdAction('t1', task2.id, input), /核对/);
  assert.equal(writes, 4);
  const tikTask = await createPlatformAdTask('t1', 'u1', { name: 'TikTok', video: 'post', market: 'US', budget: 200, goal: '提升有效视频观看', channels: ['TikTok'], configuration: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString() } });
  const tikConnection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'tiktok', accountId: '10', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let tikWrites = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://business-api.tiktok.com/')) return originalFetch(url, init);
    const target = String(url);
    if (init.method === 'POST') { tikWrites++; return Response.json({ code: 0, data: target.includes('/campaign/') ? { campaign_id: '1' } : target.includes('/adgroup/') ? { adgroup_id: '2' } : { ad_ids: ['3'] } }); }
    return Response.json({ code: 0, data: { list: [{ advertiser_id: '10', campaign_id: '1', adgroup_id: '2', ad_id: '3', operation_status: 'DISABLE' }] } });
  }) as typeof fetch;
  const tikInput = { requestId: 'tiktok_req_1', expectedVersion: tikTask.version, connectionId: tikConnection.id, action: 'create', tiktok: { identityId: '12', tiktokItemId: '13', locationIds: ['6252001'], adText: 'Test' } };
  assert.equal((await executeAdAction('t1', tikTask.id, tikInput)).status, 'VERIFIED');
  assert.equal(tikWrites, 3);
  await executeAdAction('t1', tikTask.id, tikInput);
  assert.equal(tikWrites, 3);
  process.env.GOOGLE_ADS_API_VERSION = 'v25';
  const googleTask = await createPlatformAdTask('t1', 'u1', { name: 'Google', video: 'video', market: 'US', budget: 200, goal: '获取线索或转化', channels: ['YouTube'], configuration: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString() } });
  const googleConnection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'google', accountId: '1234567890', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let googleWrites = 0;
  const base = 'customers/1234567890';
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://googleads.googleapis.com/')) return originalFetch(url, init);
    const body = JSON.parse(init.body);
    if (body.mutateOperations) {
      if (!body.validateOnly) googleWrites++;
      return Response.json({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: `${base}/campaignBudgets/1` } }, { campaignResult: { resourceName: `${base}/campaigns/2` } }, { adGroupResult: { resourceName: `${base}/adGroups/3` } }, { adGroupAdResult: { resourceName: `${base}/adGroupAds/3~4` } }] });
    }
    if (body.query.includes('customer.time_zone')) return Response.json({ results: [{ customer: { timeZone: 'America/Los_Angeles' } }] });
    if (body.query.includes('FROM ad_group_ad')) return Response.json({ results: [{ adGroup: { resourceName: `${base}/adGroups/3`, campaign: `${base}/campaigns/2`, status: 'PAUSED' }, adGroupAd: { resourceName: `${base}/adGroupAds/3~4`, status: 'PAUSED' } }] });
    return Response.json({ results: [{ campaign: { resourceName: `${base}/campaigns/2`, status: 'PAUSED' }, campaignBudget: { totalAmountMicros: '200000000' } }] });
  }) as typeof fetch;
  const googleInput = { requestId: 'google_req_1', expectedVersion: googleTask.version, connectionId: googleConnection.id, action: 'create', google: { targetCpa: 10, videoAssetId: '1', logoAssetId: '2', finalUrl: 'https://example.com', businessName: 'Factory', headline: 'Factory direct', longHeadline: 'Buy from factory', description: 'Request a quote', locationIds: ['2840'] } };
  assert.equal((await executeAdAction('t1', googleTask.id, googleInput)).status, 'VERIFIED');
  assert.equal(googleWrites, 1);
  console.log('ad execution tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
