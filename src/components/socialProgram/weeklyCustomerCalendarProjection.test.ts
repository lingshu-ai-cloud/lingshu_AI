import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCustomerCalendarTask, customerCalendarTasks } from './weeklyCustomerCalendarProjection';
import type { CustomerCalendarTask } from './CustomerWeeklyCalendar';
const task: CustomerCalendarTask = { step:'customer_followup_dispatch', taskId:'workflow-task', taskKey:'followup_dispatch', title:'真实客户跟进', status:'succeeded', evidenceStatus:'blocked', reason:'receipt_pending', scheduledAt:'2026-10-06T09:00:00+08:00', latestFinishAt:null, estimateDurationMinutes:null };
test('unknown schedule cannot become a fabricated calendar task', () => {
  for (const scheduledAt of [null,'invalid']) assert.equal(projectCustomerCalendarTask('run',{...task,scheduledAt}),null);
  assert.deepEqual(customerCalendarTasks({binding:null,tasks:[task],scheduleGaps:[]}),[]);
});
test('real timestamp projects execution start and explicit customer identity while unverified success stays blocked', () => {
  const projected = projectCustomerCalendarTask('run',task)!;
  assert.equal(projected.timeSemantics,'start'); assert.equal(projected.status,'blocked'); assert.equal(projected.minutes,null);
  assert.equal(projected.customerRunId,'run'); assert.equal(projected.customerWorkflowTaskId,'workflow-task');
  assert.equal(projected.customerTaskKey,'followup_dispatch'); assert.equal(projected.productionTaskId,undefined);
  assert.equal(projectCustomerCalendarTask('run',{...task,evidenceStatus:'no_data'})!.status,'no_data');
  assert.equal(projectCustomerCalendarTask('run',{...task,evidenceStatus:'succeeded'})!.status,'completed');
});
