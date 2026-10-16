import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { taskHasDeliverableOrWorkspace, type AgentCalendarSummary } from './agentCalendarGroups';

const terminalStatuses = new Set<AgentCalendarTask['status']>(['completed', 'cancelled', 'no_data']);

function taskStart(task: AgentCalendarTask): number {
  if (task.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt)) {
    const parsed = Date.parse(task.dueAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const offset = task.calendarClock?.offsetMinutes ?? 8 * 60;
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const suffix = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return Date.parse(`${task.date}T${task.time || '09:00'}:00${suffix}`);
}

function taskEnd(task: AgentCalendarTask): number {
  return taskStart(task) + Math.max(30, task.minutes ?? 60) * 60_000;
}

function taskOverdueBoundary(task: AgentCalendarTask): number {
  if (task.dueAt) {
    const due = Date.parse(task.dueAt);
    if (Number.isFinite(due)) return due;
  }
  return taskEnd(task);
}

export type CalendarScheduleCounts = {
  realTasks: number;
  plannedSlots: number;
  humanTasks: number;
  overdueTasks: number;
};

/** Counts execution facts separately from empty daily plan slots. */
export function countCalendarSchedule(
  tasks: AgentCalendarTask[],
  summaries: AgentCalendarSummary[],
  now: number,
): CalendarScheduleCounts {
  const real = tasks.filter(taskHasDeliverableOrWorkspace);
  return {
    realTasks: real.length,
    plannedSlots: summaries.filter(summary => summary.children.length === 0).length,
    humanTasks: real.filter(task => task.agent === 'human' && !terminalStatuses.has(task.status)).length,
    overdueTasks: real.filter(task => !terminalStatuses.has(task.status) && taskOverdueBoundary(task) < now).length,
  };
}

export type AgentScheduleConflict = { agent: AgentCalendarTask['agent']; leftId: string; rightId: string };

/** Finds actual same-Agent overlaps; touching windows do not conflict. */
export function findAgentScheduleConflicts(tasks: AgentCalendarTask[]): AgentScheduleConflict[] {
  const scheduled = tasks.filter(task => taskHasDeliverableOrWorkspace(task) && Number.isFinite(taskStart(task)));
  const conflicts: AgentScheduleConflict[] = [];
  for (let leftIndex = 0; leftIndex < scheduled.length; leftIndex += 1) {
    const left = scheduled[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < scheduled.length; rightIndex += 1) {
      const right = scheduled[rightIndex]!;
      if (left.agent !== right.agent || left.date !== right.date) continue;
      if (taskStart(left) < taskEnd(right) && taskStart(right) < taskEnd(left)) {
        conflicts.push({ agent: left.agent, leftId: left.id, rightId: right.id });
      }
    }
  }
  return conflicts;
}
