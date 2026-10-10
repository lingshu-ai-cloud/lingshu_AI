import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import type { DecisionMemory } from './decisionMemory.js';
import { buildChatGrounding, formatDecisionContext } from './chatGrounding.js';
import type { OperatingContext } from './operatingContext.js';

const scope = { tenantId: 'tenant-a', userId: 'user-a' };
function profile(enabled = true): EnterpriseProfile {
  return { company: { name: '当前企业', industry: '工业' }, products: {}, knowledge: '', dataGovernance: { aiAccessEnabled: enabled } } as EnterpriseProfile;
}
function memory(content = '预算 1000 元'): DecisionMemory {
  return { id: 'memory-1', tenant_id: scope.tenantId, user_id: scope.userId, memory_id: 'logical-1', version: 1, content, status: 'confirmed', source_message_id: 'message-1', confirmed_at: '2026-10-10T00:00:00Z', created_at: '2026-10-10T00:00:00Z', expires_at: '', schema_version: 'assistant-decision-v1' };
}
function operating(): OperatingContext {
  return { generatedAt: '2026-10-10T00:00:00Z', selection: 'progress', sources: [{ collection: 'workflow_tasks', label: '任务', state: 'available', totalItems: 20, truncated: true, records: [{ sourceRef: 'workflow_tasks/task-1', facts: { status: 'blocked', blocked_reason: '等待审批' } }] }] };
}

test('admin grounding uses authenticated tenant/user scope and passes question only for relevance', async () => {
  for (const role of ['admin', 'super_admin']) {
    let operatingCalls = 0;
    let memoryCalls = 0;
    const result = await buildChatGrounding(scope, { role, question: '任务进度', readEnterprise: async tenantId => {
      assert.equal(tenantId, scope.tenantId); return profile();
    }, readOperating: async (tenantId, options) => {
      assert.equal(tenantId, scope.tenantId); assert.equal(options?.question, '任务进度'); operatingCalls++; return operating();
    }, readDecisions: async requested => {
      assert.deepEqual(requested, scope); memoryCalls++; return [memory()];
    } });
    assert.equal(operatingCalls, 1); assert.equal(memoryCalls, 1);
    assert.equal(result.enterpriseState, 'available');
    assert.equal(result.operatingState, 'loaded'); assert.equal(result.memoryState, 'loaded');
    assert.ok(result.text.includes('workflow_tasks/task-1'));
    assert.ok(result.text.includes('assistant_decision_memories/memory-1'));
  }
});

test('ordinary, unverified and spoofed roles never read tenant-wide operating records', async () => {
  for (const role of ['member', 'user', 'viewer', 'ADMIN', '', null]) {
    const result = await buildChatGrounding(scope, { role, readEnterprise: async () => profile(), readOperating: async () => {
      assert.fail('unauthorized broad read');
    }, readDecisions: async requested => { assert.deepEqual(requested, scope); return [memory()]; } });
    assert.equal(result.operatingState, 'not_loaded');
    assert.equal(result.memoryState, 'loaded');
    assert.ok(result.text.includes('不能推断没有任务'));
    assert.ok(!result.text.includes('workflow_tasks/task-1'));
  }
});

test('AI access disabled suppresses downstream facts and decision memory reads', async () => {
  const result = await buildChatGrounding(scope, { role: 'admin', readEnterprise: async () => profile(false), readOperating: async () => assert.fail('disabled operating read'), readDecisions: async () => assert.fail('disabled memory read') });
  assert.equal(result.enterpriseState, 'disabled');
  assert.equal(result.operatingState, 'not_loaded'); assert.equal(result.memoryState, 'not_loaded');
  assert.ok(!result.text.includes('当前企业'));
});

