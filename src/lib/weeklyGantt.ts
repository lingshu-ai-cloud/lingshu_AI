import type { RunEvent, WorkflowTask } from './digitalEmployees';

const DAY = 86_400_000;
export function calendarDay(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY : null;
}
export function dayLabel(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}
export function ganttDays(start?: string, end?: string): number[] {
  const first = calendarDay(start), last = calendarDay(end);
  if (first === null || last === null || last < first || last - first > 366) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
/** Business-cycle dates are day-based. Timestamp evidence is shown in Beijing time. */
export function evidenceDay(value?: string): number | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return calendarDay(`${part('year')}-${part('month')}-${part('day')}`);
}
export function ganttRecordRange(task: Pick<WorkflowTask, 'id' | 'run_id' | 'status' | 'updated_at'> | undefined, events: Pick<RunEvent, 'task_id' | 'run_id' | 'type' | 'occurred_at'>[]) {
  if (!task) return null;
  const days = events.filter(e => e.task_id === task.id && e.run_id === task.run_id && !['task.created', 'task.pending', 'task.scheduled'].includes(e.type))
    .map(e => evidenceDay(e.occurred_at)).filter((d): d is number => d !== null);
  if (days.length) return { start: Math.min(...days), end: Math.max(...days), label: '已加载执行记录' };
  // A last update is a point, never an invented start-to-finish duration.
  if (task.status === 'pending') return null;
  const updated = evidenceDay(task.updated_at);
  return updated === null ? null : { start: updated, end: updated, label: '最近更新' };
}
export function ganttSpan(start: number, end: number, days: number[]) {
  if (!days.length || end < start || end < days[0] || start > days[days.length - 1]) return null;
  const first = Math.max(start, days[0]), last = Math.min(end, days[days.length - 1]);
  return { left: (first - days[0]) / days.length * 100, width: (last - first + 1) / days.length * 100 };
}
