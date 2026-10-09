import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { weeklyDeadlineTriggers } from './socialWeeklyDeadlineRecovery.js';
const task = (status: WeeklyExecutionTask['status'] = 'queued') => ({ taskId: 'original-task', status, schedule: { latestFinishAt: '2026-10-09T12:00:00+08:00', estimatedFinishAt: '2026-10-09T13:00:00+08:00', latestStartAt: '2026-10-09T11:00:00+08:00', estimatedDurationMinutes: 60 } } as WeeklyExecutionTask);
test('remaining work triggers assessment before deadline while running tasks remain overdue', () => {
  assert.deepEqual(weeklyDeadlineTriggers([task()], new Date('2026-10-09T11:01:00+08:00')), [{ taskId: 'original-task', dueAt: '2026-10-09T12:00:00+08:00', reason: 'remaining_time_insufficient' }]);
  assert.equal(weeklyDeadlineTriggers([task('leased')], new Date('2026-10-10T12:00:00+08:00'))[0]?.reason, 'deadline_overdue');
  assert.deepEqual(weeklyDeadlineTriggers([task('succeeded'), task('cancelled')], new Date('2026-10-10T12:00:00+08:00')), []);
});
test('deadline selection retains original latest finish and does not invent absent deadlines', () => {
  const value = task(); value.schedule.latestFinishAt = null;
  assert.equal(weeklyDeadlineTriggers([value], new Date('2026-10-09T12:01:00+08:00'))[0]?.dueAt, value.schedule.estimatedFinishAt);
  value.schedule.estimatedFinishAt = '';
  assert.deepEqual(weeklyDeadlineTriggers([value], new Date('2026-10-10T12:00:00+08:00')), []);
});
