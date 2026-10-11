import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar from './RestoredAgentWorkCalendar';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
const base: AgentCalendarTask = {id:'business',date:'2026-10-12',time:'10:00',agent:'business',title:'冻结经营任务',output:'经营交付',context:'实际范围',minutes:30,status:'planned',dueAt:'2026-10-12T10:00:00+08:00'};
test('Agent filtering preserves human handoffs and does not display another Agent task', () => {
  const tasks = [base, {...base,id:'content',agent:'content' as const,title:'冻结内容任务'}, {...base,id:'human',agent:'human' as const,title:'冻结人工交接'}];
  const html = renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks,agentRole:'business'}));
  assert.match(html,/冻结经营任务/); assert.match(html,/冻结人工交接/); assert.doesNotMatch(html,/冻结内容任务/);
  assert.deepEqual(tasks.map(task=>task.id),['business','content','human']);
});
test('restored calendar retains overdue evidence and late-completion receipts', () => {
  const html=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks:[{...base,id:'overdue',dueAt:'2020-10-12T10:00:00+08:00',date:'2020-10-12',status:'active',affectedPublicationIds:['original-publication']},{...base,id:'late',status:'completed',deliveryTiming:'late',actualFinishedAt:'2026-10-12T11:00:00+08:00'}]}));
  assert.match(html,/交付已逾期/);assert.match(html,/original-publication/);assert.match(html,/已完成 · 晚交付/);
});
