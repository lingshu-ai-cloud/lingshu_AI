import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { agentCalendarIdentityLabel, agentCalendarResponsibleAgent, taskHasDeliverableOrWorkspace } from './agentCalendarGroups';

export type HourCalendarItemKind = 'real_task' | 'plan_placeholder';
export type HourCalendarTemporalState = 'completed' | 'overdue' | 'current' | 'future' | 'cancelled';

export type HourCalendarCounts = {
  realTasks: number;
  planPlaceholders: number;
};

export type HourCalendarCard = {
  lines: readonly [string, string, string];
  temporalState: HourCalendarTemporalState;
  showCompletedCheck: boolean;
};

export type CalendarTitleEvidence = {
  productionPlanTitle?: string | null;
  approvedScriptTitle?: string | null;
  approvedTopic?: string | null;
};

export type DailyRollingTask = {
  date: string;
  kind: 'incremental_benchmark_collection' | 'daily_production';
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hourCalendarWeekDates(anchor: string): string[] {
  const parsed = new Date(`${anchor.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return [];
  const monday = new Date(parsed);
  monday.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function calendarItemKind(task: AgentCalendarTask): HourCalendarItemKind {
  return taskHasDeliverableOrWorkspace(task) ? 'real_task' : 'plan_placeholder';
}

export function hourCalendarCounts(tasks: AgentCalendarTask[]): HourCalendarCounts {
  return tasks.reduce<HourCalendarCounts>((counts, task) => {
    if (calendarItemKind(task) === 'real_task') counts.realTasks += 1;
    else counts.planPlaceholders += 1;
    return counts;
  }, { realTasks: 0, planPlaceholders: 0 });
}

function scheduledEnd(task: AgentCalendarTask): number {
  if (task.dueAt && Number.isFinite(Date.parse(task.dueAt))) return Date.parse(task.dueAt);
  const start = Date.parse(`${task.date}T${task.time || '09:00'}:00+08:00`);
  return start + Math.max(30, task.minutes ?? 60) * 60_000;
}

export function hourCalendarTemporalState(task: AgentCalendarTask, now = Date.now()): HourCalendarTemporalState {
  if (task.status === 'completed') return 'completed';
  if (['cancelled', 'no_data'].includes(task.status)) return 'cancelled';
  const end = scheduledEnd(task);
  if (end <= now) return 'overdue';
  const start = end - Math.max(30, task.minutes ?? 60) * 60_000;
  return start <= now ? 'current' : 'future';
}

export function factualCalendarTitle(evidence: CalendarTitleEvidence): string {
  return text(evidence.productionPlanTitle)
    || text(evidence.approvedScriptTitle)
    || text(evidence.approvedTopic)
    || '选题等待编导确认';
}

export function hourCalendarCard(task: AgentCalendarTask, now = Date.now()): HourCalendarCard {
  const temporalState = hourCalendarTemporalState(task, now);
  const [hour = 0, minute = 0] = task.time.split(':').map(Number);
  const endMinutes = hour * 60 + minute + Math.max(30, task.minutes ?? 60);
  const end = task.minutes === null ? '' : `–${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const stateLabel = temporalState === 'completed' ? '完成'
    : temporalState === 'overdue' ? '逾期'
    : temporalState === 'current' ? '进行'
    : temporalState === 'cancelled' ? '取消'
    : '待办';
  return {
    lines: [
      agentCalendarIdentityLabel(agentCalendarResponsibleAgent(task.executionStep, task.agent)),
      task.title,
      `${task.time}${end} · ${stateLabel}`,
    ],
    temporalState,
    showCompletedCheck: temporalState === 'completed',
  };
}

export function sameAgentScheduleConflicts(tasks: AgentCalendarTask[]): Array<{ agent: AgentCalendarTask['agent']; firstId: string; secondId: string }> {
  const conflicts: Array<{ agent: AgentCalendarTask['agent']; firstId: string; secondId: string }> = [];
  const byAgent = new Map<AgentCalendarTask['agent'], AgentCalendarTask[]>();
  for (const task of tasks) byAgent.set(task.agent, [...(byAgent.get(task.agent) || []), task]);
  for (const [agent, owned] of byAgent) {
    const sorted = [...owned].sort((a, b) => Date.parse(`${a.date}T${a.time}:00+08:00`) - Date.parse(`${b.date}T${b.time}:00+08:00`));
    for (let index = 1; index < sorted.length; index += 1) {
      const first = sorted[index - 1]!;
      const second = sorted[index]!;
      const firstStart = Date.parse(`${first.date}T${first.time}:00+08:00`);
      const firstEnd = firstStart + Math.max(30, first.minutes ?? 60) * 60_000;
      const secondStart = Date.parse(`${second.date}T${second.time}:00+08:00`);
      if (secondStart < firstEnd) conflicts.push({ agent, firstId: first.id, secondId: second.id });
    }
  }
  return conflicts;
}

export function missingDailyRollingCadence(anchor: string, tasks: DailyRollingTask[]): Array<{ date: string; kind: DailyRollingTask['kind'] }> {
  const expected = hourCalendarWeekDates(anchor);
  const present = new Set(tasks.map(task => `${task.date}:${task.kind}`));
  return expected.flatMap(date => (['incremental_benchmark_collection', 'daily_production'] as const)
    .filter(kind => !present.has(`${date}:${kind}`))
    .map(kind => ({ date, kind })));
}
