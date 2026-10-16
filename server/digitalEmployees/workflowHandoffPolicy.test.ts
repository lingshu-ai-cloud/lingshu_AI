import assert from 'node:assert/strict';
import test from 'node:test';
import { planWorkflowHandoffAdmission, planWorkflowHandoffReturn, type ActiveWorkflowHandoff } from './workflowHandoffPolicy.js';

const handoff = (id: string, taskId: string, takenBy = 'user-a'): ActiveWorkflowHandoff => ({
  id,
  taskId,
  takenBy,
  startedAt: `2026-10-12T00:00:0${id.length}.000Z`,
});

test('a run admits only one active handoff while keeping same-user replay idempotent', () => {
  assert.deepEqual(planWorkflowHandoffAdmission([], { taskId: 'task-a', userId: 'user-a' }), { kind: 'create' });
  assert.equal(planWorkflowHandoffAdmission([handoff('h1', 'task-a')], { taskId: 'task-a', userId: 'user-a' }).kind, 'reuse');

  const otherTask = planWorkflowHandoffAdmission([handoff('h1', 'task-a')], { taskId: 'task-b', userId: 'user-a' });
  assert.equal(otherTask.kind, 'conflict');
  assert.equal(otherTask.kind === 'conflict' ? otherTask.code : '', 'run_handoff_already_active');

  const otherUser = planWorkflowHandoffAdmission([handoff('h1', 'task-a')], { taskId: 'task-a', userId: 'user-b' });
  assert.equal(otherUser.kind, 'conflict');
  assert.equal(otherUser.kind === 'conflict' ? otherUser.code : '', 'handoff_owned_by_another_user');
});

test('historical multiple active handoffs keep the run stopped until the last return', () => {
  const active = [handoff('h1', 'task-a'), handoff('h2', 'task-b', 'user-b')];
  const firstReturn = planWorkflowHandoffReturn(active, 'h1');
  assert.equal(firstReturn.canResumeRun, false);
  assert.deepEqual(firstReturn.remainingActiveHandoffs.map(item => item.id), ['h2']);
  assert.equal(firstReturn.remainingController, 'user-b');

  const lastReturn = planWorkflowHandoffReturn(firstReturn.remainingActiveHandoffs, 'h2');
  assert.equal(lastReturn.canResumeRun, true);
  assert.deepEqual(lastReturn.remainingActiveHandoffs, []);
});

test('an already-corrupt multi-active run rejects every new takeover', () => {
  const result = planWorkflowHandoffAdmission(
    [handoff('h1', 'task-a'), handoff('h2', 'task-b')],
    { taskId: 'task-a', userId: 'user-a' },
  );
  assert.equal(result.kind, 'conflict');
  assert.equal(result.kind === 'conflict' ? result.code : '', 'run_handoff_already_active');
});
