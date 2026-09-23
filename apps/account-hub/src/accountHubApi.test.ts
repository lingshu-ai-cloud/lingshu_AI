import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  accountHubApi,
  normalizeAccountHubAccount,
  normalizeAccountHubUsage,
  normalizeTeamUsageSummary,
} from './accountHubApi';

const values = new Map<string, string>([['overseas_token', 'test-session-token']]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage,
});

const accountFixture = {
  id: 'account-1',
  provider: 'codex',
  label: '研发 Codex',
  memberId: 'member-1',
  memberName: '吴小姐',
  status: 'ready',
  enabled: true,
  plan: 'Plus',
  statusDetail: null,
  lastCheckedAt: '2026-09-22T00:00:00.000Z',
  lastUsedAt: null,
  holderMemberId: null,
  deviceLabel: null,
  acquiredAt: null,
  renewedAt: null,
  expiresAt: null,
  localState: {
    state: 'authenticated',
    reportedAt: '2026-09-22T08:00:00.000Z',
    deviceId: 'member-device-1',
    deviceLabel: '研发 Mac',
    email: 'owner@example.test',
    plan: 'Plus',
    authMode: 'chatgpt',
    usage: {
      available: true,
      primary: { remainingPercent: 72, resetsAt: '2026-09-23T00:00:00.000Z' },
      secondary: { remainingPercent: 44, resetsAt: '2026-09-29T00:00:00.000Z' },
      creditsRemaining: 120,
      checkedAt: '2026-09-22T08:00:00.000Z',
    },
  },
  legacyManagedProfilePresent: false,
  transferEligible: true,
  transferBlockedReason: null,
  createdAt: '2026-09-21T00:00:00.000Z',
};

assert.equal(normalizeAccountHubAccount(accountFixture).plan, 'Plus');
assert.equal(normalizeAccountHubAccount(accountFixture).memberId, 'member-1');
assert.equal(normalizeAccountHubAccount(accountFixture).transferEligible, true);
assert.equal(normalizeAccountHubAccount(accountFixture).localState?.usage?.secondary?.remainingPercent, 44);
assert.deepEqual(normalizeAccountHubAccount({ ...accountFixture, transferEligible: false, transferBlockedReason: 'fresh_local_logout_required' }).transferBlockedReasons, [
  { code: 'fresh_local_logout_required', message: null },
]);
assert.equal(normalizeAccountHubAccount({ ...accountFixture, transferEligible: undefined, transferBlockedReason: undefined }).transferEligible, false, 'older servers must not expose transfer actions by default');
assert.throws(
  () => normalizeAccountHubAccount({ ...accountFixture, provider: 'unknown' }),
  /Provider 无效/,
  'unknown providers must be rejected instead of silently displayed',
);

const accountUsageFixture = {
  available: true,
  primary: { remainingPercent: 72, resetsAt: '2026-09-23T00:00:00.000Z' },
  secondary: { remainingPercent: 44, resetsAt: '2026-09-29T00:00:00.000Z' },
  creditsRemaining: 120,
  checkedAt: '2026-09-22T08:00:00.000Z',
};
assert.equal(normalizeAccountHubUsage(accountUsageFixture).primary?.remainingPercent, 72);
assert.equal(normalizeAccountHubUsage({ ...accountUsageFixture, available: false }).primary, null);
assert.throws(() => normalizeAccountHubUsage({ ...accountUsageFixture, primary: { remainingPercent: 101 } }), /剩余百分比无效/);

