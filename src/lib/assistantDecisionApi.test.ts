import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssistantDecisionExecutionReceipt } from '../../shared/contracts/assistantDecisionCenter';
import {
  AssistantDecisionApiError,
  executeAssistantDecision,
  fetchAssistantDecisionFeed,
  normalizeAssistantDecisionFeed,
} from './assistantDecisionApi';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval:one',
    kind: 'content_approval',
    priority: 800,
    status: 'pending',
    title: '确认内容',
    summary: '内容已准备好，请确认是否继续。',
    facts: [{ label: '数量', value: '2 条', tone: 'info' }],
    subject: { type: 'approval_request', id: 'one', version: 'subject:1|content:abc' },
    actions: [
      { id: 'approve', label: '批准并继续', mode: 'command', emphasis: 'primary' },
      { id: 'reject', label: '退回修改', mode: 'command', emphasis: 'default', requiresNote: true },
    ],
    deepLink: { page: 'smartAssets', taskId: 'task-one', businessRef: { taskKey: 'content_quality_gate' } },
    createdAt: '2026-10-10T08:00:00.000Z',
    ...overrides,
  };
}

test('decision transport keeps only the compact contract and highest priority first', () => {
  const feed = normalizeAssistantDecisionFeed({
    page: 'digitalEmployees',
    total: 4,
    generatedAt: '2026-10-10T08:00:00.000Z',
    items: [
      card({ id: 'low', priority: 500, events: [{ message: 'never expose me' }] }),
      card({
        id: 'high',
        kind: 'plan_start',
        priority: 1000,
        title: '确认周计划',
        deepLink: {
          page: 'digitalEmployees',
          businessRef: { taskKey: 'goal_decomposition', logs: ['never expose me'], trace: { secret: true } },
        },
      }),
      card({ id: 'middle', priority: 800 }),
      card({ id: 'trimmed', priority: 100 }),
    ],
    runEvents: [{ id: 'run-event' }],
    logs: ['hidden'],
  });
  assert.equal(feed.items.length, 3);
  assert.equal(feed.items[0].id, 'high');
  assert.equal(feed.total, 4);
  assert.equal('events' in feed.items[1], false);
  assert.equal('runEvents' in feed, false);
  assert.equal('logs' in feed, false);
  assert.deepEqual(feed.items[0].deepLink?.businessRef, { taskKey: 'goal_decomposition' });
});

test('product route aliases resolve to the matching decision domain', () => {
  assert.equal(normalizeAssistantDecisionFeed({ page: 'traffic', items: [] }).page, 'publishing');
  assert.equal(normalizeAssistantDecisionFeed({ page: 'socialWorkspace', items: [] }).page, 'digitalEmployees');
  assert.equal(normalizeAssistantDecisionFeed({ page: 'orders', items: [] }).page, 'conversion');
});

test('weekly plan navigation retains the backend goal and plan identity only', () => {
  const feed = normalizeAssistantDecisionFeed({ page: 'digitalEmployees', items: [card({
    kind: 'plan_start',
    deepLink: { page: 'digitalEmployees', businessRef: {
      goalId: ' weekly_goals_current ',
      planId: 'weekly_plans_version2',
      logs: ['internal'],
      token: 'not-navigation-data',
    } },
  })] });
  assert.deepEqual(feed.items[0].deepLink, { page: 'digitalEmployees', businessRef: {
    goalId: 'weekly_goals_current', planId: 'weekly_plans_version2',
  } });
});

test('invalid actions and unbounded text cannot enter the decision UI', () => {
  const feed = normalizeAssistantDecisionFeed({
    page: 'socialInspiration',
    items: [card({
      title: 'A'.repeat(300),
      actions: [
        { id: 'approve', label: '批准', mode: 'command', emphasis: 'primary' },
        { id: 'show_logs', label: '查看执行记录', mode: 'navigate', emphasis: 'primary' },
      ],
    })],
  });
  assert.equal(feed.items[0].title.length, 160);
  assert.deepEqual(feed.items[0].actions.map(action => action.id), ['approve']);
});

