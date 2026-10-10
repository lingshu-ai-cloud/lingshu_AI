import {calendarDateTime,calendarClock} from './calendarTime';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import type { CustomerCalendarProjection, CustomerCalendarTask } from './CustomerWeeklyCalendar';
export function projectCustomerCalendarTask(runId: string, task: CustomerCalendarTask): AgentCalendarTask | null {
  if (!task.scheduledAt || !/(?:Z|[+-]\d{2}:\d{2})$/.test(task.scheduledAt) || !Number.isFinite(Date.parse(task.scheduledAt))) return null;
  const frozenClock=calendarClock(task.scheduledAt),clock = calendarDateTime(task.scheduledAt,frozenClock);
  const status: AgentCalendarTask['status'] = task.evidenceStatus === 'succeeded' ? 'completed' : task.evidenceStatus === 'no_data' ? 'no_data'
    : task.status === 'running' ? 'active' : task.status === 'cancelled' ? 'cancelled' : task.status === 'failed' ? 'failed' : task.status === 'pending' ? 'planned' : 'blocked';
  return { id: `customer:${runId}:${task.taskId}`, date: clock.date, time: clock.time, calendarClock:frozenClock, timeSemantics: 'start', agent: 'customer', title: task.title,
    context: '来自本周明确绑定的真实客服生产运行', output: task.evidenceStatus === 'succeeded' ? '真实客服阶段交付已核验' : task.evidenceStatus === 'no_data' ? '真实客群快照中无符合条件的客户' : '等待真实客群、逐客草稿、审批或发送回执', minutes: task.estimateDurationMinutes, status,
    reason: task.reason ?? undefined, dueAt: task.latestFinishAt ?? undefined, customerRunId: runId, customerWorkflowTaskId: task.taskId, customerTaskKey: task.taskKey };
}
export function customerCalendarTasks(projection: CustomerCalendarProjection): AgentCalendarTask[] {
  if (!projection.binding) return [];
  return projection.tasks.map(task => projectCustomerCalendarTask(projection.binding!.runId, task)).filter((task): task is AgentCalendarTask => Boolean(task));
}
