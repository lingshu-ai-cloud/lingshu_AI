import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-imports-'));
process.env.LOCAL_STORE_DIR = directory;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
// Only this isolated fixture uses controlled provider transports and JSON leases.
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
process.env.DATA_BACKEND = 'pocketbase';
process.env.META_ADS_API_VERSION = 'v99.0';
process.env.GOOGLE_ADS_API_VERSION = 'v99';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { importPlatformAdCampaign, listAdImports, AD_IMPORTS } = await import('./imports.js');
  const { changePlatformAdManagement, updatePlatformAdTask } = await import('./tasks.js');
  const connection = async (provider: string, accountId: string, currency = 'USD') => (await store.create('platform_ad_connections', { tenant_id: 'tenant', provider, accountId, currency, status: 'connected', timezoneName: 'Asia/Shanghai', tokenCipher: encryptSecret('fake-test-token') }))!;
  const meta = await connection('meta', '100'), tiktok = await connection('tiktok', '101'), google = await connection('google', '1234567890');
  let platformRequests = 0; let lastMetricWindow: { since: string; until: string } | undefined; let failAdStatus = false; let changeDuringMetrics = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    if (!['graph.facebook.com', 'business-api.tiktok.com', 'googleads.googleapis.com'].includes(parsed.hostname)) return originalFetch(url, init);
    platformRequests++;
    let data: unknown;
    if (parsed.hostname === 'graph.facebook.com') {
      assert.notEqual(init?.method, 'POST', 'Meta import never writes to platform');
      const id = parsed.pathname.split('/').pop();
      if (parsed.pathname.endsWith('/insights')) { if (changeDuringMetrics) await store.update('platform_ad_connections', meta.id, { tokenCipher: encryptSecret('replacement-fixture-token') }); lastMetricWindow = JSON.parse(parsed.searchParams.get('time_range')!); data = { data: [{ account_id: '100', campaign_id: '200', account_currency: 'USD', date_start: JSON.parse(parsed.searchParams.get('time_range')!).since, date_stop: JSON.parse(parsed.searchParams.get('time_range')!).since, spend: '6.77', impressions: '50', clicks: '1' }] }; }
      else if (parsed.pathname.endsWith('/ads')) {
        if (failAdStatus) return new Response(JSON.stringify({ error: { code: 190, message: 'fixture' } }), { status: 503 });
        data = { data: [{ id: '300', account_id: '100', campaign_id: '200', issues_info: [{ error_summary: '付款异常' }] }] };
      }
      else if (id === 'act_100') data = { id, account_id: '100', currency: 'USD', timezone_name: 'Asia/Shanghai', account_status: 1 };
      else data = { id, account_id: id === '999' ? '999' : '100', name: '已有 Meta 计划', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', daily_budget: '5000' };
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
  assert.equal(imported.task?.configuration.accountConnectionId, meta.id);
  await store.update('platform_ad_tasks', imported.task!.id, { configuration: { ...imported.task!.configuration, accountConnectionId: '' } });
  const { listPlatformAdTasks } = await import('./tasks.js');
  assert.equal((await listPlatformAdTasks('tenant')).find(item => item.id === imported.task!.id)?.configuration.accountConnectionId, meta.id, 'legacy import uses its saved mapping for account filtering');
  assert.equal(imported.import.capability, 'read_only');
  await assert.rejects(updatePlatformAdTask('tenant', imported.task!.id, { name: '篡改平台计划' }), /只读/);
  for (const managementMode of ['suggest', 'approval', 'managed']) {
    await assert.rejects(changePlatformAdManagement('tenant', 'user', imported.task!.id, { expectedVersion: imported.task!.version, managementMode }), /只读/);
  }
  const { getAdTaskMetrics } = await import('./metrics.js');
  const { getImportedMetaDelivery } = await import('./metaImportedDelivery.js');
  const report = await getAdTaskMetrics('tenant', imported.task!.id);
  assert.equal(report.spend, 6.77, 'imported campaign reports provider spend without a fake execution receipt');
  const delivery = await getImportedMetaDelivery('tenant', imported.task!.id);
  assert.equal(delivery.effectiveStatus, 'ACTIVE');
  assert.equal(delivery.accountStatus, 1);
  assert.equal(delivery.adIssues, true);
  assert.deepEqual(delivery.issueMessages, ['付款异常']);
  assert.equal(report.resources?.[0].campaignId, '200');
  const { planStatusText } = await import('../../src/lib/adPlanRow.js');
  assert.equal(planStatusText(imported.task!, { delivery, metricsError: { code: 'NETWORK_ERROR' }, errors: [] } as any), '投放异常', 'delivery issue remains visible when insights fail');
  failAdStatus = true;
  const partialDelivery = await getImportedMetaDelivery('tenant', imported.task!.id);
  assert.equal((await getAdTaskMetrics('tenant', imported.task!.id)).spend, 6.77, 'a status read failure does not erase the independent spend report');
  assert.equal(partialDelivery.adIssues, null);
  assert.equal(planStatusText(imported.task!, { delivery: partialDelivery, errors: [] } as any), '已启用 · 投放待核验');
  failAdStatus = false;
  await getAdTaskMetrics('tenant', imported.task!.id, 30);
  assert.equal((Date.parse(lastMetricWindow!.until) - Date.parse(lastMetricWindow!.since)) / 86400000, 29, '30-day report uses inclusive account-local dates');
  await getAdTaskMetrics('tenant', imported.task!.id, '2026-10-27');
  assert.deepEqual(lastMetricWindow, { since: '2026-10-27', until: '2026-10-27' });
  changeDuringMetrics = true;
  await assert.rejects(getAdTaskMetrics('tenant', imported.task!.id), (error: any) => error.code === 'AUTH_CHECK_STALE', 'an old report cannot survive credential replacement during a read');
  changeDuringMetrics = false;
  assert.equal((await getAdTaskMetrics('tenant', imported.task!.id)).spend, 6.77, 'the replacement credential can be queried afresh');
  await assert.rejects(getAdTaskMetrics('other', imported.task!.id), /未找到/);
  await assert.rejects(getImportedMetaDelivery('other', imported.task!.id), /未找到/);
  const repeated = await importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '200' });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.task?.id, imported.task?.id);
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '999' }), /不属于/);
  const beforeCrossTenant = platformRequests;
  await assert.rejects(importPlatformAdCampaign('other', 'user', meta.id, { campaignId: '200' }), /未找到/);
  assert.equal(platformRequests, beforeCrossTenant);
  for (const item of [tiktok, google]) await assert.rejects(importPlatformAdCampaign('tenant', 'user', item.id, { campaignId: '201' }), (error: any) => error.code === 'NOT_SUPPORTED');
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
  assert.equal((await store.list('platform_ad_tasks')).items.length, 2, 'mapping recovery reuses its original task');
  const cnyMeta = await connection('meta', '100', 'CNY');
  const cnyImported = await importPlatformAdCampaign('tenant', 'user', cnyMeta.id, { campaignId: '204' });
  assert.equal(cnyImported.task?.currency, 'CNY');
  assert.equal(cnyImported.task?.configuration.dailyBudget, 50, 'CNY Meta minor units use offset 100');
  const cnyTikTok = await connection('tiktok', '101', 'CNY');
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', cnyTikTok.id, { campaignId: '201' }), (error: any) => error.code === 'NOT_SUPPORTED');
  await store.create('platform_ad_executions', { tenant_id: 'tenant', taskId: 'original', action: 'create', connectionId: meta.id, resourceId: '205', status: 'VERIFIED', requestId: 'existing', createdAt: new Date().toISOString() });
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '205' }), (error: any) => error.code === 'ALREADY_LINKED');
  const alternateMeta = await connection('meta', '100');
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', alternateMeta.id, { campaignId: '205' }), (error: any) => error.code === 'ALREADY_LINKED', 'same account under another connection is still linked');
  await store.create('platform_ad_executions', { tenant_id: 'tenant', taskId: 'pending', action: 'create', connectionId: meta.id, resourceId: '206', status: 'UNKNOWN', requestId: 'pending', createdAt: new Date().toISOString() });
  await assert.rejects(importPlatformAdCampaign('tenant', 'user', meta.id, { campaignId: '206' }), (error: any) => error.code === 'RECONCILIATION_REQUIRED');
  assert.equal((await listAdImports('tenant')).some(item => ['205', '206'].includes(item.campaignId)), false, 'duplicates and pending creates do not create import records');
  console.log('platform ads imports tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); }
