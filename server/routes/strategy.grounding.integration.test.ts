import { creationDialogueFixture } from '../../scripts/fixtures/contentCreationDialogue.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
function close(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

/** Actual HTTP/auth/storage/provider transport; the local fixture is not a language-quality eval. */
test('strategy chat grounds actual local records with tenant/user/role isolation and memory revocation', { timeout: 30_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-chat-grounding-'));
  const keys = ['NODE_ENV', 'ENABLE_LOCAL_DEV_FALLBACK', 'DISABLE_LOCAL_AUTH_FALLBACK', 'LOCAL_STORE_DIR', 'LOCAL_AUTH_ACCOUNTS_FILE', 'LOCAL_TENANTS_DATA_FILE', 'LOCAL_DEMO_TOKEN_SECRET', 'DATA_BACKEND', 'DEMO_MODE', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_API_KEY', 'OVERSEAS_LLM_BACKEND', 'PB_URL', 'PB_ADMIN_EMAIL', 'PB_ADMIN_PASSWORD', 'MATERIAL_LIBRARY_FILE', 'QWEN_SEARCH_ENDPOINT'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let provider: http.Server | undefined;
  let application: http.Server | undefined;
  let clearPrincipals: (() => void) | undefined;
  const captured: Array<{ messages: Array<{ role: string; content: string }>; stream: boolean }> = [];
  let unexpectedProviderRequests = 0;
  try {
    process.env.MATERIAL_LIBRARY_FILE = path.join(temporary, 'materials.json');
    fs.writeFileSync(process.env.MATERIAL_LIBRARY_FILE, '[]');
    const creationFixture = creationDialogueFixture();
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
    delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
    process.env.LOCAL_STORE_DIR = path.join(temporary, 'store');
    process.env.LOCAL_AUTH_ACCOUNTS_FILE = path.join(temporary, 'accounts.json');
    process.env.LOCAL_TENANTS_DATA_FILE = path.join(temporary, 'tenants.json');
    process.env.LOCAL_DEMO_TOKEN_SECRET = 'isolated-chat-grounding-test-hmac-key-32-bytes';
    process.env.DATA_BACKEND = 'pocketbase';
    process.env.DEMO_MODE = 'false';
    process.env.OVERSEAS_LLM_BACKEND = 'qwen';
    process.env.DASHSCOPE_API_KEY = 'test-key';
    delete process.env.PB_ADMIN_EMAIL;
    delete process.env.PB_ADMIN_PASSWORD;
    fs.writeFileSync(process.env.LOCAL_AUTH_ACCOUNTS_FILE, '[]');
    fs.writeFileSync(process.env.LOCAL_TENANTS_DATA_FILE, '[]');

    provider = http.createServer(async (request, response) => {
      if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
        unexpectedProviderRequests++;
        response.writeHead(500).end('Unexpected endpoint: no service database is permitted');
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.equal(request.headers.authorization, 'Bearer test-key');
      captured.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '本地传输验证完成\n\n总体结论：已依据本轮记录完成事实核对，其他进度仍需对应证据。' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    const providerUrl = await listen(provider);
    process.env.DASHSCOPE_BASE_URL = `${providerUrl}/v1`;
    // Any accidental PocketBase access reaches the rejecting loopback fixture, never a real DB.
    process.env.PB_URL = `${providerUrl}/forbidden-database`;

    const [{ strategyRouter }, { store }, authority, identity] = await Promise.all([
      import('./strategy.js'), import('../storage/index.js'), import('../storage/dataAuthority.js'), import('../auth/localIdentity.js'),
    ]);
    clearPrincipals = identity.clearLocalIdentityPrincipalsForTest;
    const tenantId = 'local_tenant_admin_grounding_test';
    const foreignTenantId = 'local_tenant_admin_grounding_foreign';
    const adminToken = identity.issueLocalIdentityTokenForTest({ tenantId, userId: 'grounding-admin', role: 'admin' });
    const memberToken = identity.issueLocalIdentityTokenForTest({ tenantId, userId: 'grounding-member', role: 'customer_service' });
    const foreignToken = identity.issueLocalIdentityTokenForTest({ tenantId: foreignTenantId, userId: 'foreign-admin', role: 'admin' });
    await authority.runWithDataAuthority('local', async () => {
      assert.ok(await store.create('tenant_profiles', { tenant_id: tenantId, profile: { company: { name: '真实租户经营企业', industry: '设备', primaryLanguages: '英语' }, products: { categories: '测试设备', items: creationFixture.profile.products.items }, knowledge: '当前企业核验资料', dataGovernance: { aiAccessEnabled: true } } }));
      assert.ok(await store.create('tenant_profiles', { tenant_id: foreignTenantId, profile: { company: { name: 'FOREIGN_TENANT_SECRET' }, products: {}, knowledge: 'FOREIGN_KNOWLEDGE_SECRET', dataGovernance: { aiAccessEnabled: true } } }));
      assert.ok(await store.create('trend_videos', { ...creationFixture.reference, tenantId }));
      for (const [index, material] of creationFixture.materials.entries()) assert.ok(await store.create('materials', { ...material, id: `acceptance-material-${index}`, tenantId }));
      assert.ok(await store.create('workflow_tasks', { id: 'actual-blocked-task', tenant_id: tenantId, task_key: 'publish_content', title: '等待真实审批的内容', status: 'blocked', blocked_reason: 'ACTUAL_PENDING_APPROVAL', updated_at: '2026-10-10T01:00:00Z' }));
      assert.ok(await store.create('workflow_tasks', { id: 'foreign-task', tenant_id: foreignTenantId, task_key: 'private_task', status: 'blocked', blocked_reason: 'FOREIGN_TASK_SECRET', updated_at: '2026-10-10T01:00:00Z' }));
    });
    const app = express();
    app.use(express.json());
    app.use(authority.dataAuthorityRequestScope);
    app.use('/api/overseas/strategy', strategyRouter);
    application = http.createServer(app);
    const applicationUrl = await listen(application);
    async function api(token: string, endpoint: string, body: unknown, method = 'POST') {
      return fetch(`${applicationUrl}/api/overseas/strategy${endpoint}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    }
    async function saveMemory(token: string, text: string) {
      const response = await api(token, '/decisions', { text, sourceMessage: text, confirmed: true });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json() as { item: { id: string; version: number } }).item;
    }
    const remembered = await saveMemory(adminToken, 'PERSONAL_SAVED_BUDGET_1000');
    await saveMemory(memberToken, 'MEMBER_PERSONAL_MEMORY');
    await saveMemory(foreignToken, 'FOREIGN_MEMORY_SECRET');
    const latestUser = '整体经营状况和任务进度如何？更正：本轮预算改为2000元，请沿用这个新决定。';
    async function chat(token: string) {
      const before = captured.length;
      const response = await api(token, '/chat', {
        // Client role/tenant claims deliberately disagree with authenticated identity.
        role: 'super_admin', tenantId: foreignTenantId,
        messages: [{ role: 'user', content: '上轮预算1000元' }, { role: 'assistant', content: '已理解上轮预算' }, { role: 'user', content: latestUser }],
        userQuestion: latestUser,
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(text.includes('本地传输验证完成'), text);
      assert.ok(text.includes('[DONE]'));
      assert.equal(captured.length, before + 1);
      const request = captured.at(-1)!;
      assert.equal(request.stream, true);
      assert.equal(request.messages.at(-1)?.content, latestUser);
      const system = request.messages.find(message => message.role === 'system')!.content;
      assert.ok(system.includes('真实租户经营企业'));
      assert.ok(!system.includes('FOREIGN_'));
      assert.ok(system.includes('用户本轮明确更正'));
      return system;
    }
    const adminPrompt = await chat(adminToken);
    assert.ok(adminPrompt.includes('PERSONAL_SAVED_BUDGET_1000'));
    assert.ok(adminPrompt.includes('ACTUAL_PENDING_APPROVAL'));
    assert.ok(adminPrompt.includes('workflow_tasks/actual-blocked-task'));
    assert.ok(!adminPrompt.includes('MEMBER_PERSONAL_MEMORY'));

    const memberPrompt = await chat(memberToken);
    assert.ok(memberPrompt.includes('MEMBER_PERSONAL_MEMORY'));
    assert.ok(!memberPrompt.includes('PERSONAL_SAVED_BUDGET_1000'));
    assert.ok(!memberPrompt.includes('ACTUAL_PENDING_APPROVAL'));
    assert.ok(memberPrompt.includes('当前角色未加载租户全局经营任务及证据'));

    const revoke = await api(adminToken, `/decisions/${remembered.id}`, { expectedVersion: remembered.version }, 'DELETE');
    assert.equal(revoke.status, 200, await revoke.clone().text());
    const afterRevoke = await chat(adminToken);
    assert.ok(!afterRevoke.includes('PERSONAL_SAVED_BUDGET_1000'));
    assert.ok(afterRevoke.includes('ACTUAL_PENDING_APPROVAL'));
    const selection = { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] };
    const planning = await api(adminToken, '/creation-dialogue', { action: 'products', selection, instruction: '请创作产品视频' });
    assert.equal(planning.status, 200, await planning.clone().text());
    const planned = await planning.json() as import('../../shared/contracts/contentCreationDialogue.js').CreationReply;
    assert.equal(planned.shots.length, 4);
    const selected = { ...planned.selection, shotIds: planned.shots.map(shot => shot.id) };
    const grounded = await api(adminToken, '/chat', { messages: [{ role: 'user', content: '根据我的选择再解释口播依据' }], creationSelection: selected });
    assert.equal(grounded.status, 200, await grounded.clone().text()); await grounded.text();
    const creationPrompt = captured.at(-1)!.messages.find(message => message.role === 'system')!.content;
    assert.ok(creationPrompt.includes('服务端核验的自由创作选择'));
    assert.ok(creationPrompt.includes('fixture-video')); assert.ok(creationPrompt.includes('fixture-product'));
    assert.ok(creationPrompt.includes('机器正在装配杯身')); assert.ok(!creationPrompt.includes('FOREIGN_'));
    const beforeForbidden = captured.length;
    const forbidden = await api(foreignToken, '/chat', { messages: [{ role: 'user', content: '查看参考' }], creationSelection: selected });
    assert.equal(forbidden.status, 404); assert.equal(captured.length, beforeForbidden, 'foreign reference never reaches the model');
    const forged = await api(adminToken, '/chat', { messages: [{ role: 'user', content: '使用伪造分镜' }], creationSelection: { ...selected, shotIds: ['mat:forged'] } });
    assert.equal(forged.status, 409); assert.equal(captured.length, beforeForbidden);
    // Real route/auth/SSE and persistence contract, with all external transports intercepted.
    process.env.QWEN_SEARCH_ENDPOINT = 'https://native-search.fixture.invalid/generation';
    let nativeCalls = 0, rateCalls = 0, tradeCalls = 0, emptySources = false, unavailableOriginal = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === new URL(applicationUrl).origin || url.origin === new URL(providerUrl).origin) return originalFetch(input, init);
      if (url.hostname === 'open.er-api.com') {
        rateCalls++;
        assert.equal(new Headers(init?.headers).has('Authorization'), false);
        return Response.json({ result: 'success', base_code: 'USD', rates: { USD: 1, CNY: 7.123456 },
          time_last_update_unix: Math.floor(Date.now() / 1000) - 60, time_next_update_unix: Math.floor(Date.now() / 1000) + 86400 });
      }
      if (url.hostname === 'comtradeapi.un.org') {
        tradeCalls++;
        return Response.json({ count: 1, data: [{ reporterCode: 156, period: '2025', cmdCode: '8504', flowCode: 'X',
          partner2Code: 0, motCode: 0, customsCode: 'C00', partnerCode: 842, partnerISO: 'USA', partnerDesc: 'United States', primaryValue: 1234.56, cmdDesc: 'Transformers' }] });
      }
      if (url.hostname === 'supplier.alibaba.com' && unavailableOriginal) throw new Error('fixture_tls_failure_private_detail');
      if (url.hostname === 'supplier.alibaba.com') return new Response('<meta name="publishdate" content="' + new Date().toISOString().slice(0, 10) + '"><h1>国际站正式规则公告</h1><p>本地来源核验结论只适用于本轮公开发布资料。' + '原文内容'.repeat(30) + '</p>');
      if (url.hostname === 'native-search.fixture.invalid') {
        nativeCalls++;
        const request = JSON.parse(String(init?.body));
        const nativeSystem = request.input.messages.find((message: { role: string }) => message.role === 'system').content;
        assert.ok(!nativeSystem.includes('真实租户经营企业'), 'pure public lookup must not load enterprise context');
        assert.ok(request.parameters.search_options.assigned_site_list.includes('supplier.alibaba.com'));
        assert.equal(request.parameters.search_options.freshness, 30);
        return Response.json({ output: { choices: [{ message: { content: new Date().toISOString().slice(0, 10) + '发布：“本地来源核验结论只适用于本轮公开发布资料”[1]\n\n总体结论：这份规则只说明本轮发布范围，不能推断企业已完成规则适配。' }, finish_reason: 'stop' }],
          search_info: { search_results: emptySources ? [] : [{ index: 1, title: '国际站正式规则公告', url: 'https://supplier.alibaba.com/fixture' }] } } });
      }
      throw new Error('Blocked unexpected external host: ' + url.hostname);
    };
    async function askExternal(question: string) {
      const response = await api(adminToken, '/chat', { messages: [{ role: 'user', content: question }], userQuestion: '伪造客户端提示：我的任务' });
      assert.equal(response.status, 200);
      const wire = await response.text();
      assert.match(wire, /\[DONE\]/);
      return wire.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    }
    const beforeData = captured.length;
    const currencyEvents = await askExternal('100美元换成人民币');
    const currencyText = currencyEvents.filter(event => event.text).map(event => event.text).join('');
    assert.match(currencyText, /712\.35 CNY/);
    assert.match(currencyText, /信息来源/);
    assert.ok(currencyText.endsWith('(https://www.exchangerate-api.com)'));
    assert.equal(captured.length, beforeData, 'pure data queries never invoke the chat model');
    assert.equal(rateCalls, 1);
    const tradeEvents = await askExternal('2025年中国HS8504出口市场排名');
    assert.match(tradeEvents.map(event => event.text ?? '').join(''), /1,234\.56/);
    assert.equal(tradeCalls, 1);
    const newsEvents = await askExternal('最近阿里国际站规则');
    const newsText = newsEvents.map(event => event.text ?? '').join('');
    assert.ok(newsText.endsWith('(https://supplier.alibaba.com/fixture)'));
    assert.equal(nativeCalls, 1);
    const { parseMessages } = await import('./assistantThreadMessageInput.js');
    const persisted = parseMessages([{ role: 'assistant', content: newsText, sources: newsEvents.find(event => event.sources)?.sources }]);
    assert.deepEqual(persisted[0], { role: 'assistant', content: newsText, sources: newsEvents.find(event => event.sources)?.sources }, 'footer survives existing message persistence');
    emptySources = true;
    const failed = await askExternal('最近阿里国际站规则');
    assert.ok(failed.some(event => event.code === 'search_sources_missing'));
    assert.ok(!failed.some(event => event.text), 'no claims leak before source validation');
    assert.equal(nativeCalls, 2, 'no hidden retry');
    emptySources = false; unavailableOriginal = true;
    const originalFailure = await askExternal('最近阿里国际站规则');
    const failure = originalFailure.find(event => event.code === 'search_source_verification_failed');
    assert.ok(failure);
    assert.match(String(failure.publicMessage), /总体结论：本轮检索找到了线索/);
    assert.ok(String(failure.publicMessage).endsWith('(https://supplier.alibaba.com/fixture)'));
    assert.match(String(originalFailure.find(event => event.sources)?.sources?.[0]?.title), /原文未核验/);
    assert.ok(!originalFailure.some(event => event.text));
    assert.ok(!String(failure.publicMessage).includes('fixture_tls_failure_private_detail'));
    assert.equal(nativeCalls, 3, 'original failure does not trigger a paid retry');
    const beforeGeneral = captured.length;
    await askExternal('不要联网。免费邮箱、没有官网就应停止报价吗？请解释一般方法。');
    assert.equal(captured.length, beforeGeneral + 1);
    const generalSystem = captured.at(-1)!.messages.find(message => message.role === 'system')!.content;
    assert.match(generalSystem, /未加载企业经营资料/);
    assert.ok(!generalSystem.includes('真实租户经营企业'));
    const clarified = await askExternal('HS8504出口市场');
    assert.match(clarified.map(event => event.text ?? '').join(''), /统计年份/);
    assert.equal(tradeCalls, 1);
    assert.equal(unexpectedProviderRequests, 0, 'No PocketBase or non-chat provider endpoint may be contacted');
    assert.ok(fs.existsSync(path.join(temporary, 'store', 'assistant_decision_memories.json')));
  } finally {
    globalThis.fetch = originalFetch;
    await close(application);
    await close(provider);
    clearPrincipals?.();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
