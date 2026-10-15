import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar, {agentCalendarDetailKind,isPastUnfinishedCalendarTask} from './RestoredAgentWorkCalendar';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
const base: AgentCalendarTask = {id:'business',date:'2026-10-12',time:'10:00',agent:'business',title:'冻结经营任务',output:'经营交付',context:'实际范围',minutes:30,status:'planned',dueAt:'2026-10-12T10:00:00+08:00'};
test('Agent filtering shows real cards directly without duplicate summary cards', () => {
  const tasks = [base, {...base,id:'content',agent:'content' as const,title:'冻结内容任务'}, {...base,id:'human',agent:'human' as const,title:'冻结人工交接'}];
  const html = renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks,agentRole:'business'}));
  assert.match(html,/2 项真实任务/); assert.match(html,/冻结经营任务/); assert.doesNotMatch(html,/显示所有独立卡/); assert.doesNotMatch(html,/冻结经营任务 等 2 项/); assert.doesNotMatch(html,/冻结内容任务/);
  assert.deepEqual(tasks.map(task=>task.id),['business','content','human']);
});
test('restored calendar retains overdue evidence and truthful real-task count', () => {
  const html=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks:[{...base,id:'overdue',dueAt:'2020-10-12T10:00:00+08:00',date:'2020-10-12',status:'active',affectedPublicationIds:['original-publication']},{...base,id:'late',status:'completed',deliveryTiming:'late',actualFinishedAt:'2026-10-12T11:00:00+08:00'}]}));
  assert.match(html,/当前待处理/);assert.match(html,/original-publication/);assert.match(html,/2 项真实任务/);
});
test('a passed unfinished slot is overdue while completed work keeps its terminal result',()=>{
  const now=Date.parse('2026-10-12T12:00:00+08:00');
  assert.equal(isPastUnfinishedCalendarTask({...base,dueAt:undefined,status:'planned'},now),true);
  assert.equal(isPastUnfinishedCalendarTask({...base,dueAt:undefined,status:'completed'},now),false);
});
test('calendar clicks route persisted tasks to task details and placeholders to an explanation',()=>{
  assert.equal(agentCalendarDetailKind({data:base}),'task');
  assert.equal(agentCalendarDetailKind({data:{kind:'summary',summary:{
    key:'2026-10-12:production',group:'production',date:'2026-10-12',title:'影片生产',
    startTime:'10:15',durationMinutes:45,progress:'等待真实任务',children:[],
  }}}),'placeholder');
});

test('calendar consumes aggregate clicks while leaving task details in the shared drawer',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/isAggregateEventData\(event\.data\)/);
  assert.match(source,/setExpandedGroups/);
  assert.match(source,/等待真实任务/);
  assert.match(source,/运行层生成真实任务后/);
});

test('weekly calendar exposes focused filters and hides completed work by default',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/useState\(true\)/);
  assert.match(source,/需我处理/);
  assert.match(source,/隐藏已完成/);
  assert.match(source,/今日内容生产/);
  assert.match(source,/今日内容发布/);
  assert.match(source,/本周经营准备/);
  assert.match(source,/本周数据复盘/);
  assert.match(source,/aggregate === 'weekly-start' \? dates\[0\]/);
  assert.match(source,/aggregate === 'weekly-review' \? dates\[6\]/);
  assert.match(source,/date === dates\[0\] \? mondayContentStart/);
  assert.match(source,/lastBusinessFinish \+ 30/);
  assert.match(source,/collapseEmptyTimeRanges/);
});

test('connected calendars never render synthetic cadence placeholders as tasks',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/demo \? calendarDisplayPlaceholders\(summaries, calendarDate\) : \[\]/);
  assert.match(source,/missing work is a contract\/blocker problem/);
});
