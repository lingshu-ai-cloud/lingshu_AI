import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantActionRequest, AssistantActionResponse, AssistantCardAction } from '../../../shared/contracts/assistantActions';
import type { AssistantTaskCard } from '../../stores/assistantStore';
import {
  actionCardToTaskCard,
  actionResponseCardId,
  focusedNaturalLanguageActionId,
  focusedNaturalLanguageActionInput,
  isWeeklyPlanKickoffRequest,
  responseWithoutCrossObjectActions,
} from './assistantActionProjection';

const runTarget = { objectType: 'run' as const, objectId: 'run-1', expectedVersion: 'v1' };
const signedPause: AssistantCardAction = { id: 'pause-1', label: '暂停', actionId: 'pause_task', target: runTarget, parameters: { reason: '人工检查' } };
const card: AssistantTaskCard = {
  taskId: 'card-1', title: '周任务', conclusion: '', details: [], items: [],
  status: 'running', notificationReason: 'routine', primaryAction: signedPause,
  secondaryActions: [], updatedAt: 1,
};

test('natural-language mutation only echoes one server-signed action target and parameters', () => {
  assert.equal(focusedNaturalLanguageActionId('请暂停当前任务。'), 'pause_task');
  assert.equal(focusedNaturalLanguageActionId('看看任务吧'), undefined);
  assert.equal(isWeeklyPlanKickoffRequest('请开始本周计划！'), true);
  assert.deepEqual(focusedNaturalLanguageActionInput(card, 'pause_task'), { target: runTarget, parameters: { reason: '人工检查' } });
  assert.equal(focusedNaturalLanguageActionInput({ ...card, secondaryActions: [signedPause] }, 'pause_task'), undefined);
});

test('cross-object response cannot overwrite the request card or expose another object action', () => {
  const request: AssistantActionRequest = { source: 'button', actionId: 'pause_task', requestId: 'request-1', target: runTarget };
  const otherAction: AssistantCardAction = { id: 'resume-other', label: '继续', actionId: 'resume_task', target: { objectType: 'run', objectId: 'run-2', expectedVersion: 'v2' } };
  const response: AssistantActionResponse = {
    status: 'accepted', actionId: 'pause_task', requestId: 'response-2', notification: null,
    card: { kind: 'operation_result', title: '已处理', summary: '状态已更新', details: [], primaryAction: otherAction, secondaryActions: [signedPause, otherAction] },
  };
  assert.equal(actionResponseCardId(request, response, { 'run-1': card, 'run-2': card }), 'response-2');
  const filtered = responseWithoutCrossObjectActions(request, response);
  assert.equal(filtered.card.primaryAction, undefined);
  assert.deepEqual(filtered.card.secondaryActions, [signedPause]);
  assert.equal(actionCardToTaskCard(filtered.card, filtered, 'response-2').status, 'running');
});
