import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { applyWorkflowEvent } from './workflowState.js';
import { buildWeeklyWorkflow } from './weeklyPlanner.js';

test('workflow state: a directing failure blocks only its downstream branch', () => {
  const built = buildWeeklyWorkflow({
    packageId: 'pkg', version: 1, businessGoal: null, capacity: null, automationPolicy: null,
    publicationTasks: [], discoveryBudgetCny: 10,
  });
  const tasks = built.tasks.map(task => ({ ...task, status: 'planned' as const, ownBlockingReasons: [], inheritedBlockingTaskIds: [] }));
  const pkg = {
    workflows: built.workflows.map(item => ({ ...item, status: 'planned' as const, blockingReasons: [] })),
    workflowTasks: tasks, appliedWorkflowEvents: [], updatedAt: 'before',
  } as unknown as WeeklyOperatingPackage;
  const directing = tasks.find(task => task.kind === 'directing')!;
  const next = applyWorkflowEvent(pkg, { eventId: 'failure-1', taskId: directing.taskId, type: 'block', reason: 'brief_failed', occurredAt: 'after' });
  assert.equal(next.workflowTasks.find(task => task.kind === 'publishing')!.status, 'blocked');
  assert.equal(next.workflowTasks.find(task => task.kind === 'discovery')!.status, 'planned');
  assert.equal(next.workflowTasks.find(task => task.kind === 'readiness')!.status, 'planned');
});

test('workflow state: a task cannot start before all dependencies complete', () => {
  const built = buildWeeklyWorkflow({ packageId: 'pkg', version: 1, businessGoal: null, capacity: null, automationPolicy: null, publicationTasks: [], discoveryBudgetCny: null });
  const tasks = built.tasks.map(task => ({ ...task, status: 'planned' as const, ownBlockingReasons: [], inheritedBlockingTaskIds: [] }));
  const pkg = { workflows: built.workflows, workflowTasks: tasks, appliedWorkflowEvents: [], updatedAt: 'before' } as unknown as WeeklyOperatingPackage;
  const discovery = tasks.find(task => task.kind === 'discovery')!;
  assert.throws(
    () => applyWorkflowEvent(pkg, { eventId: 'early', taskId: discovery.taskId, type: 'start', occurredAt: 'after' }),
    /上游任务尚未完成/,
  );
});