const usageFixture = {
  range: '7d',
  generatedAt: '2026-09-22T08:00:00.000Z',
  freshness: 'near_realtime',
  accounting: 'telemetry_estimate',
  totals: {
    eventCount: 2,
    inputTokens: 1200,
    cachedInputTokens: 800,
    cacheWriteInputTokens: 0,
    outputTokens: 200,
    reasoningOutputTokens: 50,
    totalTokens: 1400,
  },
  members: [{
    id: 'member-1', name: '吴小姐', enabled: true, online: true,
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-22T08:00:00.000Z', lastSeenAt: '2026-09-22T08:00:00.000Z',
    eventCount: 2, inputTokens: 1200, cachedInputTokens: 800, cacheWriteInputTokens: 0,
    outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 1400,
  }],
  timeline: [{ date: '2026-09-22', inputTokens: 1200, cachedInputTokens: 800, outputTokens: 200, totalTokens: 1400 }],
  recent: [{
    id: 'usage-1', memberId: 'member-1', eventAt: '2026-09-22T08:00:00.000Z', receivedAt: '2026-09-22T08:00:01.000Z',
    conversationHash: 'abc123', model: 'gpt-5.6-terra', source: 'codex_desktop', clientVersion: '0.155.1',
    inputTokens: 1200, cachedInputTokens: 800, cacheWriteInputTokens: 0, outputTokens: 200,
    reasoningOutputTokens: 50, totalTokens: 1400,
  }],
};
assert.equal(normalizeTeamUsageSummary(usageFixture).members[0]?.name, '吴小姐');

