import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import { executionInventoryApprovalTarget, validatedCalendarPublicationDestination } from './calendarPublicationDestination';
import { projectExecutionCalendar } from './weeklyExecutionCalendar';
import { STEP_LABEL } from './weeklyExecutionLabels';

const scope = { tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 2 };
function execution(workflowKind: WeeklyExecutionTask['workflowKind'], stepKind: WeeklyExecutionTask['schedule']['stepKind']): WeeklyExecutionTask {
  return {
    ...scope, taskId: 'execution', publicationTaskId: 'publication', accountId: 'account', workflowKind,
    inputSnapshot: { publicationTask: { publicationTaskId: 'publication', inventoryReuseRef: { type: 'weekly_inventory_binding', id: 'binding', version: 1 } } },
    schedule: { stepKind, estimatedFinishAt: '2026-10-05T10:00:00+08:00', estimatedDurationMinutes: 10, responsibleActor: stepKind === 'user_approval' ? 'user' : 'business_agent' },
    status: 'queued', resultRefs: [], dependsOnTaskIds: [], ownBlockingReasons: [], inheritedBlockingTaskIds: [],
  } as unknown as WeeklyExecutionTask;
}
function mixedCard(task: WeeklyExecutionTask): AgentCalendarTask {
  return { id: task.taskId, executionStep: task.schedule.stepKind,
    inventoryTarget: { ...scope, taskId: task.taskId, publicationTaskId: task.publicationTaskId!, bindingId: 'binding' },
    publicationExecutionTarget: { ...scope, taskId: task.taskId, publicationTaskId: task.publicationTaskId!, accountId: 'account' },
  } as AgentCalendarTask;
}
test('historical cards with both targets dispatch by the persisted workflow and step', () => {
  const publishing = execution('publishing', 'publishing');
  assert.equal(validatedCalendarPublicationDestination(mixedCard(publishing), scope, [publishing])?.kind, 'publishing');
  assert.equal(validatedCalendarPublicationDestination({ ...mixedCard(publishing), inventoryTarget: { ...mixedCard(publishing).inventoryTarget!, bindingId: 'unrelated-old-reference' } }, scope, [publishing])?.kind, 'publishing');
  const approval = execution('content', 'user_approval');
  assert.equal(validatedCalendarPublicationDestination(mixedCard(approval), scope, [approval])?.kind, 'inventory_approval');
  assert.equal(validatedCalendarPublicationDestination({ ...mixedCard(approval), publicationExecutionTarget: { ...mixedCard(approval).publicationExecutionTarget!, accountId: 'unrelated-old-account' } }, scope, [approval])?.kind, 'inventory_approval');
  for (const task of [execution('content', 'publishing'), execution('publishing', 'user_approval'), execution('content', 'video_generation')]) {
    assert.equal(validatedCalendarPublicationDestination(mixedCard(task), scope, [task]), null);
  }
});
test('inventory approval verifies immutable binding, scope and unique persisted task without falling back', () => {
  const task = execution('content', 'user_approval');
  const card = mixedCard(task);
  for (const change of [{ tenantId: 'foreign' }, { programId: 'other' }, { packageId: 'other' }, { packageVersion: 3 }, { taskId: 'other' }, { publicationTaskId: 'other' }, { bindingId: 'other' }]) {
    assert.equal(validatedCalendarPublicationDestination({ ...card, inventoryTarget: { ...card.inventoryTarget!, ...change } }, scope, [task]), null);
  }
  assert.equal(executionInventoryApprovalTarget({ ...task, inputSnapshot: { publicationTask: { inventoryReuseRef: { type: 'weekly_inventory_binding', id: 'binding', version: 1 } } } }), null);
  assert.equal(validatedCalendarPublicationDestination(card, scope, [task, task]), null);
  assert.equal(validatedCalendarPublicationDestination({ ...card, inventoryTarget: undefined }, scope, [task]), null);
  assert.equal(validatedCalendarPublicationDestination({ ...card, executionStep: 'publishing' }, scope, [task]), null);
  for (const ref of [{ type: 'other', id: 'binding', version: 1 }, { type: 'weekly_inventory_binding', id: 'binding', version: 2 }, { type: 'weekly_inventory_binding', id: '', version: 1 }]) {
    assert.equal(executionInventoryApprovalTarget({ ...task, inputSnapshot: { publicationTask: { publicationTaskId: 'publication', inventoryReuseRef: ref } } }), null);
  }
});
test('publishing route rejects altered bindings, workflow and duplicate execution identities', () => {
  const task = execution('publishing', 'publishing');
  const card = mixedCard(task);
  for (const change of [{ tenantId: 'foreign' }, { programId: 'other' }, { packageId: 'other' }, { packageVersion: 3 }, { taskId: 'other' }, { publicationTaskId: 'other' }, { accountId: 'other' }]) {
    assert.equal(validatedCalendarPublicationDestination({ ...card, publicationExecutionTarget: { ...card.publicationExecutionTarget!, ...change } }, scope, [task]), null);
  }
  assert.equal(validatedCalendarPublicationDestination(card, { ...scope, tenantId: 'foreign' }, [task]), null);
  assert.equal(validatedCalendarPublicationDestination(card, scope, [task, task]), null);
  assert.equal(validatedCalendarPublicationDestination({ ...card, publicationExecutionTarget: undefined }, scope, [task]), null);
});
test('projection creates mutually exclusive entrances for inventory approval and its publishing execution', () => {
  const tasks = [execution('content', 'user_approval'), { ...execution('publishing', 'publishing'), taskId: 'publish' }];
  const cards = projectExecutionCalendar(tasks, STEP_LABEL);
  assert.ok(cards[0]?.inventoryTarget);
  assert.equal(cards[0]?.publicationExecutionTarget, undefined);
  assert.ok(cards[1]?.publicationExecutionTarget);
  assert.equal(cards[1]?.inventoryTarget, undefined);
});
