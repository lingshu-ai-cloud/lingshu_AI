import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-currency-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
// Only this isolated fixture uses controlled provider transports and JSON leases.
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
process.env.DATA_BACKEND = 'pocketbase';
process.env.META_ADS_API_VERSION = 'v25.0';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createPlatformAdTask } = await import('./tasks.js');
  const { executeAdAction } = await import('./execution.js');
  let calls = 0;
  let actualBudget = '1234';
  let minimumCap = 0, minimumDaily = 0;
  const posts: URLSearchParams[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://graph.facebook.com/') && !String(url).startsWith('https://business-api.tiktok.com/') && !String(url).startsWith('https://googleads.googleapis.com/')) return originalFetch(url, init);
    calls++;
    if (new URL(String(url)).searchParams.get('fields') === 'id,access_token') return Response.json({ id: '1', access_token: 'test-page-token' });
    if (init.method === 'POST') { const params = new URLSearchParams(init.body); posts.push(params); if (params.has('daily_budget')) actualBudget = params.get('daily_budget')!; return Response.json({ id: String(100 + posts.length) }); }
    return Response.json({ id: '101', status: 'PAUSED', account_id: '1', daily_budget: actualBudget, min_campaign_group_spend_cap: minimumCap, min_daily_budget: minimumDaily });
  }) as typeof fetch;
  const createTask = (currency: string) => createPlatformAdTask('t1', 'u1', { name: `Currency ${currency}`, video: 'video', market: 'CN', budget: 1234.56, currency, goal: '提升网站访问', channels: ['Facebook'] });
  const connection = (provider: string, currency: string) => store.create<any>('platform_ad_connections', { tenant_id: 't1', provider, accountId: '1', status: 'connected', currency, tokenCipher: encryptSecret('test') });
  const cnyTask = await createTask('CNY');
  const cnyConnection = await connection('meta', 'CNY');
  const input = { requestId: 'cny_create_1', expectedVersion: cnyTask.version, connectionId: cnyConnection.id, action: 'create', meta: { pageId: '1', videoId: '2', imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com', countries: ['CN'], dailyBudget: 12.34 } };
  const receipt = await executeAdAction('t1', cnyTask.id, input);
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(posts[0].get('spend_cap'), '123456', 'CNY total budget must be sent in fen');
  assert.equal(posts[1].get('daily_budget'), '1234', 'CNY daily budget must be sent in fen');
  assert.equal((receipt.result as any).dailyBudgetMinor, '1234');
  const adjusted = await executeAdAction('t1', cnyTask.id, { requestId: 'cny_adjust_1', expectedVersion: cnyTask.version, connectionId: cnyConnection.id, action: 'adjust_budget', resourceId: receipt.resourceId, dailyBudget: 15.67 });
  assert.equal(adjusted.status, 'VERIFIED');
  assert.equal(posts.at(-1)!.get('daily_budget'), '1567', 'CNY adjustment must preserve two-decimal fen precision');
  const lowCapTask = await createPlatformAdTask('t1', 'u1', { name: 'Below account minimum', video: 'video', market: 'US', budget: 100, currency: 'CNY', goal: '提升网站访问', channels: ['Facebook'] });
  minimumCap = 50000;
  const beforeMinimumChecks = posts.length;
  await assert.rejects(executeAdAction('t1', lowCapTask.id, { ...input, requestId: 'low_cap_before_write', expectedVersion: lowCapTask.version }), /CNY 500.00/);
  const lowDailyTask = await createTask('CNY');
  minimumDaily = 672;
  await assert.rejects(executeAdAction('t1', lowDailyTask.id, { ...input, requestId: 'low_daily_before_write', expectedVersion: lowDailyTask.version, meta: { ...input.meta, dailyBudget: 1 } }), /CNY 6.72/);
  assert.equal(posts.length, beforeMinimumChecks, 'platform minimum budgets must block before creating any resources');
  minimumCap = 0; minimumDaily = 0;
  for (const [provider, taskCurrency, accountCurrency] of [['meta', 'USD', 'CNY'], ['meta', 'CNY', 'USD'], ['google', 'CNY', 'USD'], ['tiktok', 'CNY', 'USD']] as const) {
    const task = await createTask(taskCurrency), account = await connection(provider, accountCurrency);
    const before = calls;
    await assert.rejects(executeAdAction('t1', task.id, { ...input, requestId: `mismatch_${provider}_${taskCurrency}`, expectedVersion: task.version, connectionId: account.id }), /币种|USD/);
    assert.equal(calls, before, 'currency mismatch must fail before any provider read or write');
  }
  console.log('currency execution tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
