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
test('production entry requires an actual content object or complete customer workflow binding', async () => {
  const { hasCalendarProductionBinding } = await import('./AgentWeeklyCalendar');
  assert.equal(hasCalendarProductionBinding({ agent:'customer', customerRunId:'run', customerWorkflowTaskId:'workflow-task', customerTaskKey:'followup_batch_draft' } as AgentCalendarTask),true);
  assert.equal(hasCalendarProductionBinding({ agent:'customer', customerRunId:'run', customerWorkflowTaskId:'workflow-task' } as AgentCalendarTask),false);
  assert.equal(hasCalendarProductionBinding({ agent:'business', customerRunId:'run', customerWorkflowTaskId:'workflow-task', customerTaskKey:'followup_batch_draft' } as AgentCalendarTask),false);
  assert.equal(hasCalendarProductionBinding({ agent:'content', productionTaskId:'real-content-task' } as AgentCalendarTask),true);
});
test('human material entry requires an explicit real request and supported production action',async()=>{
 const {hasCalendarProductionBinding}=await import('./AgentWeeklyCalendar');
 assert.equal(hasCalendarProductionBinding({agent:'human',materialRequestId:'real-request',materialAction:'verification'} as AgentCalendarTask),true);
 assert.equal(hasCalendarProductionBinding({agent:'human',materialRequestId:'real-request'} as AgentCalendarTask),false);
 assert.equal(hasCalendarProductionBinding({agent:'business',materialRequestId:'real-request',materialAction:'upload'} as AgentCalendarTask),false);
});
test('unknown human workload is shown as missing estimates rather than zero scheduled hours',async()=>{
 const {calendarDurationLabel}=await import('./AgentWeeklyCalendar');
 assert.equal(calendarDurationLabel([{minutes:null}] as AgentCalendarTask[]),'1 项工时待估');
 assert.equal(calendarDurationLabel([{minutes:60},{minutes:null}] as AgentCalendarTask[]),'已估 1 小时 · 1 项待估');
});

test('running and blocked Agent deliveries become overdue without changing their actual status', async () => {
  const {isCalendarTaskOverdue, calendarPendingReferences, calendarOverdueDuration} = await import('./AgentWeeklyCalendar');
  const now = Date.parse('2026-10-09T12:00:00+08:00');
  const actual = {...task, id:'actual', agent:'content', date:'2026-10-06', status:'active'} as AgentCalendarTask;
  assert.equal(isCalendarTaskOverdue(actual, Date.parse(due)), false);
  assert.equal(isCalendarTaskOverdue(actual, now), true);
  assert.equal(isCalendarTaskOverdue({...actual,status:'blocked'}, now), true);
  assert.equal(isCalendarTaskOverdue({...actual,agent:'human',deadlineTracked:true,availableForHuman:false},now),true);
  assert.equal(isCalendarTaskOverdue({...actual,status:'completed'}, now), false);
  assert.equal(calendarPendingReferences([actual,actual,{...actual,id:'cancelled',status:'cancelled'}],now).length,1);
  assert.equal(calendarPendingReferences([actual],now)[0],actual);
  assert.equal(actual.date,'2026-10-06'); assert.equal(actual.status,'active');
  assert.equal(calendarOverdueDuration(actual,now),'2 天 19 小时');
});
test('rendered calendar shows overdue original card and one current reference with truthful late delivery', async () => {
  const {createElement} = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const {default:Calendar} = await import('./AgentWeeklyCalendar');
  const yesterday = new Date(Date.now()-86400000);
  const date = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth()+1).padStart(2,'0')}-${String(yesterday.getUTCDate()).padStart(2,'0')}`;
  const actual = {id:'persisted',date,time:'12:00',agent:'content',status:'active',title:'真实视频交付',output:'待核验',context:'真实范围',minutes:10,dueAt:yesterday.toISOString(),affectedPublicationIds:['publication-1']} as AgentCalendarTask;
  const html = renderToStaticMarkup(createElement(Calendar,{startsAt:date,tasks:[actual,{...actual,id:'completed',status:'completed',deliveryTiming:'late',actualFinishedAt:new Date().toISOString()}]}));
  assert.match(html,/交付已逾期/); assert.match(html,/当前待处理 · 1/); assert.match(html,/publication-1/);
  assert.match(html,/已完成 · 晚交付/); assert.match(html,/引用原任务/);
});
