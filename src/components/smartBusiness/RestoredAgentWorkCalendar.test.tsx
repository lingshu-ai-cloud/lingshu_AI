import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar, {calendarExecutionMark,calendarTaskPresentation,hasCtaContactGap,isPastUnfinishedCalendarTask,taskProgressPercent} from './RestoredAgentWorkCalendar';
import { ganttFocusDay, ganttWeeks, groupGanttNodesByWeek, type GanttRow } from './AgentVideoProductionBoard';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
const base: AgentCalendarTask = {id:'business',date:'2026-10-12',time:'10:00',agent:'business',title:'冻结经营任务',output:'经营交付',context:'实际范围',minutes:30,status:'planned',dueAt:'2026-10-12T10:00:00+08:00'};
test('production nodes preserve their stage order inside weekly columns',()=>{
 const rows: GanttRow[] = [
  {id:'a',stage:null,task:{...base,id:'a'},status:'planned',label:'任务 A',owner:'经营 Agent'},
  {id:'b',stage:null,task:{...base,id:'b'},status:'planned',label:'任务 B',owner:'经营 Agent'},
  {id:'c',stage:null,task:{...base,id:'c',date:'2026-10-20'},status:'planned',label:'任务 C',owner:'经营 Agent'},
 ];
 const weeks=ganttWeeks(rows.map(row=>row.task!));
 const grouped=groupGanttNodesByWeek(rows,weeks);
 assert.deepEqual(grouped.map(nodes=>nodes.map(node=>node.id)),[['a','b'],['c']]);
 assert.equal(ganttFocusDay(rows.map(row=>row.task!),'2026-10-20'),'2026-10-20');
});
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
test('video task board uses the fixed production path and direct execution never substitutes a status workspace',()=>{
 const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
 const connected=readFileSync(new URL('./ConnectedAgentCalendar.tsx',import.meta.url),'utf8');
 const bridge=readFileSync(new URL('../socialProgram/WeeklyCustomerCalendar.tsx',import.meta.url),'utf8');
 assert.match(source,/AgentVideoProductionBoard/);
 assert.match(source,/productionStageContract/);
 assert.doesNotMatch(source,/<LsCalendar[\s/>]|firstDay=|narrowView=|timeGridHeight=/);
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
  assert.match(html,/冻结经营任务/); assert.match(html,/冻结人工交接/); assert.doesNotMatch(html,/显示所有独立卡/); assert.doesNotMatch(html,/冻结经营任务 等 2 项/); assert.doesNotMatch(html,/冻结内容任务/);
  assert.deepEqual(tasks.map(task=>task.id),['business','content','human']);
});
test('restored calendar omits the duplicate page-level overdue alert', () => {
  const html=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks:[{...base,id:'overdue',dueAt:'2020-10-12T10:00:00+08:00',date:'2020-10-12',status:'active',affectedPublicationIds:['original-publication']},{...base,id:'late',status:'completed',deliveryTiming:'late',actualFinishedAt:'2026-10-12T11:00:00+08:00'}]}));
  assert.doesNotMatch(html,/当前待处理|张任务卡|项工时待估/);
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

test('production command center keeps filters out of the overview while lower-level calendars retain optional filtering',()=>{
  const source=readFileSync(new URL('./RestoredAgentWorkCalendar.tsx',import.meta.url),'utf8');
  const workspace=readFileSync(new URL('./DigitalEmployeeWorkspace.tsx',import.meta.url),'utf8');
  const connected=readFileSync(new URL('./ConnectedAgentCalendar.tsx',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../socialProgram/WeeklyCustomerCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/hideCompleted = false/);
  assert.match(source,/filter\(task => !hideCompleted \|\| !\['completed', 'cancelled', 'no_data'\]\.includes\(task\.status\)\)/);
  assert.doesNotMatch(source,/aria-label="按智能体筛选"|需我处理|隐藏已完成|张任务卡|calendarDurationLabel/);
  assert.doesNotMatch(workspace, /四位数字员工正在如何协作|数字员工实时状态|隐藏已完成|Agent 协作在线/);
  assert.doesNotMatch(workspace, /<RestoredAgentWorkCalendar[^>]*(?:hideCompleted|agentRole)=/);
  assert.doesNotMatch(workspace, /<ConnectedAgentCalendar[^>]*(?:hideCompleted|agentRole)=/);
  assert.doesNotMatch(connected, /经营项目：|请选择周任务包|查看周任务包版本/);
  assert.match(connected, /<WeeklyCustomerCalendar[^>]*hideCompleted=\{hideCompleted\}/);
  assert.match(bridge, /<AgentWeeklyCalendar[^>]*hideCompleted=\{hideCompleted\}/);
  assert.match(source,/<AgentVideoProductionBoard events=\{events\}/);
  assert.match(source,/const allDay = true/);
  assert.doesNotMatch(source,/visualVariant="agent"|dateOnly|taskBoard/);
  assert.doesNotMatch(source,/06:00 起|T\$\{resident\?'00:00':'06:00'/);
});

test('the external completed-work filter removes terminal events without mutating source tasks',()=>{
  const tasks=[base,{...base,id:'done',title:'冻结已完成任务',status:'completed' as const}];
  const visible=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks}));
  const hidden=renderToStaticMarkup(createElement(Calendar,{startsAt:base.date,tasks,hideCompleted:true}));
  assert.match(visible,/冻结已完成任务/);
  assert.doesNotMatch(hidden,/冻结已完成任务/);
  assert.deepEqual(tasks.map(task=>task.id),['business','done']);
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
  assert.doesNotMatch(source,/Agent 周任务日历<\/h3>|当前周视图：|任务包有效期：/);
});
