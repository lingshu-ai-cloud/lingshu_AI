import assert from 'node:assert/strict';
import { calendarDay, dayLabel, evidenceDay, ganttDays, ganttRecordRange, ganttSpan } from './weeklyGantt';
const days = ganttDays('2026-09-03', '2026-09-09');
assert.equal(days.length, 7);
assert.equal(dayLabel(days[6]), '2026-09-09');
assert.equal(calendarDay('2026-02-30'), null);
assert.equal(calendarDay('2026-9-3'), null);
assert.deepEqual(ganttDays('2026-09-09', '2026-09-03'), []);
assert.equal(ganttDays('2024-02-28', '2024-03-01').length, 3);
assert.equal(evidenceDay('2026-09-05T16:01:00Z'), calendarDay('2026-09-06'));
assert.equal(evidenceDay('invalid'), null);
assert.deepEqual(ganttSpan(days[0] - 2, days[6] + 1, days), { left: 0, width: 100 });
assert.equal(ganttSpan(days[6]+1, days[6]+2, days), null);
assert.equal(ganttSpan(days[0], days[0]-1, days), null);
const task = { id:'t1', run_id:'r1', status:'succeeded', updated_at:'2026-09-06T10:00:00Z' };
const events = [
  {task_id:'t1',run_id:'r1',type:'task.started',occurred_at:'2026-09-05T16:01:00Z'},
  {task_id:'t1',run_id:'r1',type:'task.completed',occurred_at:'2026-09-07T02:00:00Z'},
  {task_id:'t1',run_id:'other-run',type:'task.started',occurred_at:'2026-09-01T02:00:00Z'},
  {task_id:'other-task',run_id:'r1',type:'task.started',occurred_at:'2026-09-01T02:00:00Z'},
  {task_id:'t1',run_id:'r1',type:'task.created',occurred_at:'2026-09-01T02:00:00Z'},
];
assert.deepEqual(ganttRecordRange(task, events), {start:calendarDay('2026-09-06'),end:calendarDay('2026-09-07'),label:'已加载执行记录'});
const point = ganttRecordRange(task, []);
assert.equal(point?.start, point?.end, 'last update must not invent a duration');
assert.equal(point?.label, '最近更新');
assert.equal(ganttRecordRange({...task,status:'pending'}, []), null, 'new pending tasks have no execution history');
assert.equal(ganttRecordRange(undefined, events), null);
console.log('Weekly gantt date, clipping and evidence tests passed');