test('missing, failing and timed out enterprise verification suppresses all downstream reads', async () => {
  const reads = [async () => null, async (): Promise<EnterpriseProfile> => { throw new Error('database password secret'); }, () => new Promise<EnterpriseProfile>(() => {})];
  for (const readEnterprise of reads) {
    const result = await buildChatGrounding(scope, { role: 'admin', timeoutMs: 15, readEnterprise, readOperating: async () => assert.fail('unverified operating read'), readDecisions: async () => assert.fail('unverified memory read') });
    assert.equal(result.enterpriseState, 'unavailable');
    assert.equal(result.operatingState, 'not_loaded'); assert.equal(result.memoryState, 'not_loaded');
    assert.ok(!result.text.includes('password'));
  }
});

test('enterprise answer projection removes receiver identities and protects non-admin pricing rules', async () => {
  const enterprise = profile();
  enterprise.notifications = { receivers: [{ name: 'PRIVATE_RECEIVER', channel: 'wecom', target: 'PRIVATE_TARGET' }], workHours: { start: '09:00', end: '18:00' }, quietOutsideHours: true, nightMode: { enabled: true, autoCategories: 'approved' } } as EnterpriseProfile['notifications'];
  enterprise.strategy = { minMargin: 'PRIVATE_MARGIN', currentGoal: '运营目标' };
  enterprise.bizRules = { bargainFloor: 'PRIVATE_FLOOR' } as EnterpriseProfile['bizRules'];
  for (const role of ['admin', 'member']) {
    const result = await buildChatGrounding(scope, { role, readEnterprise: async () => enterprise, readOperating: async () => operating(), readDecisions: async () => [] });
    assert.ok(!result.text.includes('PRIVATE_RECEIVER') && !result.text.includes('PRIVATE_TARGET'));
    if (role === 'member') assert.ok(!result.text.includes('PRIVATE_MARGIN') && !result.text.includes('PRIVATE_FLOOR'));
    else assert.ok(result.text.includes('运营目标'));
  }
  assert.equal(enterprise.notifications!.receivers[0].name, 'PRIVATE_RECEIVER', 'projection must not mutate stored profile');
});

test('unavailable memory and operating reads remain unknown, successful sibling context survives', async () => {
  const result = await buildChatGrounding(scope, { role: 'admin', readEnterprise: async () => profile(), readOperating: async () => operating(), readDecisions: async () => { throw new Error('secret'); } });
  assert.equal(result.memoryState, 'unavailable'); assert.equal(result.operatingState, 'loaded');
  assert.ok(result.text.includes('不能声称没有保存过决定'));
  assert.ok(result.text.includes('workflow_tasks/task-1'));
  const timed = await buildChatGrounding(scope, { role: 'admin', timeoutMs: 15, readEnterprise: async () => profile(), readOperating: () => new Promise(() => {}), readDecisions: async () => [] });
  assert.equal(timed.operatingState, 'unavailable'); assert.equal(timed.memoryState, 'loaded');
  assert.ok(timed.text.includes('不能推断为零'));
  assert.ok(timed.text.includes('"state":"empty"'));
});

test('enterprise, operating and memory contexts remain bounded and disclose omissions', async () => {
  const largeProfile = profile(); largeProfile.knowledge = '资料'.repeat(20_000);
  const largeOperating = operating();
  largeOperating.sources[0].records = Array.from({ length: 40 }, (_, index) => ({ sourceRef: `workflow_tasks/${index}`, facts: { title: '任务'.repeat(1_000) } }));
  const largeMemories = Array.from({ length: 20 }, (_, index) => ({ ...memory('记忆'.repeat(1_000)), id: `memory-${index}` }));
  const result = await buildChatGrounding(scope, { role: 'admin', readEnterprise: async () => largeProfile, readOperating: async () => largeOperating, readDecisions: async () => largeMemories });
  assert.ok(result.text.length < 29_000);
  assert.ok(result.text.includes('上下文已限量'));
  assert.ok(result.text.includes('omittedFromRetrieved'));
  assert.ok(result.text.includes('"truncated":true'));
  const decisions = formatDecisionContext(largeMemories);
  assert.ok(decisions.length < 6_400);
  assert.equal(JSON.parse(decisions.slice(decisions.indexOf('\n') + 1)).state, 'available');
});
