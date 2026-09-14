import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STARTER_198_CAPABILITIES, STARTER_AGENT_ROLES } from '../../shared/contracts/starter198.js';
import {
  fetchStarterArtifact,
  normalizeStarterWorkspace,
  resolveProductProfile,
  shouldBypassStarter198Probe,
  starterWorkspaceApi,
  starterWorkspaceCommandTargetId,
} from './starterWorkspace.js';
import { deriveStarterWorkflowSpotlight } from '../components/starter/StarterWorkflowOverview.js';

function workspacePayload(overrides: Record<string, unknown> = {}) {
  const capabilities = Object.fromEntries(STARTER_198_CAPABILITIES.map(capability => [
    capability,
    { allowed: capability === 'workspace.read', reason: capability === 'workspace.read' ? 'allowed' : 'profile_denied' },
  ]));
  return {
    productProfile: 'starter_198',
    generatedAt: '2026-09-12T08:00:00.000Z',
    greeting: null,
    capabilityManifest: {
      schemaVersion: 'starter-198.capabilities.v1',
      productProfile: 'starter_198',
      profileVersion: 'starter_198.v1',
      entitlementSnapshotId: 'entitlement-1',
      generatedAt: '2026-09-12T08:00:00.000Z',
      capabilities,
      resourceLimits: {
        workspaceCount: 1,
        brandCount: 1,
        memberCount: 3,
        agentTeamCount: 1,
        productCount: 1,
        marketCount: 1,
        buyerPersonaCount: 1,
        languageCount: 2,
        primaryPlatformCount: 2,
        concurrentRunCount: 1,
        contentArtifactCountPerCycle: 5,
        contentRevisionCountPerCycle: 2,
        publicationPackageCountPerContent: 1,
        assistedSessionCount: 0,
        inquiryAiCountPerCycle: 20,
        quoteDraftCountPerCycle: 10,
        highCostVideoCount: 0,
        budgetCnyPerCycle: 20,
        agentBudgetCny: Object.fromEntries(STARTER_AGENT_ROLES.map(role => [role, 5])),
      },
    },
    run: {},
    today: {},
    decisions: [],
    results: {},
    agents: [],
    productionSites: [],
    controls: [],
    ...overrides,
  };
}

assert.throws(
  () => normalizeStarterWorkspace({ productProfile: 'starter_198' }),
  /权限清单缺失/,
  'a missing capability manifest must fail closed',
);
const missingCapabilityPayload = workspacePayload();
delete ((missingCapabilityPayload.capabilityManifest as Record<string, unknown>).capabilities as Record<string, unknown>)['production_site.read'];
assert.throws(
  () => normalizeStarterWorkspace(missingCapabilityPayload),
  /权限清单缺失/,
  'every canonical capability decision is required before the workspace renders',
);
assert.throws(
  () => normalizeStarterWorkspace(workspacePayload({ capabilityManifest: {
    schemaVersion: 'starter-198.capabilities.v1',
    productProfile: 'starter_198',
    profileVersion: 'starter_198.v1',
    entitlementSnapshotId: 'entitlement-1',
    generatedAt: '2026-09-12T08:00:00.000Z',
    capabilities: Object.fromEntries(STARTER_198_CAPABILITIES.map(capability => [capability, { allowed: false, reason: 'profile_denied' }])),
    resourceLimits: {},
  } })),
  /权限清单缺失/,
  'resource limits must be complete and validated instead of cast from an empty object',
);
assert.throws(
  () => normalizeStarterWorkspace(workspacePayload({ productProfile: 'advanced_customer' })),
  /产品能力未开通/,
  'the starter renderer must reject any other product profile',
);

const empty = normalizeStarterWorkspace(workspacePayload());
assert.deepEqual(empty.agents.map(agent => agent.role), ['orchestrator', 'content', 'traffic', 'sales']);
for (const agent of empty.agents) {
  assert.deepEqual(agent.tokens, { input: null, output: null, cache: null, total: null });
  assert.deepEqual(agent.costCny, { estimated: null, reserved: null, settled: null, settlementStatus: 'unknown', updatedAt: null });
  assert.deepEqual(agent.budgetCny, { total: null, used: null, reserved: null, remaining: null, projectedOverrun: null });
  assert.deepEqual(agent.outputs, { completed: null, usable: null, awaitingDecision: null, summary: null });
}

