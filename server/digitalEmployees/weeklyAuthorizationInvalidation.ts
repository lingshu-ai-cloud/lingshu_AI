export type WeeklyTaskCorrectionAction = 'retry' | 'skip' | 'manual_complete' | 'replan';
export type WeeklyDirectorDecision = 'continue' | 'adjust' | 'abandon';

/**
 * A retry changes execution state, not the business boundary the user
 * approved before production. Skipping, manually replacing, or replanning a
 * deliverable can change that boundary and must require a new authorization.
 */
export function taskCorrectionInvalidatesWeeklyAuthorization(action: WeeklyTaskCorrectionAction): boolean {
  return action !== 'retry';
}

/** Continuing the frozen direction records a decision but does not alter it. */
export function directorDecisionInvalidatesWeeklyAuthorization(decision: WeeklyDirectorDecision): boolean {
  return decision !== 'continue';
}
