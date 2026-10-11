import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyWorkStatus, taskExecutionStatus } from './weekly-work-status.mjs';
const task = {id: 't', run_id: 'r', sequence: 1, title: '生成视频', status: 'waiting_external', blocked_reason: '等待供应商回写'};
const input = {goal: {id: 'g'}, run: {id: 'r', goal_id: 'g', status: 'running'}, tasks: [task]};
test('external wait retains real reason and never becomes active production', () => {
  const view = weeklyWorkStatus(input);
  assert.equal(view.phase, 'queued'); assert.equal(view.blocker, task.blocked_reason); assert.equal(view.description, task.blocked_reason);
});
test('unknown run state cannot be inferred from a pending projected task', () => {
  assert.equal(weeklyWorkStatus({...input, run: {...input.run, status: 'unrecognized'}, tasks: [{...task, status: 'pending'}]}).phase, 'unknown');
});
test('task projection does not invent run identity, totals or next operations', () => {
  const view = taskExecutionStatus(task);
  assert.equal(view.phase, 'waiting'); assert.equal(view.next, ''); assert.equal(view.blocker, task.blocked_reason);
  assert.equal('runId' in view, false); assert.equal('completedTasks' in view, false);
  assert.equal(taskExecutionStatus({status: 'new_status'}).phase, 'unknown');
  assert.equal(taskExecutionStatus({status: 'failed'}).outcome, 'failed');
  assert.equal(taskExecutionStatus({status: 'skipped'}).outcome, null);
});
test('web and native generated module return identical projections', async () => {
  const {readFileSync} = await import('node:fs');
  const {runInNewContext} = await import('node:vm');
  const module = {exports:{}};
  runInNewContext(readFileSync(new URL('../apps/shooting-miniapp/lib/generated/weekly-work-status.js', import.meta.url), 'utf8'), {module});
  const native = module.exports;
  assert.deepEqual(JSON.parse(JSON.stringify(native.weeklyWorkStatus(input))), weeklyWorkStatus(input));
  assert.deepEqual(JSON.parse(JSON.stringify(native.taskExecutionStatus(task))), taskExecutionStatus(task));
});