const populated = normalizeStarterWorkspace(workspacePayload({
  agents: [{
    role: 'content',
    displayName: '灵小图',
    status: 'running',
    tokens: { input: 120, output: 30, cache: 40, total: 190 },
    costCny: { estimated: 0.25, reserved: 0.3, settled: null, settlementStatus: 'pending' },
    budgetCny: { total: 8, used: 0.25, reserved: 0.3, remaining: 7.45, projectedOverrun: false },
    outputs: { completed: 1, usable: 1, awaitingDecision: 0, summary: '完成首发内容' },
    waits: { count: 1, reasons: ['等待内容审批'] },
  }],
  controls: [
    { id: 'pause', label: '暂停', command: 'pause_run', kind: 'secondary' },
    { id: 'unsafe', label: '直接命令子 Agent', command: 'child_agent_write', kind: 'primary' },
    { id: 'download', label: '下载发布包', command: null, kind: 'download', href: '/api/overseas/starter-198/packages/p1/download' },
  ],
}));
const content = populated.agents.find(agent => agent.role === 'content')!;
assert.equal(content.tokens.total, 190);
assert.equal(content.costCny.settled, null, 'pending settlement must remain unknown rather than zero');
assert.deepEqual(content.waits, { count: 1, reasons: ['等待内容审批'] });
assert.deepEqual(populated.controls.map(action => action.command), ['pause_run', null], 'unknown child-agent commands must not render, while downloads need no fake command');
assert.equal(populated.controls[1].href, 'http://localhost/api/overseas/starter-198/packages/p1/download');

const blocked = normalizeStarterWorkspace(workspacePayload({
  run: { id: 'run-blocked', status: 'blocked' },
  agents: [{ role: 'sales', status: 'blocked' }],
}));
assert.equal(blocked.run.status, 'blocked');
assert.equal(blocked.agents.find(agent => agent.role === 'sales')?.status, 'blocked');

const parallelWorkflow = normalizeStarterWorkspace(workspacePayload({
  run: { id: 'run-parallel', status: 'running' },
  today: {
    inProgress: [
      { id: 'content-running', what: '生产本轮内容', ownerAgent: 'content', status: 'running' },
      { id: 'sales-running', what: '整理询盘必要字段', ownerAgent: 'sales', status: 'running' },
    ],
    nextSteps: [{
      id: 'traffic-next', what: '生成平台发布包', ownerAgent: 'traffic', status: 'pending',
      why: '内容放行后才允许生成发布包',
    }],
  },
  agents: [{ role: 'content', status: 'running' }, { role: 'sales', status: 'running' }],
}));
const parallelSpotlight = deriveStarterWorkflowSpotlight(parallelWorkflow);
assert.equal(parallelSpotlight.currentTitle, '灵小图、灵小售正在推进 2 项任务');
assert.equal(parallelSpotlight.currentDetail, '生产本轮内容', 'the overview must use a projected task instead of inventing client-side progress');
assert.equal(parallelSpotlight.nextTitle, '生成平台发布包');
assert.deepEqual(parallelSpotlight.currentNodeIds, ['content', 'sales']);

const decisionWorkflow = normalizeStarterWorkspace(workspacePayload({
  run: { id: 'run-decision', status: 'waiting_user' },
  decisions: [{
    id: 'approval-content', type: 'content_release_approval', title: '确认内容发布版本',
    summary: '核对冻结内容版本', riskLevel: 'L1',
  }],
}));
const decisionSpotlight = deriveStarterWorkflowSpotlight(decisionWorkflow);
assert.equal(decisionSpotlight.currentTitle, '需要你处理：确认内容发布版本');
assert.equal(decisionSpotlight.nextTitle, '下一步：灵小量准备发布包');
assert.match(decisionSpotlight.nextDetail, /不会授权平台自动发布/);
assert.deepEqual(decisionSpotlight.currentNodeIds, ['human']);

