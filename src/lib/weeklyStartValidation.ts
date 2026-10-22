import { DigitalEmployeeApiError } from './digitalEmployeeApi';
import type { DigitalEmployeeOverview } from './digitalEmployees';

export type WeeklyStartConflict = {
  goalId: string;
  runId: string;
  goalTitle: string;
  goalStatus: string;
  runStatus: string;
  startsAt: string;
  endsAt: string;
};

export function weeklyStartConflictFromError(error: unknown): WeeklyStartConflict | null {
  if (!(error instanceof DigitalEmployeeApiError) || error.code !== 'active_goal_exists') return null;
  const stringDetail = (key: string) => typeof error.details[key] === 'string' ? String(error.details[key]).trim() : '';
  const goalId = stringDetail('activeGoalId');
  const runId = stringDetail('activeRunId');
  if (!goalId && !runId) return null;
  return {
    goalId,
    runId,
    goalTitle: stringDetail('activeGoalTitle'),
    goalStatus: stringDetail('activeGoalStatus'),
    runStatus: stringDetail('activeRunStatus'),
    startsAt: stringDetail('activeStartsAt'),
    endsAt: stringDetail('activeEndsAt'),
  };
}

/** A successful HTTP response alone is not proof that this weekly run started. */
export function confirmedWeeklyExecution(data: DigitalEmployeeOverview, goalId: string) {
  const run = data.run;
  if (!run || run.goal_id !== goalId || !Number.isFinite(Date.parse(run.started_at))) return null;
  const tasks = data.tasks.filter((task) => task.run_id === run.id);
  return tasks.length > 0 ? { run, tasks } : null;
}

export function weeklyStartResultNeedsReconciliation(error: unknown): boolean {
  if (!(error instanceof DigitalEmployeeApiError)) return true;
  return error.status === 408 || error.status >= 500;
}
