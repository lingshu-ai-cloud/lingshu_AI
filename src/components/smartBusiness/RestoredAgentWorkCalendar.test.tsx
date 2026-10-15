import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar, {isPastUnfinishedCalendarTask} from './RestoredAgentWorkCalendar';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
const base: AgentCalendarTask = {id:'business',date:'2026-10-12',time:'10:00',agent:'business',title:'冻结经营任务',output:'经营交付',context:'实际范围',minutes:30,status:'planned',dueAt:'2026-10-12T10:00:00+08:00'};
test('weekly board is Monday through Sunday and direct execution never substitutes a status workspace',()=>{
 const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
 const connected=readFileSync(new URL('./ConnectedAgentCalendar.tsx',import.meta.url),'utf8');
 const bridge=readFileSync(new URL('../socialProgram/WeeklyCustomerCalendar.tsx',import.meta.url),'utf8');
 assert.match(source,/firstDay=\{1\}/);
 assert.match(source,/交付物与当前受阻原因/);assert.match(source,/executionBlockers/);assert.match(source,/executionResultRefs/);
 assert.match(source,/onEnterExecution\(source,controller.signal\)/);assert.match(source,/进入真实执行界面/);
 assert.match(bridge,/onEnterExecution=\{onEnterExecution\}/);assert.match(connected,/onEnterExecution=\{enterExecution\}/);
 const handler=connected.slice(connected.indexOf('async function enterExecution'),connected.indexOf('if (!program)',connected.indexOf('async function enterExecution')));
 assert.match(handler,/readWeeklyContentNavigation/);assert.match(handler,/weeklyContentNavigationDetail\(binding\)/);
 assert.doesNotMatch(handler,/openWorkspace|readOrRepairWeeklyTaskWorkspace/,'a status snapshot is not a real production destination');
 assert.match(handler,/projection.binding/);assert.match(handler,/currentSelection.current===captured/);
});
test('Agent filtering shows real cards directly without duplicate summary cards', () => {
  const tasks = [base, {...base,id:'content',agent:'content' as const,title:'冻结内容任务'}, {...base,id:'human',agent:'human' as const,title:'冻结人工交接'}];
  const html = renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks,agentRole:'business'}));
assert.match(html,/2 张任务卡/); assert.match(html,/冻结经营任务/); assert.doesNotMatch(html,/显示所有独立卡/); assert.doesNotMatch(html,/冻结经营任务 等 2 项/); assert.doesNotMatch(html,/冻结内容任务/);
  assert.deepEqual(tasks.map(task=>task.id),['business','content','human']);
});
test('restored calendar omits the duplicate page-level overdue alert', () => {
  const html=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks:[{...base,id:'overdue',dueAt:'2020-10-12T10:00:00+08:00',date:'2020-10-12',status:'active',affectedPublicationIds:['original-publication']},{...base,id:'late',status:'completed',deliveryTiming:'late',actualFinishedAt:'2026-10-12T11:00:00+08:00'}]}));
  assert.doesNotMatch(html,/当前待处理/);assert.match(html,/2 张任务卡/);
});
test('a passed unfinished slot is overdue while completed work keeps its terminal result',()=>{
  const now=Date.parse('2026-10-12T12:00:00+08:00');
  assert.equal(isPastUnfinishedCalendarTask({...base,dueAt:undefined,status:'planned'},now),true);
  assert.equal(isPastUnfinishedCalendarTask({...base,dueAt:undefined,status:'completed'},now),false);
});
test('calendar renders only independent task events and keeps task details in the shared drawer',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/return orderDailyCalendarTasks\(independentTasks\)/);
  assert.doesNotMatch(source,/AggregateEventData|SummaryEventData|setExpandedGroups|calendarDisplayPlaceholders/);
  assert.match(source,/overdue && <Alert type="error" showIcon title=\{`交付已逾期/);
  assert.doesNotMatch(source,/交付已逾期[^\n]*description=/);
});

test('weekly calendar exposes focused filters and shows all daily work by default without an hour grid',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/\[hideCompleted, setHideCompleted\] = useState\(false\)/);
  assert.match(source,/需我处理/);
  assert.match(source,/隐藏已完成/);
  assert.match(source,/dateOnly[\s\S]*taskBoard[\s\S]*showAllEvents/);
});

test('connected calendars never render synthetic cadence summaries as tasks',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/calendarDisplayPlaceholders|buildAgentCalendarSummaries|aggregate:/);
  assert.match(source,/\$\{independentTasks\.length\} 张任务卡/);
});