const evidenceWorkflow = normalizeStarterWorkspace(workspacePayload({
  run: { id: 'run-evidence', status: 'waiting_user' },
  results: {
    artifacts: [{
      id: 'publication-package-1', title: 'instagram 发布包', kind: 'publication_package',
      status: 'awaiting_user_publish', agentRole: 'traffic', evidence: '发布包内容摘要已锁定',
      actions: [{ id: 'evidence-1', label: '提交发布证据', command: 'submit_publication_evidence', kind: 'primary' }],
    }],
  },
}));
const evidenceSpotlight = deriveStarterWorkflowSpotlight(evidenceWorkflow);
assert.equal(evidenceSpotlight.currentTitle, '需要你处理：instagram 发布包');
assert.equal(evidenceSpotlight.nextTitle, '下一步：提交发布证据');
assert.match(evidenceSpotlight.nextDetail, /完成前系统不会把外部动作记为成功/);

const completedWorkflow = normalizeStarterWorkspace(workspacePayload({
  run: { id: 'run-completed', status: 'completed' },
}));
assert.deepEqual(deriveStarterWorkflowSpotlight(completedWorkflow).currentNodeIds, ['summary']);

const quotePayload = workspacePayload({
  today: {
    nextSteps: [{
      id: 'quote-self-service:inquiry',
      what: '录入询盘并生成智能报价',
      ownerAgent: 'sales',
      status: 'ready',
      output: '当前规则：CUP-500-BLK · 3',
      next: '只录入数量、目的国和外部询盘引用',
      actions: [{
        id: 'quote-inquiry:new', label: '录入询盘并报价', command: 'submit_quote_inquiry',
        kind: 'primary', disabledReason: 'starter_198_quote_self_service_unavailable',
      }],
    }],
  },
});
((quotePayload.capabilityManifest as { capabilities: Record<string, { allowed: boolean; reason: string }> })
  .capabilities['quotation.calculate']) = { allowed: true, reason: 'allowed' };
const normalizedQuoteCard = normalizeStarterWorkspace(quotePayload).today.nextSteps[0];
assert.equal(normalizedQuoteCard.id, 'quote-self-service:inquiry');
assert.equal(normalizedQuoteCard.ownerAgent, 'sales');
assert.equal(normalizedQuoteCard.actions[0]?.command, 'submit_quote_inquiry');
assert.equal(normalizedQuoteCard.actions[0]?.disabledReason, 'starter_198_quote_self_service_unavailable',
  'the frontend must preserve a truthful disabled reason instead of rendering an executable quote action');

for (const command of ['confirm_initial_setup', 'confirm_quote_rule', 'submit_quote_inquiry', 'submit_orchestrator_input'] as const) {
  assert.equal(
    starterWorkspaceCommandTargetId(command, 'quote-self-service:presentation-card'),
    undefined,
    `${command} must not send a presentation-only card id as targetId`,
  );
}
assert.equal(starterWorkspaceCommandTargetId('pause_run', ' run-1 '), 'run-1');
assert.equal(starterWorkspaceCommandTargetId('resolve_decision', 'approval-1'), 'approval-1');
assert.equal(starterWorkspaceCommandTargetId('submit_publication_evidence', 'package-1'), 'package-1');

assert.equal(resolveProductProfile({
  user: { id: 'u1', email: 'user@example.com', name: 'U', tenantId: 't1', role: 'super_admin' },
  tenant: { id: 't1', name: 'T', subscriptionStatus: 'active', subscriptionPlan: 'starter_198', subscriptionExpiresAt: null },
}), null, 'purchase/subscription plan must never infer the product profile');
const presentationAdminSession = {
  user: { id: 'u-admin-label', email: 'customer@example.com', name: 'Customer', tenantId: 't-admin-label', role: 'super_admin' as const },
  tenant: { id: 't-admin-label', name: 'Customer', subscriptionStatus: 'active', subscriptionPlan: 'admin', subscriptionExpiresAt: null },
  subscription: { status: 'active', plan: 'admin', expiresAt: null },
};
assert.equal(shouldBypassStarter198Probe(presentationAdminSession), false,
  'an admin subscription label alone must still probe the authoritative product profile');
