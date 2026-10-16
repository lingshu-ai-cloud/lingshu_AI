import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeQuickExecution,
  planQuickExecution,
  quickExecutionConfirmationCount,
  quickExecutionNavigation,
} from './assistantQuickExecution';

const definition = {
  id: 'create-tiktok-video',
  label: '创建 TikTok 口播任务',
  kind: 'production_task' as const,
  goal: '为本周排期创建一条 TikTok 口播生产任务',
  page: 'digitalEmployees',
};

test('confirmation policy separates direct, task and external-impact execution', () => {
  assert.equal(quickExecutionConfirmationCount('analysis'), 0);
  assert.equal(quickExecutionConfirmationCount('draft'), 0);
  assert.equal(quickExecutionConfirmationCount('production_task'), 1);
  assert.equal(quickExecutionConfirmationCount('schedule_change'), 1);
  assert.equal(quickExecutionConfirmationCount('quota_change'), 1);
  assert.equal(quickExecutionConfirmationCount('publish'), 2);
  assert.equal(quickExecutionConfirmationCount('customer_contact'), 2);
  assert.equal(quickExecutionConfirmationCount('paid_action'), 2);

  const first = planQuickExecution(definition, 0, 'quick-production-001');
  assert.equal(first.status, 'confirmation_required');
  if (first.status === 'confirmation_required') assert.equal(first.confirmationsRemaining, 1);

  const ready = planQuickExecution(definition, 1, 'quick-production-001');
  assert.equal(ready.status, 'ready');
  if (ready.status === 'ready') {
    assert.deepEqual(ready.request, {
      source: 'button', actionId: 'start_task', requestId: 'quick-production-001',
      page: 'digitalEmployees', parameters: { goal: definition.goal },
    });
  }

  const outbound = { ...definition, id: 'publish-tiktok', kind: 'publish' as const };
  assert.equal(planQuickExecution(outbound, 0, 'quick-publish-001').status, 'confirmation_required');
  const second = planQuickExecution(outbound, 1, 'quick-publish-001');
  assert.equal(second.status, 'confirmation_required');
  if (second.status === 'confirmation_required') assert.match(second.prompt, /再次确认/);
  assert.equal(planQuickExecution(outbound, 2, 'quick-publish-001').status, 'ready');
});

test('ready execution uses the existing assistant action endpoint and validates its receipt', async () => {
  let token = 'token-a';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => token },
  });
  const plan = planQuickExecution(definition, 1, 'quick-production-002');
  const response = await executeQuickExecution('business', plan, async (url, init) => {
    assert.equal(url, '/api/overseas/assistant-threads/business/actions');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token-a');
    assert.deepEqual(JSON.parse(String(init?.body)), plan.status === 'ready' ? plan.request : null);
    return Response.json({
      status: 'accepted', actionId: 'start_task', requestId: 'quick-production-002',
      card: { kind: 'operation_result', title: '任务已接收', summary: '已进入 Agent 排期。', details: [] },
      workspace: { label: '查看任务排期', href: '/?page=digitalEmployees&focus=run-1' },
      notification: null,
    }, { status: 202 });
  });
  assert.equal(response.status, 'accepted');
  assert.deepEqual(quickExecutionNavigation(response), {
    page: 'digitalEmployees', focus: 'run-1', href: '/?page=digitalEmployees&focus=run-1',
  });

  token = 'token-b';
});

test('execution refuses unconfirmed commands, mismatched receipts and invented destinations', async () => {
  const pending = planQuickExecution(definition, 0, 'quick-production-003');
  await assert.rejects(executeQuickExecution('business', pending), /确认/);

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'token-a' },
  });
  const ready = planQuickExecution(definition, 1, 'quick-production-004');
  await assert.rejects(executeQuickExecution('business', ready, async () => Response.json({
    status: 'accepted', actionId: 'start_task', requestId: 'another-request',
    card: { kind: 'operation_result', title: '错误回执', summary: '错误回执', details: [] },
    notification: null,
  })), /回执/);

  assert.equal(quickExecutionNavigation({
    status: 'accepted', actionId: 'start_task', requestId: 'quick-production-004',
    card: { kind: 'operation_result', title: '已接收', summary: '处理中', details: [] },
    workspace: { label: '不可信', href: 'https://example.com/fake-production' }, notification: null,
  }), null);
});
