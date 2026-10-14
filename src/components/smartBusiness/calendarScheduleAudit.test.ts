import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { buildAgentCalendarSummaries } from './agentCalendarGroups';
import { countCalendarSchedule, findAgentScheduleConflicts } from './calendarScheduleAudit';

const dates = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'];
const task = (id: string, date: string, time: string, agent: AgentCalendarTask['agent'], status: AgentCalendarTask['status'] = 'planned'): AgentCalendarTask => ({
  id, date, time, agent, status, title: `真实任务 ${id}`, output: `真实交付 ${id}`, context: '冻结周计划', minutes: 30,
});

test('calendar counts keep real tasks, empty plan slots, pending humans and overdue tasks separate', () => {
  const tasks = [
    task('finished', dates[0]!, '08:30', 'director', 'completed'),
    task('late', dates[0]!, '10:15', 'content'),
    task('human', dates[2]!, '11:15', 'human', 'blocked'),
    {...task('deadline-late', dates[2]!, '18:00', 'business'), dueAt:'2026-10-12T11:59:00+08:00'},
    {...task('summary-only', dates[1]!, '10:15', 'content'), calendarSummaryOnly: true, output: ''},
  ];
  const summaries = buildAgentCalendarSummaries(tasks, dates);
  const counts = countCalendarSchedule(tasks, summaries, Date.parse('2026-10-12T12:00:00+08:00'));
  assert.equal(counts.realTasks, 4);
  assert.equal(counts.humanTasks, 1);
  assert.equal(counts.overdueTasks, 2);
  assert.ok(counts.plannedSlots > 0);
  assert.notEqual(counts.realTasks, summaries.length, 'daily placeholders must never inflate the real task count');
});

test('same-Agent overlap is rejected while adjacent windows and different Agents are allowed', () => {
  const tasks = [
    {...task('production', dates[2]!, '10:15', 'content'), minutes: 45},
    {...task('quality-adjacent', dates[2]!, '11:00', 'content'), minutes: 30},
    {...task('content-overlap', dates[2]!, '10:30', 'content'), minutes: 30},
    {...task('director-parallel', dates[2]!, '10:30', 'director'), minutes: 30},
  ];
  assert.deepEqual(findAgentScheduleConflicts(tasks), [{agent:'content',leftId:'production',rightId:'content-overlap'}]);
});

test('daily contract includes fresh collection and production on every day with bounded execution windows', () => {
  const summaries = buildAgentCalendarSummaries([], dates);
  for (const date of dates) {
    const daily = summaries.filter(summary => summary.date === date);
    assert.ok(daily.some(summary => summary.group === 'directing' && summary.title === '每日增量采集与编导'));
    assert.ok(daily.some(summary => summary.group === 'production' && summary.title === '影片生产'));
    assert.ok(daily.filter(summary => ['directing','production','quality'].includes(summary.group)).every(summary => summary.durationMinutes <= 75));
  }
});
