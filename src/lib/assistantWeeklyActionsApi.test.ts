import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantWeeklyActionsApi, parseWeeklyActionContext, weeklyActionScopeTokens } from './assistantWeeklyActionsApi';

const context = { packages: [{ programId: 'program', packageId: 'week', packageVersion: 3, title: '本周' }], products: [{ id: 'product', name: '真实产品' }], accounts: [], revisionTargets: [], publishTargets: [] };
test('context requires authoritative package versions and real products', () => {
  assert.deepEqual(parseWeeklyActionContext(context), context);
  assert.throws(() => parseWeeklyActionContext({ ...context, packages: [{ ...context.packages[0], packageVersion: 0 }] }), /真实对象或版本/);
  assert.throws(() => parseWeeklyActionContext({ packages: [] }), /选项不完整/);
});
test('legacy normalized real IDs keep native frozen hashes without identity overrides', () => {
  const scope = { model: 'legacy' as const, programId: 'goal-real', packageId: 'plan-real', packageVersion: 2, title: '实际本周计划', goalId: 'goal-real', planId: 'plan-real', planVersion: 2, runId: 'run-real', expectedPlanHash: 'plan-hash', platforms: ['tiktok'], tenantId: 'forged', role: 'admin' };
  const result = weeklyActionScopeTokens(scope);
  assert.equal(result.goalId, 'goal-real'); assert.equal(result.expectedPlanHash, 'plan-hash'); assert.equal(result.runId, 'run-real');
  assert.equal(result.tenantId, undefined); assert.equal(result.role, undefined); assert.equal(result.title, undefined);
  const legacyContext = { ...context, packages: [scope], revisionTargets: [{ model: 'legacy', id: 'workflow', name: '原内容任务', programId: 'goal-real', packageId: 'plan-real', packageVersion: 2, goalId: 'goal-real', planId: 'plan-real', runId: 'run-real', expectedHash: 'frozen' }] };
  assert.deepEqual(parseWeeklyActionContext(legacyContext), legacyContext);
});
test('legacy creation submits frozen native lineage and explicit draft-only additional budget', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-session' } });
  const input = { model: 'legacy', programId: 'actual-goal', packageId: 'actual-plan', packageVersion: 3, goalId: 'actual-goal', planId: 'actual-plan', planVersion: 3, runId: 'actual-run', expectedPlanHash: 'frozen-plan-hash', productId: 'kb-product', platform: 'tiktok', maximumAdditionalCostCny: 20, confirmAdditionalBudget: true, publishMode: 'draft_only', acknowledgePublishingRevocation: true };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/overseas/assistant-weekly-actions/create'); assert.deepEqual(JSON.parse(String(init?.body)), input);
    return new Response(JSON.stringify({ item: { model: 'legacy', state: 'queued', programId: 'actual-goal', packageId: 'actual-plan', packageVersion: 4, message: '已登记真实订单，仅制作不发布。', navigation: { page: 'digitalEmployees', href: '/?page=digitalEmployees&goalId=actual-goal' } } }));
  };
  try { assert.equal((await assistantWeeklyActionsApi.submit('create', input)).model, 'legacy'); }
  finally { globalThis.fetch = original; }
});
test('mutation preserves input identity and requires an actual weekly receipt', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-session' } });
  let calls = 0;
  const input = { requestId: 'stable-request', programId: 'program', packageId: 'week', expectedVersion: 3, productId: 'product' };
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, '/api/overseas/assistant-weekly-actions/create');
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ item: { state: 'awaiting_review', programId: 'program', packageId: 'week', packageVersion: 4, message: '已加入周计划，等待审核。' } }));
  };
  try {
    const result = await assistantWeeklyActionsApi.submit('create', input);
    assert.equal(result.state, 'awaiting_review'); assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ item: { state: 'running', message: '已启动' } }));
    await assert.rejects(assistantWeeklyActionsApi.submit('create', input), /未收到可核验/);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: '缺少正式发布授权' }), { status: 422 });
    await assert.rejects(assistantWeeklyActionsApi.submit('publish', input), /缺少正式发布授权/);
  } finally { globalThis.fetch = original; }
});
test('late authentication change cannot show another session receipt', async () => {
  const original = globalThis.fetch; let token = 'first';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => token } });
  globalThis.fetch = async () => { token = 'second'; return new Response(JSON.stringify(context)); };
  try { await assert.rejects(assistantWeeklyActionsApi.context(), /登录身份已变化/); }
  finally { globalThis.fetch = original; }
});
test('active-week confirmation echoes frozen capacity and schedule evidence, never invents resources', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-session' } });
  const input = { requestId: 'active-request', programId: 'program', packageId: 'week', expectedVersion: 3 };
  const capacity = { snapshotRef: { id: 'snapshot', version: 1 }, capacityPlanRef: { type: 'capacity_plan' as const, id: 'capacity', version: 1 }, publicationQuota: 3, originalContentQuota: 3, estimatedCostCny: 10, weeklyBudgetCny: 100, status: 'ready', limitingFactors: [], proposalHash: 'frozen-capacity', canAdd: true };
  const planning = { constraints: {}, resources: {}, remainingBudgetCny: 10 };
  const proposal = { proposalId: 'proposal', packageVersion: 3, inputEvidenceHash: 'frozen-evidence', targetGraph: {}, templateCarryovers: [{ planHash: 'template-hash' }], plan: { reservedCostCny: 10, targetPublicationCount: 3, conditionallyReachableCount: 3, fullGraphConditionallyReachable: true } };
  const paths: string[] = [];
  globalThis.fetch = async (url, init) => {
    paths.push(String(url)); const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/capacity/preview')) return new Response(JSON.stringify({ item: capacity }));
    if (String(url).endsWith('/capacity/confirm')) { assert.deepEqual(body.confirmation, { snapshotRef: capacity.snapshotRef, proposalHash: capacity.proposalHash, approvedPublicationQuota: 3, approvedMaximumCostCny: 10, confirmed: true }); return new Response(JSON.stringify({ item: { state: 'capacity_confirmed', capacityPlanRef: capacity.capacityPlanRef, operatingDecisionSnapshotRef: capacity.snapshotRef, capacityAuthorization: { operationId: 'authorization', proposalHash: capacity.proposalHash, approvedPublicationQuota: 3, approvedMaximumCostCny: 10 } } })); }
    if (String(url).endsWith('/schedule-input')) return new Response(JSON.stringify({ item: { capacity: planning, summary: ['真实配置'] } }));
    if (String(url).endsWith('/preview')) { assert.deepEqual(body.capacity, planning); return new Response(JSON.stringify({ item: { proposal } })); }
    assert.deepEqual(body.confirmation, { proposalId: 'proposal', expectedVersion: 3, inputEvidenceHash: 'frozen-evidence', confirmedTemplateCarryoverPlanHashes: ['template-hash'] });
    return new Response(JSON.stringify({ item: { state: 'awaiting_review', programId: 'program', packageId: 'week', packageVersion: 4, message: '已登记待审核' } }));
  };
  try {
    const p = await assistantWeeklyActionsApi.previewCapacity(input);
    const confirmed = await assistantWeeklyActionsApi.confirmCapacity(input, p, 10);
    const next = { ...input, capacityPlanRef: confirmed.capacityPlanRef, operatingDecisionSnapshotRef: confirmed.operatingDecisionSnapshotRef, capacityAuthorization: confirmed.capacityAuthorization };
    const resource = await assistantWeeklyActionsApi.scheduleInput(next);
    const preview = await assistantWeeklyActionsApi.previewSchedule(next, resource.capacity);
    assert.equal((await assistantWeeklyActionsApi.confirmSchedule(next, preview.proposal)).state, 'awaiting_review');
    assert.equal(paths.length, 5);
  } finally { globalThis.fetch = original; }
});
