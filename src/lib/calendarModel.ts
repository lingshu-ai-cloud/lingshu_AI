import { Temporal } from 'temporal-polyfill';

export type LsCalendarStatus = 'planned' | 'queued' | 'working' | 'needs_action' | 'failed' | 'done';
export type LsCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  timeZone: string;
  status: LsCalendarStatus;
  eventType: 'content' | 'agent_task' | 'publish' | 'shooting' | 'follow_up';
  platform?: string;
  accountId?: string;
  accountName?: string;
  thumbnailUrl?: string;
  ownerAgent?: string;
  sourceId?: string;
  costEstimate?: number;
  allDay?: boolean;
  editable?: boolean;
  statusLabel?: string;
  description?: string;
  data?: unknown;
};

export const calendarStatusLabels: Record<LsCalendarStatus, string> = {
  planned: '已计划', queued: '待执行', working: '进行中', needs_action: '待处理', failed: '失败', done: '已完成',
};

export function calendarDayKey(value: Date | string, timeZone = 'Asia/Shanghai'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return Temporal.Instant.fromEpochMilliseconds(new Date(value).getTime()).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function calendarDateTimeValue(value: Date | string, timeZone = 'Asia/Shanghai'): string {
  return Temporal.Instant.fromEpochMilliseconds(new Date(value).getTime()).toZonedDateTimeISO(timeZone).toPlainDateTime().toString().slice(0, 16);
}

/** Reject nonexistent/ambiguous wall-clock times instead of silently moving a schedule through DST. */
export function calendarInstant(value: string, timeZone = 'Asia/Shanghai'): Date {
  const dateTime = value.length === 10 ? `${value}T00:00` : value;
  return new Date(Temporal.ZonedDateTime.from(`${dateTime}[${timeZone}]`, { disambiguation: 'reject' }).epochMilliseconds);
}

/** Dropping a timed item on a date cell preserves its confirmed wall-clock time. */
export function calendarMovedInstant(event: Pick<LsCalendarEvent, 'start' | 'allDay' | 'timeZone'>, droppedStart: string, droppedAllDay: boolean): string {
  return droppedAllDay && !event.allDay
    ? calendarInstant(`${calendarDayKey(droppedStart, event.timeZone)}T${calendarDateTimeValue(event.start, event.timeZone).slice(11)}`, event.timeZone).toISOString()
    : new Date(droppedStart).toISOString();
}

export function calendarPublishStatus(post: { status: string; platformPostId?: string }): LsCalendarStatus {
  if (post.status === 'needs_attention') return 'needs_action';
  if (post.status === 'finalize_pending') return 'working';
  if (post.platformPostId || post.status === 'published') return 'done';
  if (post.status === 'failed') return 'failed';
  if (['partial', 'awaiting_reapproval', 'awaiting_manual_publish'].includes(post.status)) return 'needs_action';
  if (post.status === 'publishing') return 'working';
  return post.status === 'scheduled' ? 'planned' : 'queued';
}

export function canMoveCalendarPost(post: { id: string; status: string; scheduleLocked?: boolean; platformPostId?: string }, canEdit: boolean): boolean {
  return canEdit && !post.id.startsWith('demo-calendar-') && !post.platformPostId && !post.scheduleLocked
    && !['published', 'needs_attention', 'publishing', 'finalize_pending', 'partial', 'awaiting_reapproval'].includes(post.status);
}