assert.equal(shouldBypassStarter198Probe({ ...presentationAdminSession, platformAdmin: true }), true,
  'only a server-verified platform admin may bypass the customer product-profile probe');
assert.equal(shouldBypassStarter198Probe({
  ...presentationAdminSession,
  supportAccess: { requestId: 'support-1', adminEmail: 'support@example.com', tenantName: 'Customer' },
}), true, 'an explicit read-only support session keeps its internal observation surface');

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const authRouteSource = fs.readFileSync('server/routes/auth.ts', 'utf8');
const layoutSource = fs.readFileSync('src/components/Layout.tsx', 'utf8');
const clientSource = fs.readFileSync('src/lib/starterWorkspace.ts', 'utf8');
const starterPageSource = fs.readFileSync('src/components/starter/StarterWorkspacePage.tsx', 'utf8');
const workflowContextSource = fs.readFileSync('src/components/starter/StarterWorkflowContextBar.tsx', 'utf8');
const productionSiteSource = fs.readFileSync('src/components/starter/StarterProductionSitePage.tsx', 'utf8');
const productionSiteViewsSource = fs.readFileSync('src/components/starter/StarterProductionSiteViews.tsx', 'utf8');
const workflowOverviewSource = fs.readFileSync('src/components/starter/StarterWorkflowOverview.tsx', 'utf8');
for (const [page, component] of [
  ['traffic', 'TrafficPage'],
  ['socialInspiration', 'TrafficPage'],
  ['conversion', 'ConversionPage'],
] as const) {
  assert.match(appSource, new RegExp(`\\{page === '${page}' && \\([\\s\\S]*?<${component}`), `starter mode must keep the original ${page} product page`);
}
assert.match(appSource, /\{\(page === 'smartAssets' \|\| smartAssetsMounted\) && \(/, 'starter mode must keep the original content studio');
assert.doesNotMatch(appSource, /StarterProductionSitePage/, 'starter pages must no longer replace the original product UI with a simplified projection');
assert.match(appSource, /starterMode && page !== 'digitalEmployees'[\s\S]*?<StarterWorkflowContextBar/, 'restored pages must explain their position in the AI workflow');
assert.match(appSource, /!starterMode && !isAgentProductionSession\(\) && <GlobalAssistant/, 'starter mode must remove the parallel chat launcher');
assert.match(appSource, /shouldBypassStarter198Probe\(session\)/, 'the app must use the tested authoritative-probe policy');
assert.doesNotMatch(appSource, /session\.supportAccess \|\| isAdminSession\(session\)/,
  'a subscription-plan presentation label must not bypass the authoritative starter access probe');
assert.match(authRouteSource, /platformAdmin:\s*Boolean\(await requireAdminUser\(req\)\)/,
  'the explicit platform-admin signal must come from the hardened server identity check');
assert.equal(authRouteSource.match(/platformAdmin:\s*Boolean\(await requireAdminUser\(req\)\)/g)?.length, 2,
  'both local and persistent /auth/me responses must emit the verified platform-admin signal');
for (const source of [appSource, layoutSource]) {
  assert.match(source, /!session(?:\?|)\.supportAccess && session(?:\?|)\.platformAdmin === true/,
    'admin navigation must depend only on the verified platform-admin signal');
  assert.doesNotMatch(source, /subscriptionPlan === 'admin'|subscription\?\.plan === 'admin'|lingshu-admin@local\.test/,
    'email and subscription labels must never unlock platform-admin UI');
}
for (const navigationLabel of ['经营概览', '灵感中心', '内容创作', '脚本库', '投流与发布', '账号管理', '我的会话', '订单管理', '企业知识库', '定时任务', '集成中心', '组织与权限']) {
  assert.match(layoutSource, new RegExp(navigationLabel), `starter navigation must preserve the ${navigationLabel} page`);
}
assert.doesNotMatch(layoutSource, /Agent 生产现场（只读）/, 'starter navigation must not collapse the original product into four simplified read-only pages');
assert.match(workflowContextSource, /灵小枢派发目标/);
assert.match(workflowContextSource, /灵小图制作内容/);
assert.match(workflowContextSource, /灵小量生成发布任务/);
assert.match(workflowContextSource, /灵小售按规则报价/);
assert.match(workflowContextSource, /你可以在这里查看进度、调整内容，并将结果保存到当前任务/, 'each restored page must explain the customer action in business language');
assert.doesNotMatch(clientSource, /subscriptionPlan\s*===\s*['"]starter_198/, 'starter access must not depend on purchase or subscription state');
assert.match(clientSource, /shared\/contracts\/starter198/, 'the frontend must derive its types from the canonical shared contract');
assert.doesNotMatch(clientSource, /interface StarterAgentUsage/, 'the frontend must not fork the canonical agent usage contract');
assert.match(clientSource, /fetch\('\/api\/overseas\/starter-198\/commands'/, 'all starter writes must use the orchestrator command endpoint');
assert.doesNotMatch(`${starterPageSource}\n${productionSiteSource}`, /fetch\(/, 'starter components must not bypass the single API client');
assert.doesNotMatch(starterPageSource, /<StarterWorkflowOverview/, 'the customer workspace must not render the internal agent workflow map');
assert.doesNotMatch(starterPageSource, /我会统筹今天的经营任务|系统会主动推进|socialTaskHeadline/, 'the customer workspace must open directly on task progress without a verbose hero');
for (const workflowSurface of ['灵小枢统筹', '灵小图生产', '你只做确认', '灵小量发布', '灵小售报价', '灵小枢汇总', '当前节点', '下一步']) {
  assert.match(workflowOverviewSource, new RegExp(workflowSurface), `the overview must explain ${workflowSurface}`);
}
for (const preservedPage of ['灵感大屏', '内容制作', '投流／发布', '销售／客户', '成果与证据']) {
  assert.match(workflowOverviewSource, new RegExp(preservedPage), `the workflow map must link the ${preservedPage} interface`);
}
assert.match(workflowOverviewSource, /内容准备、发布与询盘承接可按实际情况并行/, 'the visual ordering must not misrepresent the sales branch as serial');
for (const internalCopy of ['服务端工作图', '官方 API', '生产写入', '已落库', '未创建 Run', '固定工作图', '底层仍按固定依赖运行', '模型不计算金额', '技术调用链', '内部单价']) {
  assert.doesNotMatch(`${starterPageSource}\n${workflowOverviewSource}\n${workflowContextSource}`, new RegExp(internalCopy), `customer-facing starter surfaces must not expose ${internalCopy}`);
}
assert.doesNotMatch(starterPageSource, /\{decision\.type\}|\{artifact\.kind\}/, 'customer-facing cards must not expose raw internal enum values');
assert.doesNotMatch(workflowOverviewSource, /fetch\(|starterWorkspaceApi/, 'the overview must derive status only from the sanitized workspace projection');
assert.doesNotMatch(`${starterPageSource}\n${workflowContextSource}`, /购买|支付|套餐|续费/, 'starter product surfaces must not contain purchase or package-upgrade UI');
assert.match(starterPageSource, /workspace\.controls\.find\(action => action\.command === 'submit_orchestrator_input'\)/, 'supplementary input must be driven by the server control manifest');
assert.doesNotMatch(starterPageSource, /state\.execute\(\{ command: 'submit_orchestrator_input'/, 'the supplementary input must not invent an enabled orchestrator command');
assert.match(starterPageSource, /starter_198_orchestrator_worker_unavailable/, 'an unavailable orchestrator queue must be disclosed rather than faked');
assert.match(starterPageSource, /blocked: '系统能力待接通'/,
  'a blocked item must be disclosed as unavailable instead of shown as running');
assert.doesNotMatch(productionSiteSource, /WorkspaceActionButtons|starterWorkspaceApi\.download|resolve_decision|submit_publication_evidence/, 'read-only production sites must not expose download, approval, or evidence submission controls');
for (const preservedWorkflow of ['趋势信号', '对标拆解', '脚本', '质检', '发布包', '证据回填', '询盘', '确定性计价', '报价审批']) {
  assert.match(productionSiteViewsSource, new RegExp(preservedWorkflow), `the read-only production sites must preserve the ${preservedWorkflow} business surface`);
}
assert.match(productionSiteViewsSource, /InspirationView/);
assert.match(productionSiteViewsSource, /ContentView/);
assert.match(productionSiteViewsSource, /TrafficView/);
assert.match(productionSiteViewsSource, /SalesView/);
assert.doesNotMatch(productionSiteViewsSource, /fetch\(|starterWorkspaceApi|WorkspaceActionButtons|onExecute|onClick/, 'specialized production-site views must remain strictly observational');
assert.match(layoutSource, /\{!starterMode && <button onClick=\{openQuota\}/, 'the legacy points entry must not render in starter mode');
const actionSource = fs.readFileSync('src/components/starter/WorkspaceActionButtons.tsx', 'utf8');
assert.match(actionSource, /starterWorkspaceCommandTargetId\(selected\.command, targetId\)/, 'action composition must classify targetless commands before sending');
assert.match(actionSource, /return \{ decision, note: input\.trim\(\) \}/, 'decision payload must contain only the backend-approved decision and note fields');
assert.match(actionSource, /return \{ input: input\.trim\(\) \}/, 'orchestrator input payload must contain only input');
assert.doesNotMatch(actionSource, /contentHash/, 'publication evidence hash must be derived by the server, never invented or entered by the customer');

const requests: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let activeToken = 'test-token';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => activeToken, setItem: () => {}, removeItem: () => {} },
});
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ url: String(input), init });
  if (String(input).includes('/publication-packages/')) {
    return new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="publish-package.zip"' },
    });
  }
  return new Response(JSON.stringify({ accepted: true, commandId: 'command-1', message: '已暂停' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;
try {
  await starterWorkspaceApi.command({ command: 'pause_run', targetId: 'run-1', idempotencyKey: 'idem-1' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/overseas/starter-198/commands');
  assert.equal(requests[0].init?.method, 'POST');
  const body = JSON.parse(String(requests[0].init?.body));
  assert.deepEqual(body, { command: 'pause_run', targetId: 'run-1', idempotencyKey: 'idem-1' });
  assert.equal('tenantId' in body, false);
  assert.equal('agentRole' in body, false);
  const artifact = await fetchStarterArtifact('/api/overseas/starter-198/publication-packages/p1/download');
  assert.equal(artifact.filename, 'publish-package.zip');
  assert.equal(artifact.blob.size, 4);
  assert.equal(requests[1].url, 'http://localhost/api/overseas/starter-198/publication-packages/p1/download');
  assert.equal((requests[1].init?.headers as Record<string, string>).Authorization, 'Bearer test-token', 'same-origin downloads must retain bearer authentication');

  starterWorkspaceApi.clearAll();
  const deferred: Array<(response: Response) => void> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Promise<Response>(resolve => deferred.push(resolve));
  }) as typeof fetch;
  activeToken = 'tenant-a-token';
  const tenantA = starterWorkspaceApi.get();
  activeToken = 'tenant-b-token';
  const tenantB = starterWorkspaceApi.get();
  assert.notEqual(tenantA, tenantB, 'different authenticated identities must never share an in-flight workspace request');
  assert.equal((requests.at(-2)?.init?.headers as Record<string, string>).Authorization, 'Bearer tenant-a-token');
  assert.equal((requests.at(-1)?.init?.headers as Record<string, string>).Authorization, 'Bearer tenant-b-token');
  deferred[1](new Response(JSON.stringify(workspacePayload({ greeting: 'tenant-b' })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  deferred[0](new Response(JSON.stringify(workspacePayload({ greeting: 'tenant-a' })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await tenantA).greeting, 'tenant-a');
  assert.equal((await tenantB).greeting, 'tenant-b');
  assert.equal((await starterWorkspaceApi.get()).greeting, 'tenant-b', 'late completion from another identity must not replace the active identity cache');
} finally {
  starterWorkspaceApi.clearAll();
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

console.log('starter 198 workspace frontend contracts passed');
