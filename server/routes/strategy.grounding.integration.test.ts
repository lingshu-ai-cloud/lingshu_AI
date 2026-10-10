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
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-chat-grounding-'));
  const keys = ['NODE_ENV', 'ENABLE_LOCAL_DEV_FALLBACK', 'DISABLE_LOCAL_AUTH_FALLBACK', 'LOCAL_STORE_DIR', 'LOCAL_AUTH_ACCOUNTS_FILE', 'LOCAL_TENANTS_DATA_FILE', 'LOCAL_DEMO_TOKEN_SECRET', 'DATA_BACKEND', 'DEMO_MODE', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_API_KEY', 'OVERSEAS_LLM_BACKEND', 'PB_URL', 'PB_ADMIN_EMAIL', 'PB_ADMIN_PASSWORD'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let provider: http.Server | undefined;
  let application: http.Server | undefined;
  let clearPrincipals: (() => void) | undefined;
  const captured: Array<{ messages: Array<{ role: string; content: string }>; stream: boolean }> = [];
  let unexpectedProviderRequests = 0;
  try {
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
      response.write(`data: ${JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '本地传输验证完成' }, finish_reason: null }] })}\n\n`);
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
      assert.ok(await store.create('tenant_profiles', { tenant_id: tenantId, profile: { company: { name: '真实租户经营企业', industry: '设备', primaryLanguages: '英语' }, products: { categories: '测试设备' }, knowledge: '当前企业核验资料', dataGovernance: { aiAccessEnabled: true } } }));
      assert.ok(await store.create('tenant_profiles', { tenant_id: foreignTenantId, profile: { company: { name: 'FOREIGN_TENANT_SECRET' }, products: {}, knowledge: 'FOREIGN_KNOWLEDGE_SECRET', dataGovernance: { aiAccessEnabled: true } } }));
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
    assert.equal(unexpectedProviderRequests, 0, 'No PocketBase or non-chat provider endpoint may be contacted');
    assert.ok(fs.existsSync(path.join(temporary, 'store', 'assistant_decision_memories.json')));
  } finally {
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
