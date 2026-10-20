/** Query values identify an exact read, never an execution authorization. */
export function readLegacyWeeklyPlanNavigation(search: string): { goalId: string; planId: string } | null {
  const query = new URLSearchParams(search);
  if (query.get('page') !== 'digitalEmployees' || query.get('weeklyView')) return null;
  const goalId = query.get('goalId')?.trim() || '', planId = query.get('planId')?.trim() || '';
  const valid = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
  return valid(goalId) && valid(planId) ? { goalId, planId } : null;
}
