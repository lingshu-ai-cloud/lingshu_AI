import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-lead-execution-'));
Object.assign(process.env, { LOCAL_STORE_DIR: dir, PB_URL: 'http://127.0.0.1:1', NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK: 'true', META_ADS_API_VERSION: 'v25.0', PLATFORM_ADS_RELEASE_MODE: 'paused_only', OVERSEAS_LLM_BACKEND: 'qwen', DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: 'https://ai.example/compatible-mode/v1' });
const original = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createAiPlatformAdPlan } = await import('./planning.js');
  const { createPlatformAdTask } = await import('./tasks.js');
  const { preflightAdAction } = await import('./preflight.js');
  const { executeAdAction, reconcileAdExecution } = await import('./execution.js');
  const { createAdApproval } = await import('./approvals.js');
  const { saveAdLaunch } = await import('./launch.js');
  const saved: Record<string, any> = {}; let writes = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === 'https://ai.example/compatible-mode/v1/chat/completions') {
      return Response.json({ id: 'mock-ai', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ rationale: '100 CNY约合14 USD。展示产品工艺。', audienceStrategy: '面向目标地区采购商。', creativeStrategy: '展示产品细节。', risks: ['Facebook不支持人民币预算。'], assumptions: ['必须把日预算改成20美元。'] }) } }] });
    }
    if (!String(url).startsWith('https://graph.facebook.com/')) {
      assert.equal(new URL(String(url)).hostname, '127.0.0.1', 'unexpected external request');
      return original(url, init);
    }
    const u = new URL(String(url)), id = u.pathname.split('/').pop()!;
    if (u.searchParams.get('fields') === 'id,access_token') return Response.json({ id: '1', access_token: 'page-token' });
    if (id === 'accounts' || id === 'promote_pages') return Response.json({ data: [{ id: '1', name: 'Factory', tasks: ['ADVERTISE'] }] });
    if (id === 'leadgen_forms') return Response.json({ data: [{ id: '3', status: 'ACTIVE' }] });
    if (id === 'adspixels') return Response.json({ data: [{ id: '4' }] });
    if (id === '1') return Response.json({ id: '1', leadgen_tos_accepted: true, whatsapp_number: '+8613800138000' });
    if (init.method === 'POST') {
      const key = String(100 + ++writes), record: Record<string, any> = Object.fromEntries(new URLSearchParams(init.body));
      for (const k of ['promoted_object', 'creative', 'object_story_spec', 'targeting']) if (record[k]) record[k] = JSON.parse(record[k]);
      if (record.creative) record.creative = { id: record.creative.creative_id };
      saved[key] = { ...record, id: key, account_id: '5' }; return Response.json({ id: key });
    }
    return Response.json(saved[id] || { id: 'act_5', account_id: '5', currency: 'CNY', account_status: 1 });
  }) as typeof fetch;
  const connection = await store.create<any>('platform_ad_connections', { tenant_id: 'tenant', provider: 'meta', accountId: '5', status: 'connected', currency: 'CNY', tokenCipher: encryptSecret('test-token') });
  const cases = [
    { goal: '提升网站访问', extra: {} },
    { goal: '提升有效视频观看', extra: {} },
    { goal: '获取消息会话', extra: { messageDestination: 'WHATSAPP', whatsappPhoneNumber: '+8613800138000' } },
    { goal: '获取Meta表单线索', extra: { leadFormId: '3' } },
    { goal: '获取独立站询盘', extra: { pixelId: '4' } },
  ];
  for (const item of cases) {
    const task = await createAiPlatformAdPlan('tenant', 'user', { entry: 'ai_assisted', name: item.goal, video: 'Video', goal: item.goal, market: 'US', budget: 100, currency: 'CNY', channels: ['Facebook', 'Instagram'], configuration: { ...(item.goal === '获取消息会话' ? { metaMessage: { pageId: '1', destination: 'WHATSAPP', recipientId: '+8613800138000' } } : {}), countries: ['US'], adMessage: 'Request product catalog', landingPageUrl: 'https://example.com/quote', dailyBudget: 5 } });
    assert.equal(task.creationSource, 'ai_assisted');
    assert.equal(task.currency, 'CNY'); assert.equal(task.budget, 100); assert.equal(task.configuration.dailyBudget, 5);
    assert.ok(task.proposal?.enterpriseFactVersion);
    assert.equal(task.proposal?.rationale, '展示产品工艺。');
    assert.ok(!JSON.stringify(task.proposal).includes('美元'));
    const persisted = await store.getById<any>('platform_ad_tasks', task.id);
    assert.equal(persisted.budget, 100); assert.equal(persisted.proposal.rationale, '展示产品工艺。');
    const meta = { pageId: '1', videoId: '2', imageUrl: 'https://example.com/cover.jpg', linkUrl: task.configuration.landingPageUrl, message: task.configuration.adMessage, dailyBudget: task.configuration.dailyBudget, countries: task.configuration.countries, ...item.extra };
    const input = { expectedVersion: task.version, action: 'create', connectionId: connection.id, requestId: `request_${task.id}`, meta };
    const preparedInput = item.goal === '获取消息会话' ? { ...input, meta: { ...meta, whatsappPhoneNumber: undefined } } : input;
    const before = writes;
    const preflight = await preflightAdAction('tenant', task.id, preparedInput);
    assert.equal(preflight.canSubmit, true, JSON.stringify(preflight.checks.filter(c => c.status === 'blocked')));
    assert.equal(writes, before, 'preflight never writes');
    const receipt = await executeAdAction('tenant', task.id, preparedInput);
    assert.equal(receipt.status, 'VERIFIED', receipt.error);
    assert.equal(writes, before + 4);
    const snapshot = (receipt.result as any).createSnapshot;
    assert.equal(snapshot.goal, item.goal);
    assert.equal(snapshot.currency, 'CNY'); assert.equal(snapshot.budget, 100);
    assert.equal(saved[(receipt.result as any).campaignId].spend_cap, '10000');
    assert.equal(saved[(receipt.result as any).adsetId].daily_budget, '500');
    for (const [key, value] of Object.entries(item.extra)) assert.equal(snapshot.meta[key], value);
    assert.equal((await executeAdAction('tenant', task.id, preparedInput)).id, receipt.id);
    assert.equal(writes, before + 4, 'idempotent request cannot create duplicate leads ads');
    await store.update('platform_ad_executions', receipt.id, { status: 'UNKNOWN' });
    const ids = receipt.result as any, adset = saved[ids.adsetId];
    const old = adset.destination_type; adset.destination_type = old === 'ON_VIDEO' ? 'WEBSITE' : 'ON_VIDEO';
    await assert.rejects(reconcileAdExecution('tenant', task.id, receipt.id), /读回/);
    adset.destination_type = old;
    assert.equal((await reconcileAdExecution('tenant', task.id, receipt.id)).status, 'VERIFIED');
    assert.equal(writes, before + 4, 'reconciliation is read-only');
    await assert.rejects(executeAdAction('other-tenant', task.id, input), /未找到/);
    const grant = { accountIds: [connection.id], allowedActions: ['create'], maxDailyBudget: 10, maxTotalBudget: 100, maxAdjustmentPercent: 10, expiresAt: new Date(Date.now() + 86400000).toISOString() };
    const approvalTask = await createPlatformAdTask('tenant', 'user', { name: 'Approval', video: 'Video', goal: item.goal, market: 'US', budget: 100, currency: 'CNY', channels: ['Facebook'] });
    await store.update('platform_ad_tasks', approvalTask.id, { managementMode: 'approval', authorization: grant });
    const approval = await createAdApproval('tenant', 'user', approvalTask.id, { ...input, expectedVersion: approvalTask.version });
    for (const [key, value] of Object.entries(item.extra)) assert.equal((approval.payload.meta as any)[key], value);
    await store.update('platform_ad_tasks', approvalTask.id, { managementMode: 'managed' });
    const launch = await saveAdLaunch('tenant', approvalTask.id, { ...input, expectedVersion: approvalTask.version, launchMode: 'create_paused' });
    for (const [key, value] of Object.entries(item.extra)) assert.equal((launch.meta as any)[key], value);
    assert.equal(writes, before + 4, 'approval and launch preparation cannot call provider writes');
  }
  console.log('Meta lead preflight, execution, immutable snapshot, reconciliation, tenant isolation, approval and launch persistence passed (all 5 Meta goals).');
} finally { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
