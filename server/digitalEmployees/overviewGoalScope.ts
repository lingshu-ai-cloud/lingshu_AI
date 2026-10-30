import { week } from '../../shared/mobile-domain.mjs';
import type { ContentQueueProjection } from '../../src/lib/digitalEmployees.js';

type GoalLike = {
  metric?: unknown;
  scope?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Social-content execution keeps lineage records in the shared weekly-goal
 * storage. Those records are production bridges, not Digital Employee weekly
 * operating goals, and their plan schema is intentionally different.
 */
export function isDigitalEmployeeOperatingGoal(goal: GoalLike): boolean {
  const scope = record(goal.scope);
  const socialTaskId = typeof scope.socialTaskId === 'string'
    ? scope.socialTaskId.trim()
    : '';
  const isSocialContentBridge = goal.metric === 'approved_social_content_artifacts'
    && Boolean(socialTaskId);
  return !isSocialContentBridge;
}

export function digitalEmployeeOperatingGoals<T extends GoalLike>(goals: T[]): T[] {
  return goals.filter(isDigitalEmployeeOperatingGoal);
}
export function currentOperatingWeek(now = Date.now()): { startsAt: string; endsAt: string } {
  const range = week(now);
  return { startsAt: range.start, endsAt: range.end };
}

export function selectOverviewGoal<T extends { id: string; starts_at: string; ends_at: string; status: string }>(
  goals: T[], requestedId = '', range = currentOperatingWeek(),
): T | null {
  if (requestedId) return goals.find(goal => goal.id === requestedId) ?? null;
  const candidates = goals.filter(goal => goal.starts_at.slice(0, 10) <= range.endsAt && goal.ends_at.slice(0, 10) >= range.startsAt);
  return candidates.find(goal => ['active', 'paused'].includes(goal.status)) ?? candidates[0] ?? null;
}

/** Historical goals remain accessible by id; the default queue is this week only. */
export function scopeOverviewQueue(queue: ContentQueueProjection, range: { startsAt: string; endsAt: string }, goalId = ''): ContentQueueProjection {
  const items = queue.items.filter(item => {
    if (item.lineage.goalId) return Boolean(goalId) && item.lineage.goalId === goalId;
    const date = item.plannedPublishDate?.slice(0, 10) || item.updatedAt?.slice(0, 10);
    return Boolean(date && date >= range.startsAt && date <= range.endsAt);
  });
  return { ...queue, items };
}