let capturedUrl = '';
let capturedInit: RequestInit | undefined;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  capturedUrl = String(input);
  capturedInit = init;
  return new Response(JSON.stringify({ accounts: [accountFixture] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

const accounts = await accountHubApi.listAccounts();
assert.equal(accounts.length, 1);
assert.equal(capturedUrl, '/api/overseas/account-hub/accounts');
assert.equal(new Headers(capturedInit?.headers).get('Authorization'), 'Bearer test-session-token');

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  capturedUrl = String(input);
  capturedInit = init;
  return new Response(JSON.stringify({ account: accountFixture }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;
await accountHubApi.createAccount({ provider: 'codex', label: '研发 Codex', memberId: 'member-1' });
assert.deepEqual(JSON.parse(String(capturedInit?.body)), { provider: 'codex', label: '研发 Codex', memberId: 'member-1' });

await accountHubApi.assignAccountOwner('account-1', 'member-1');
assert.equal(capturedUrl, '/api/overseas/account-hub/accounts/account-1/assign-owner');
assert.deepEqual(JSON.parse(String(capturedInit?.body)), { memberId: 'member-1' });

await accountHubApi.reassignAccountOwner('account-1', 'member-2');
assert.equal(capturedUrl, '/api/overseas/account-hub/accounts/account-1/reassign-owner');
assert.equal(capturedInit?.method, 'POST');
assert.deepEqual(JSON.parse(String(capturedInit?.body)), { memberId: 'member-2' });
assert.ok(new Headers(capturedInit?.headers).get('Idempotency-Key'), 'seat transfers must be idempotent mutations');

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  capturedUrl = String(input);
  capturedInit = init;
  return new Response(JSON.stringify({ summary: usageFixture }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;
const teamUsage = await accountHubApi.teamUsage('7d');
assert.equal(teamUsage.totals.totalTokens, 1400);
assert.equal(capturedUrl, '/api/overseas/account-hub/team/usage?range=7d');
assert.equal(new Headers(capturedInit?.headers).get('Authorization'), 'Bearer test-session-token');

const pageSource = fs.readFileSync(new URL('./AccountHubPage.tsx', import.meta.url), 'utf8');
const accountsPageSource = fs.readFileSync(new URL('./CodexAccountsPage.tsx', import.meta.url), 'utf8');
for (const text of [
  '团队 Codex 用量管理台',
  '成员用量',
  'Token 支出',
  '输入 Token',
  '缓存输入 Token',
  '输出 Token',
  '添加成员',
  '最近 Token 事件',
  '一人一号，只观测不代理',
  '不会保存提示词、代码或工具输出',
  'protocol = \\"json\\"',
  '两个令牌只显示这一次且权限分离',
  '不要把此令牌填入 OTel 配置',
]) {
  assert.match(pageSource, new RegExp(text), `team usage UI must expose ${text}`);
}
assert.match(pageSource, /accountHubApi\.teamUsage/, 'dashboard must poll aggregated team usage');
assert.match(pageSource, /log_user_prompt = false/, 'OTel setup must keep prompt logging disabled');
for (const text of [
  'AI 账号',
  '绑定成员',
  '本机认证，最小化上报',
  '最后心跳',
  '协调锁由本机连接器维护',
  '仅本地释放',
  '不会修改成员电脑的 Provider 登录状态',
  '协调锁占用',
  '暂不可获取',
  'Primary',
  'Secondary',
  'Credits 剩余',
  '不提供服务端登录、额度探测或账号轮换',
  '绑定现有账号归属',
  '绑定后不可更改',
  '协调锁不是 Provider 的强制锁',
  '无法阻止成员绕过中台、直接启动官方客户端',
  '发现旧版服务端托管凭据目录',
  '管理台不会自动删除',
  'pnpm account-hub:connector -- --config',
  '--watch --hold',
  '一次性状态测试可省略',
  '0600',
  '手动填入',
  '成员连接器令牌',
  '不要填遥测令牌',
  '两种令牌权限分离',
  '心跳快照 · 页面约 10 秒刷新',
  '并非 Provider 实时在线证明',
  '结合“最后心跳”判断新鲜度',
  '切换自己的账号',
  '转交账号席位',
  '不会转移、取消或共享 Pro 订阅',
  '目标成员必须在自己的电脑登录自己的账号',
  '原生存储或系统钥匙链保持',
  'auth.json',
  '账号占用中',
  '本机快照缺失或已过期',
  '遗留服务端托管凭据',
  '目标成员已有同 Provider 账号槽位',
]) {
  assert.match(accountsPageSource, new RegExp(text), `account ownership UI must expose ${text}`);
}
assert.match(accountsPageSource, /account\.memberId\.startsWith\('legacy_unassigned:'\)/, 'only legacy accounts may expose one-time owner assignment');
assert.match(accountsPageSource, /accountId: account\.id/, 'the connector config must bind to the selected account');
assert.match(accountsPageSource, /connectorToken:/, 'connector config must use a connector-scoped token');
assert.match(accountsPageSource, /account\.transferEligible &&/, 'transfer controls must only render when the server marks the account eligible');
assert.match(accountsPageSource, /accountHubApi\.reassignAccountOwner/, 'eligible transfers must call the dedicated owner reassignment endpoint');
assert.match(accountsPageSource, /await load\(true\)/, 'the page must refresh server state after a transfer');
assert.doesNotMatch(accountsPageSource, /ingestToken/, 'connector config must never reuse the telemetry ingest token');
assert.doesNotMatch(accountsPageSource, /type=["']password["']/, 'the account page must never collect an upstream password');

const apiSource = fs.readFileSync(new URL('./accountHubApi.ts', import.meta.url), 'utf8');
assert.doesNotMatch(apiSource + accountsPageSource, /createTask|listTasks|cancelTask|taskEvents|AccountHubTask|permissionMode|workspacePath|\/tasks/, 'the standalone frontend must not expose web task dispatch');
assert.doesNotMatch(apiSource + accountsPageSource, /authorizeAccount|checkAccount|accountUsage\(|revokeAccount|authorizationEvents|cancelAuthorization|\/accounts[^'"`]*\/(?:authorize|check|usage|revoke|logout)/, 'member-local mode must not expose server credential operations');
assert.doesNotMatch(apiSource + accountsPageSource, /acquireAccount|releaseLocalAccount|\/accounts[^'"`]*\/(?:acquire|local-release)/, 'the admin page must not hold member credentials or mutate connector leases');
assert.doesNotMatch(accountsPageSource, /remove.*legacy|delete.*profile|自动删除按钮/i, 'legacy managed profiles must require manual migration');

console.log('account hub API and UI contract tests passed');
