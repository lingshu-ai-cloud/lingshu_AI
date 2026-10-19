import type { ScheduledTask } from './schedulerTaskStore.js';

export function latestMissedRun(task: ScheduledTask, now = new Date()): Date | null {
  const parts = task.cronExpr.trim().split(/\s+/);
  if (parts.length !== 5 || parts[2] !== '*' || parts[3] !== '*') return null;
  const minute = Number(parts[0]), hour = Number(parts[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const weekdays = parts[4] === '*' ? null : new Set(parts[4].split(',').map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 7).map(day => day === 7 ? 0 : day));
  if (parts[4] !== '*' && !weekdays?.size) return null;

  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingNow.getUTCFullYear(), month = beijingNow.getUTCMonth(), day = beijingNow.getUTCDate();
  for (let offset = 0; offset <= 7; offset += 1) {
    const calendarDay = new Date(Date.UTC(year, month, day - offset));
    if (weekdays && !weekdays.has(calendarDay.getUTCDay())) continue;
    const scheduledAt = new Date(Date.UTC(calendarDay.getUTCFullYear(), calendarDay.getUTCMonth(), calendarDay.getUTCDate(), hour - 8, minute));
    if (scheduledAt.getTime() > now.getTime()) continue;
    const previousRun = task.lastRun ? Date.parse(task.lastRun) : 0;
    const createdAt = Date.parse(task.createdAt) || 0;
    if (scheduledAt.getTime() > previousRun && scheduledAt.getTime() >= createdAt) return scheduledAt;
    return null;
  }
  return null;
}
