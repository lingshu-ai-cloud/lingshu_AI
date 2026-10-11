export type SchedulerExecutionTrigger = 'cron' | 'catch-up' | 'manual';

/**
 * A user clicking “立即执行” explicitly requests a fresh approved-scope run.
 * Cron and startup catch-up remain cadence-bound scheduled executions.
 */
export function discoveryTriggerForScheduler(trigger: SchedulerExecutionTrigger): 'scheduled' | 'manual' {
  return trigger === 'manual' ? 'manual' : 'scheduled';
}
