import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard.js';
import { contentTaskCardToAssistantCard, unavailableAssistantContentTaskCard, unavailableContentTaskCard } from './assistantContentTaskProjection.js';

const card: ContentProductionTaskCard = {
  schemaVersion: 'content-production-task-card.v1', id: 'content-task-card:one', contentTaskId: 'one',
  cardVersion: '4', recoveryCursor: { kind: 'task_version', value: 'one@4', runId: 'run-one' },
  title: '单条海报', outputType: 'image', overallState: 'needs_input',
  currentNode: { id: 'preflight', label: '核对生产条件', userFacingSummary: '任务已建立，补齐必要信息后继续。' },
  knownItems: [{ key: 'product', label: '产品', value: '产品 A' }],
  defaultedItems: [{ key: 'count', label: '数量', value: '单条内容' }],
  blockingItems: [{ key: 'material', label: '待补充', value: '产品图片' }],
  progress: { mode: 'none' }, cost: null, completedSummary: [], nextAction: 'supply_input',
  lastConfirmedAt: '2026-10-24T02:00:00.000Z',
};

test('adapts the shared task card without changing its authority fields', () => {
  const result = contentTaskCardToAssistantCard(card);
  assert.equal(result.taskId, 'social-content:one');
  assert.equal(result.status, 'needs_input');
  assert.equal(result.contentTask?.cardVersion, '4');
  assert.equal(result.contentTask?.recoveryCursor.value, 'one@4');
  assert.match(result.details?.join('\n') || '', /已确定/);
  assert.equal(result.primaryAction?.href, undefined, 'the main action stays in the current conversation');
  assert.match(result.primaryAction?.prompt || '', /继续当前内容任务 one/);
});

test('shows only server-confirmed cost semantics', () => {
  const result = contentTaskCardToAssistantCard({ ...card, cost: {
    currency: 'CNY', expectedCny: 5, upperBoundCny: 8, actualCny: null,
    unsettledCny: null, status: 'estimated', reusable: false, basis: 'execution_plan',
  }, blockingItems: [] });
  assert.match(result.details?.join('\n') || '', /费用上限：¥8\.00（待结算）/);
});

test('read failure preserves the business state and exposes the last confirmed time', () => {
  const unavailable = unavailableContentTaskCard(card);
  const result = contentTaskCardToAssistantCard(unavailable);
  assert.equal(unavailable.overallState, 'needs_input');
  assert.equal(unavailable.readState, 'unavailable');
  assert.match(result.conclusion, /暂时无法读取最新状态/);
  assert.match(result.details?.[0] || '', /2026-10-24T02:00:00.000Z/);
});

test('a restored card without the rich projection still reports disconnected state truthfully', () => {
  const restored = contentTaskCardToAssistantCard(card);
  const result = unavailableAssistantContentTaskCard({
    ...restored,
    details: restored.details ?? [],
    items: restored.items ?? [],
    secondaryActions: restored.secondaryActions ?? [],
    contentTask: undefined,
    updatedAt: Date.parse(card.lastConfirmedAt),
  });
  assert.equal(result.status, 'needs_input');
  assert.match(result.conclusion, /暂时无法读取最新状态/);
  assert.match(result.details?.[0] || '', /2026-10-24T02:00:00.000Z/);
});
