import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import {
  calendarItemKind,
  factualCalendarTitle,
  hourCalendarCard,
  hourCalendarCounts,
  hourCalendarTemporalState,
  hourCalendarWeekDates,
  missingDailyRollingCadence,
  sameAgentScheduleConflicts,
} from './agentHourCalendarPolicy';

const base: AgentCalendarTask = {
  id: 'task-1', date: '2026-10-14', time: '09:00', agent: 'content',
  title: '户外灯具雨天防水测试', output: '已冻结成片交付', context: 'ProductionPlan pp-1',
  minutes: 45, status: 'planned', productionTaskId: 'production-1',
};

test('week view derives one Monday-to-Sunday range from the same anchor', () => {
  assert.deepEqual(hourCalendarWeekDates('2026-10-14'), [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
  ]);
});

test('real task totals never include plan placeholders', () => {
  const placeholder = { ...base, id: 'placeholder', productionTaskId: undefined, output: '', calendarSummaryOnly: true };
  assert.equal(calendarItemKind(base), 'real_task');
  assert.equal(calendarItemKind(placeholder), 'plan_placeholder');
  assert.deepEqual(hourCalendarCounts([base, placeholder]), { realTasks: 1, planPlaceholders: 1 });
});

test('past completion receives a check while past unfinished work is overdue', () => {
  const now = Date.parse('2026-10-14T12:00:00+08:00');
  assert.equal(hourCalendarTemporalState({ ...base, status: 'completed' }, now), 'completed');
  assert.equal(hourCalendarCard({ ...base, status: 'completed' }, now).showCompletedCheck, true);
  assert.equal(hourCalendarTemporalState(base, now), 'overdue');
  assert.equal(hourCalendarCard(base, now).showCompletedCheck, false);
  assert.equal(hourCalendarCard(base, now).lines[2].endsWith('逾期'), true);
});

test('every hour-calendar card has exactly three stable rows', () => {
  const card = hourCalendarCard(base, Date.parse('2026-10-14T08:00:00+08:00'));
  assert.equal(card.lines.length, 3);
  assert.equal(card.lines[1], base.title);
  assert.equal(card.lines[0], '制片 · 内容');
  assert.match(card.lines[2], /09:00–09:45 · 待办/);
  assert.ok(card.lines[0].length < card.lines[1].length, '第一行应当弱化并短于关键内容标题');
  assert.ok(card.lines[2].length <= 16, '第三行只保留时间与短状态');
});

test('same agent tasks must be staggered while different agents may execute concurrently', () => {
  const conflicts = sameAgentScheduleConflicts([
    base,
    { ...base, id: 'content-overlap', time: '09:30' },
    { ...base, id: 'director-parallel', agent: 'director', time: '09:30' },
  ]);
  assert.deepEqual(conflicts, [{ agent: 'content', firstId: 'task-1', secondId: 'content-overlap' }]);
});

test('daily rolling plan requires incremental collection and production on every visible day', () => {
  const dates = hourCalendarWeekDates('2026-10-14');
  const complete = dates.flatMap(date => ([
    { date, kind: 'incremental_benchmark_collection' as const },
    { date, kind: 'daily_production' as const },
  ]));
  assert.deepEqual(missingDailyRollingCadence('2026-10-14', complete), []);
  assert.deepEqual(missingDailyRollingCadence('2026-10-14', complete.filter(item => !(item.date === '2026-10-15' && item.kind === 'daily_production'))), [
    { date: '2026-10-15', kind: 'daily_production' },
  ]);
});

test('film titles come only from frozen evidence and never from frontend invention', () => {
  assert.equal(factualCalendarTitle({ productionPlanTitle: '户外灯具雨天防水测试', approvedScriptTitle: '不得覆盖', approvedTopic: '不得覆盖' }), '户外灯具雨天防水测试');
  assert.equal(factualCalendarTitle({ approvedScriptTitle: '真实脚本标题', approvedTopic: '真实选题' }), '真实脚本标题');
  assert.equal(factualCalendarTitle({ approvedTopic: '真实选题' }), '真实选题');
  assert.equal(factualCalendarTitle({}), '选题等待编导确认');
  assert.notEqual(factualCalendarTitle({}), '成片生产');
});

test('placeholder copy cannot masquerade as a real task', () => {
  const counts = hourCalendarCounts([{ ...base, id: 'empty', output: '', productionTaskId: undefined, calendarSummaryOnly: true }]);
  assert.equal(counts.realTasks, 0);
  assert.equal(counts.planPlaceholders, 1);
  assert.doesNotMatch(JSON.stringify(counts), /尚未生成独立任务/);
});
