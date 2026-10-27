import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteMockCustomers } from '../mocks/quoteCustomerProfiles';
import { completedTodoCustomers, dailyTodoCustomers, pendingCount, pendingCustomers } from './customerPriority';

const customer = createQuoteMockCustomers()[0]!;

test('历史会话保留原处理状态，但不能触发客服待办和每日简报', () => {
  const history = [
    { ...customer, id: 'history-human', isHistorical: true, handlingMode: 'human_needed' as const },
    { ...customer, id: 'history-draft', isHistorical: true, handlingMode: 'ai_draft' as const },
    { ...customer, id: 'history-done', isHistorical: true, todoCompletedAt: '2026-10-27T01:00:00Z' },
  ];
  assert.equal(pendingCount(history), 0);
  assert.deepEqual(pendingCustomers(history), []);
  assert.deepEqual(completedTodoCustomers(history), []);
  assert.deepEqual(dailyTodoCustomers(history), []);
  assert.equal(history[0].handlingMode, 'human_needed');
});

test('混合历史和当前会话时，保留当前待处理、草稿确认及已完成任务', () => {
  const active = [
    { ...customer, id: 'live-human', isHistorical: false, handlingMode: 'human_needed' as const, todoCompletedAt: undefined },
    { ...customer, id: 'live-draft', isHistorical: false, handlingMode: 'ai_draft' as const, todoCompletedAt: undefined },
    { ...customer, id: 'live-done', isHistorical: false, todoCompletedAt: '2026-10-27T01:00:00Z' },
  ];
  const mixed = [...active, ...active.map(item => ({ ...item, id: `history-${item.id}`, isHistorical: true }))];
  assert.equal(pendingCount(mixed), 2);
  assert.deepEqual(new Set(pendingCustomers(mixed).map(item => item.id)), new Set(['live-human', 'live-draft']));
  assert.deepEqual(completedTodoCustomers(mixed).map(item => item.id), ['live-done']);
  assert.equal(dailyTodoCustomers(mixed).length, 3);
});
