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
