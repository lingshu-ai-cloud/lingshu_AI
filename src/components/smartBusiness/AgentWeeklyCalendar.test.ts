import assert from 'node:assert/strict';
import test from 'node:test';
import { isHumanTaskOverdue, type AgentCalendarTask } from './AgentWeeklyCalendar';
const due = '2026-10-06T17:00:00+08:00';
const task = { agent:'human', status:'planned', dueAt:due, submission:'missing' } as AgentCalendarTask;
test('human overdue distinguishes submission, verification and terminal states', () => {
  const before=Date.parse(due)-1, after=Date.parse(due)+1;
  assert.equal(isHumanTaskOverdue(task,before),false);
  assert.equal(isHumanTaskOverdue(task,after),true);
  assert.equal(isHumanTaskOverdue({...task,submission:'rejected'},after),true);
  assert.equal(isHumanTaskOverdue({...task,submission:'pending'},after),false);
  assert.equal(isHumanTaskOverdue({...task,submission:'accepted'},after),false);
  assert.equal(isHumanTaskOverdue({...task,status:'cancelled'},after),false);
  assert.equal(isHumanTaskOverdue({...task,availableForHuman:false},after),false);
  assert.equal(isHumanTaskOverdue({...task,dueAt:'invalid'},after),false);
});