test('API sends page context and optimistic version without leaking extra payload', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'test-token', setItem() {}, removeItem() {} },
  });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const response = init?.method === 'POST'
      ? { ...normalizeAssistantDecisionFeed({ page: 'digitalEmployees', items: [] }), ok: true, outcome: 'completed' }
      : { page: 'digitalEmployees', items: [card()], total: 1, generatedAt: '2026-10-10T08:00:00.000Z' };
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const feed = await fetchAssistantDecisionFeed({ page: 'digitalEmployees', goalId: 'goal 1' });
    assert.equal(feed.items[0].id, 'approval:one');
    assert.match(calls[0].url, /page=digitalEmployees/);
    assert.match(calls[0].url, /goalId=goal\+1/);
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer test-token');

    await executeAssistantDecision({
      cardId: 'approval:one',
      actionId: 'reject',
      expectedVersion: 'subject:1|content:abc',
      page: 'smartAssets',
      goalId: 'goal 1',
      note: '请补充来源',
    });
    assert.match(calls[1].url, /page=smartAssets/);
    assert.match(calls[1].url, /goalId=goal\+1/);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.deepEqual(body, {
      actionId: 'reject',
      expectedVersion: 'subject:1|content:abc',
      note: '请补充来源',
    });
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});

test('409 becomes a refreshable stale-decision error', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'stale_decision' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  try {
    await assert.rejects(
      executeAssistantDecision({ cardId: 'one', actionId: 'approve', expectedVersion: 'old', page: 'digitalEmployees' }),
      (error: unknown) => error instanceof AssistantDecisionApiError && error.status === 409 && /刷新/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});

test('business blockers retain their real reason and conflicting workflow identity', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'active_goal_exists', message: '另一轮周目标尚未结束', activeGoalId: 'other-goal', activeRunId: 'other-run',
  }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(executeAssistantDecision({ cardId: 'plan', actionId: 'approve_and_start', expectedVersion: '1', page: 'digitalEmployees' }),
      (error: unknown) => error instanceof AssistantDecisionApiError && error.message === '另一轮周目标尚未结束'
        && error.details.activeRunId === 'other-run' && !error.message.includes('待办已更新'));
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});

test('plan start requires a persisted execution receipt, not preparation or a generic completed outcome', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  const receipt = { goalId: 'goal', runId: 'run', status: 'waiting_external', taskCount: 5, startedAt: '2026-10-11T00:00:00Z' };
  let execution: unknown;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ...normalizeAssistantDecisionFeed({ page: 'digitalEmployees', items: [] }), ok: true, outcome: 'completed', execution,
  }), { status: 200 })) as typeof fetch;
  const input = { cardId: 'plan', actionId: 'approve_and_start' as const, expectedVersion: '1', page: 'digitalEmployees' };
  try {
    for (execution of [undefined, { status: 'ready' }, { ...receipt, runId: '' }, { ...receipt, taskCount: 0 }, { ...receipt, startedAt: '' }]) {
      await assert.rejects(executeAssistantDecision(input),
        (error: unknown) => error instanceof AssistantDecisionApiError && error.code === 'plan_start_unconfirmed');
    }
    execution = { ...receipt, providerLogs: ['private'], tokens: 'private' };
    assert.deepEqual((await executeAssistantDecision(input)).execution, receipt);
    assert.equal(normalizeAssistantDecisionExecutionReceipt({ ...receipt, status: 'preparing' }), undefined);
    assert.equal(normalizeAssistantDecisionExecutionReceipt({ ...receipt, taskCount: '5' }), undefined);
    assert.equal(normalizeAssistantDecisionExecutionReceipt({ ...receipt, status: 'failed' })?.status, 'failed', 'a real failed run must not be advertised as producing');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});

test('invalid success payloads never clear the queue or report a completed action', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(fetchAssistantDecisionFeed({ page: 'digitalEmployees' }),
      (error: unknown) => error instanceof AssistantDecisionApiError && error.code === 'invalid_decision_response');
    await assert.rejects(executeAssistantDecision({ cardId: 'one', actionId: 'approve', expectedVersion: '1', page: 'digitalEmployees' }),
      (error: unknown) => error instanceof AssistantDecisionApiError && error.code === 'invalid_decision_response');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});

test('cancelling a stale UI request cancels its fetch without becoming a timeout error', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  })) as typeof fetch;
  try {
    const controller = new AbortController();
    const pending = fetchAssistantDecisionFeed({ page: 'digitalEmployees', signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
  }
});
