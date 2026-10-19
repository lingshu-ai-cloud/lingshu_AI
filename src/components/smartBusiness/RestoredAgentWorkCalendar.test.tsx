import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar, {calendarExecutionMark,calendarTaskPresentation,hasCtaContactGap,isPastUnfinishedCalendarTask,taskProgressPercent} from './RestoredAgentWorkCalendar';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
const base: AgentCalendarTask = {id:'business',date:'2026-10-12',time:'10:00',agent:'business',title:'冻结经营任务',output:'经营交付',context:'实际范围',minutes:30,status:'planned',dueAt:'2026-10-12T10:00:00+08:00'};
test('only unfinished work before today receives an overdue exclamation mark',()=>{
 const today='2026-10-15';
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'blocked'},today),'missing');
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'planned'},today),'missing');
 assert.equal(calendarExecutionMark({...base,date:today,status:'blocked'},today),undefined);
 assert.equal(calendarExecutionMark({...base,date:'2026-10-16',status:'failed'},today),undefined);
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'active'},today),'missing');
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'completed'},today),'complete');
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'no_data'},today),undefined);
 assert.equal(calendarExecutionMark({...base,date:'2026-10-14',status:'cancelled'},today),undefined);
});
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
test('today progress is derived from persisted child states instead of wall-clock time',()=>{
  assert.equal(taskProgressPercent({...base,dailyTaskGroup:{tasks:[{...base,id:'done',status:'completed'},{...base,id:'working',status:'active'},{...base,id:'queued',status:'planned'}]}}),50);
  assert.equal(taskProgressPercent({...base,status:'completed'}),100);
  assert.equal(taskProgressPercent({...base,status:'active'}),50);
  assert.equal(taskProgressPercent(base),undefined);
});
test('day-aware presentation only judges unfinished work after its calendar day',()=>{
  assert.deepEqual(calendarTaskPresentation({...base,date:'2026-10-14',status:'completed'},'2026-10-15'),{status:'done',statusLabel:'已完成',muted:true});
  assert.deepEqual(calendarTaskPresentation({...base,date:'2026-10-14',status:'planned'},'2026-10-15'),{status:'needs_action',statusLabel:'结果未完成',muted:true});
  assert.deepEqual(calendarTaskPresentation({...base,date:'2026-10-15',status:'blocked'},'2026-10-15'),{status:'planned',statusLabel:'今日待执行',muted:false});
  assert.deepEqual(calendarTaskPresentation({...base,date:'2026-10-16',status:'failed'},'2026-10-15'),{status:'planned',statusLabel:'待执行',muted:false});
});
test('CTA contact gap shows blocked intervention on a pending card without completing the underlying task',()=>{
  const withGap={...base,executionBlockers:['cta_required']};
  assert.equal(hasCtaContactGap('missing'),true);
  assert.equal(hasCtaContactGap('recorded'),true);
  assert.equal(hasCtaContactGap('unavailable'),true);
  assert.equal(hasCtaContactGap(),false);
  assert.deepEqual(calendarTaskPresentation(withGap,'2026-10-12'),{status:'planned',statusLabel:'今日待执行',muted:false});
  assert.deepEqual(calendarTaskPresentation(withGap,'2026-10-12','missing'),{status:'needs_action',statusLabel:'受阻 · 联系待填',muted:false});
  assert.deepEqual(calendarTaskPresentation(withGap,'2026-10-12','recorded'),{status:'needs_action',statusLabel:'受阻 · 样品待证',muted:false});
  assert.deepEqual(calendarTaskPresentation(withGap,'2026-10-12','unavailable'),{status:'needs_action',statusLabel:'受阻 · 联系记录待恢复',muted:false});
  assert.deepEqual(calendarTaskPresentation({...withGap,status:'completed'},'2026-10-12','recorded'),{status:'done',statusLabel:'已完成',muted:false});
  const source=readFileSync(new URL('../socialProgram/WeeklyCtaContactIntervention.tsx',import.meta.url),'utf8');
  assert.match(source,/selectedProduct\?\.name/);
  assert.match(source,/免费样品承诺与其他生产条件仍待核验/);
  assert.doesNotMatch(source,/提交即确认该号码[\s\S]*免费样品承诺由企业实际履约/);
  const calendar=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(calendar,/action\.code === 'weekly_cta_contact_read_failed'/);
  assert.doesNotMatch(calendar.slice(calendar.indexOf('export function hasCtaContactGap'),calendar.indexOf('export function calendarExecutionMark')),/executionBlockers|reason/);
});
test('calendar renders only independent task events and keeps task details in the shared drawer',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/const orderedTasks = orderDailyCalendarTasks\(independentTasks\)/);
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
  assert.match(source,/const allDay = true/);
  assert.match(source,/visualVariant="agent"/);
  assert.doesNotMatch(source,/06:00 起|T\$\{resident\?'00:00':'06:00'/);
});

test('task details route specialized business targets before the generic execution fallback',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  const routing=source.slice(source.indexOf('const openSource='),source.indexOf('const channelLabel='));
  assert.ok(routing.indexOf('hasCalendarProductionBinding(source)')<routing.indexOf('if(onEnterExecution)return enterSource(source)'));
  assert.ok(routing.indexOf('source.customerExecutionTarget')<routing.indexOf('if(onEnterExecution)return enterSource(source)'));
  assert.match(source,/const open = \(action:[^]*?source = task\)[^]*?action\(source\)/);
  assert.match(routing,/open\(onOpenProduction,source\)/);
  assert.match(source,/data-daily-execution-id=\{source.id\}[^]*?onClick=\{\(\)=>openSource\(source\)\}/);
});

test('connected calendars never render synthetic cadence summaries as tasks',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/calendarDisplayPlaceholders|buildAgentCalendarSummaries|aggregate:/);
  assert.match(source,/\$\{independentTasks\.length\} 张任务卡/);
});
