import type { Record_ } from '../storage/datastore.js';
import { visibleDigitalEmployeeAgentRole } from '../digitalEmployees/agentRoles.js';
import { jsonObject } from './digitalEmployeeRecords.js';

export type AgentScheduleRange = { startsAt: string; endsAt: string; timeZone: 'Asia/Shanghai' };
export type AgentScheduleSource = { availability: 'available' | 'unavailable'; items: Record_[] };
const FINISHED = new Set(['succeeded', 'cancelled', 'skipped', 'completed']);
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Preserve date-only plans as date-only: they do not imply a midnight appointment. */
function persistedTime(...values: unknown[]): string | null {
  for (const value of values) {
    const text = clean(value);
    if (text && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) && Number.isFinite(Date.parse(text))) return text;
  }
  return null;
}
function instant(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value);
}

/** Read-only projection; missing plans and missing observations remain unknown. */
export function projectMobileWorkbenchAgentSchedule(source: AgentScheduleSource, tenantId: string, range: AgentScheduleRange, eventsSource?: AgentScheduleSource) {
  const items = source.availability === 'unavailable' ? [] : source.items.filter(task => task.tenant_id === tenantId).flatMap(task => {
    const rawOutput = jsonObject<unknown>(task.output, {});
    const output = rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput) ? rawOutput as Record<string, unknown> : {};
    const rawWait = output.waitState;
    const wait = rawWait && typeof rawWait === 'object' && !Array.isArray(rawWait) ? rawWait as Record<string, unknown> : {};
    const latestEvent = eventsSource?.availability === 'available' ? eventsSource.items.filter(event =>
      event.tenant_id === tenantId && event.task_id === task.id && (!task.run_id || event.run_id === task.run_id) && persistedTime(event.occurred_at)
    ).sort((a, b) => instant(String(b.occurred_at)) - instant(String(a.occurred_at)))[0] : undefined;
    const status = clean(task.status) || 'unknown';
    const completedAt = persistedTime(task.completed_at, output.completedAt,
      status === 'succeeded' || status === 'completed' ? task.updated_at : null);
    if (FINISHED.has(status) && !(completedAt && instant(completedAt) >= instant(range.startsAt) && instant(completedAt) <= instant(range.endsAt))) return [];
    const plannedAt = persistedTime(task.planned_at, task.scheduled_at, output.plannedAt, output.scheduledAt);
    const dueAt = persistedTime(task.due_at, output.dueAt);
    const taskObserved = persistedTime(task.updated_at);
    const eventObserved = persistedTime(latestEvent?.occurred_at);
    const observedAt = eventObserved && (!taskObserved || instant(eventObserved) > instant(taskObserved)) ? eventObserved : taskObserved;
    // Only explicit identities are safe; status strings cannot establish an actionable matter.
    const explicitMatter = clean(task.matter_id) || clean(output.matterId);
    const matterId = explicitMatter && /^(approval|task|shoot):[A-Za-z0-9:_-]{1,200}$/.test(explicitMatter) ? explicitMatter : null;
    return [{
      taskId: task.id, runId: clean(task.run_id),
      role: visibleDigitalEmployeeAgentRole(clean(task.agent_role) || '', clean(task.task_key) || ''),
      title: clean(task.title) || '未命名任务', status,
      plannedAt, dueAt, completedAt, observedAt,
      timeStatus: plannedAt || dueAt ? 'scheduled' as const : 'unscheduled' as const,
      stage: clean(output.stage) || clean(output.phase) || clean(task.title), stageKey: clean(task.task_key),
      blockedReason: clean(task.blocked_reason),
      nextAction: clean(output.nextAction) || clean(task.next_action) || clean(wait.message),
      ownerId: clean(task.owner_id), ownerName: clean(task.owner_name), matterId,
      description: clean(task.description), waitKind: clean(wait.kind), waitMessage: clean(wait.message),
      lastEvent: latestEvent ? { id: latestEvent.id, type: clean(latestEvent.type), summary: clean(latestEvent.summary), occurredAt: eventObserved } : null,
      version: typeof task.task_version === 'number' && Number.isSafeInteger(task.task_version) ? task.task_version : null,
    }];
  });
  items.sort((left, right) => {
    const a = left.plannedAt || left.dueAt; const b = right.plannedAt || right.dueAt;
    if (a && b) return instant(a) - instant(b) || left.taskId.localeCompare(right.taskId);
    if (a || b) return a ? -1 : 1;
    return (right.observedAt ? instant(right.observedAt) : 0) - (left.observedAt ? instant(left.observedAt) : 0) || left.taskId.localeCompare(right.taskId);
  });
  return {
    availability: source.availability, source: 'workflow_tasks', eventAvailability: eventsSource?.availability || 'unavailable',
    coverage: 'all_open_tasks_and_selected_week_completed', range, items,
  };
}
