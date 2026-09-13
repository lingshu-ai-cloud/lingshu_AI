import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-imports-'));
process.env.LOCAL_STORE_DIR = directory;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.META_ADS_API_VERSION = 'v99.0';
process.env.GOOGLE_ADS_API_VERSION = 'v99';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { importPlatformAdCampaign, listAdImports, AD_IMPORTS } = await import('./imports.js');
  const { changePlatformAdManagement, updatePlatformAdTask } = await import('./tasks.js');
  const connection = async (provider: string, accountId: string, currency = 'USD') => (await store.create('platform_ad_connections', { tenant_id: 'tenant', provider, accountId, currency, status: 'connected', tokenCipher: encryptSecret('fake-test-token') }))!;
  const meta = await connection('meta', '100'), tiktok = await connection('tiktok', '101'), google = await connection('google', '1234567890');
  let platformRequests = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    if (!['graph.facebook.com', 'business-api.tiktok.com', 'googleads.googleapis.com'].includes(parsed.hostname)) return originalFetch(url, init);
    platformRequests++;
    let data: unknown;
    if (parsed.hostname === 'graph.facebook.com') {
      assert.notEqual(init?.method, 'POST', 'Meta import never writes to platform');
      const id = parsed.pathname.split('/').pop();
      data = { id, account_id: id === '999' ? '999' : '100', name: '已有 Meta 计划', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', daily_budget: '5000' };
    } else if (parsed.hostname === 'business-api.tiktok.com') {
      assert.notEqual(init?.method, 'POST', 'TikTok import never writes to platform');
      data = { code: 0, data: { list: parsed.pathname.includes('advertiser/info') ? [{ advertiser_id: '101', currency: 'USD', status: 'STATUS_ENABLE' }] : [{ advertiser_id: '101', campaign_id: '201', campaign_name: '已有 TikTok 计划', operation_status: 'ENABLE', objective_type: 'VIDEO_VIEWS', budget_mode: 'BUDGET_MODE_TOTAL', budget: 100 }] } };
    } else {
      assert.ok(parsed.pathname.endsWith('googleAds:search'), 'Google import only uses read-only search');
      const query = JSON.parse(String(init?.body)).query;
      data = { results: query.includes('FROM customer') ? [{ customer: { id: '1234567890', currencyCode: 'USD', status: 'ENABLED' } }] : [{ campaign: { id: '202', name: '已有 Google 视频计划', status: 'PAUSED', advertisingChannelType: 'VIDEO' }, campaignBudget: { amountMicros: '10000000' } }] };
    }
    return new Response(JSON.stringify(data), { status: 200 });
  }) as typeof fetch;
  const imported = await importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '200' });
  assert.equal(imported.task?.creationSource, 'platform_import');
  assert.equal(imported.task?.managementMode, 'manual');
  assert.equal(imported.task?.status, 'active');
  assert.equal(imported.task?.budget, 0, 'missing total budget is not invented');
  assert.equal(imported.task?.configuration.dailyBudget, 50);
  assert.equal(imported.import.capability, 'read_only');
  await assert.rejects(updatePlatformAdTask('tenant', imported.task!.id, { name: '篡改平台计划' }), /只读/);
  for (const managementMode of ['suggest', 'approval', 'managed']) {
    await assert.rejects(changePlatformAdManagement('tenant', 'user', imported.task!.id, { expectedVersion: imported.task!.version, managementMode }), /只读/);
  }
  const repeated = await importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '200' });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.task?.id, imported.task?.id);
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '999' }), /不属于/);
  const beforeCrossTenant = platformRequests;
  await assert.rejects(importPlatformAdCampaign('other', 'user', meta.id, { campaignId: '200' }), /未找到/);
  assert.equal(platformRequests, beforeCrossTenant);
  assert.equal((await importPlatformAdCampaign('tenant', 'user', tiktok.id, { campaignId: '201' })).task?.budget, 100);
  assert.equal((await importPlatformAdCampaign('tenant', 'user', google.id, { campaignId: '202' })).task?.configuration.dailyBudget, 10);
  const euro = await connection('meta', '100', 'EUR');
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', euro.id, { campaignId: '200' }), /USD/);
  assert.equal((await listAdImports('other')).length, 0);
  assert.equal((await store.list('platform_ad_executions')).items.length, 0, 'import never fabricates execution receipts');
  const update = store.update;
  store.update = async (collection, id, values) => collection === AD_IMPORTS ? false : update(collection, id, values);
  try { await assert.rejects(importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '203' }), /映射待恢复/); }
  finally { store.update = update; }
  const recovered = await importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '203' });
  assert.equal(recovered.reused, true);
  assert.equal((await store.list('platform_ad_tasks')).items.length, 4, 'mapping recovery reuses its original task');
  const cnyMeta = await connection('meta', '100', 'CNY');
  const cnyImported = await importPlatformAdCampaign('tenant', 'user', cnyMeta.id, { campaignId: '204' });
  assert.equal(cnyImported.task?.currency, 'CNY');
  assert.equal(cnyImported.task?.configuration.dailyBudget, 50, 'CNY Meta minor units use offset 100');
  const cnyTikTok = await connection('tiktok', '101', 'CNY');
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', cnyTikTok.id, { campaignId: '201' }), /币种/);
  console.log('platform ads imports tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); }
