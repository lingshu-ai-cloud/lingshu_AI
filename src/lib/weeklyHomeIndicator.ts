import type { DigitalEmployeeOverview } from './digitalEmployees';
import { taskNeedsAttention, type TaskWaitState } from './taskExecutionState';

export type WeeklyHomeIndicator = 'idle' | 'producing' | 'attention';

/** Only persisted execution evidence may light up the home production indicator. */
export function weeklyHomeIndicator(overview: DigitalEmployeeOverview | null): WeeklyHomeIndicator {
  if (!overview?.plan || !overview.run) return 'idle';
  const { run, tasks, executionRuntime } = overview;
  const relatedJobs = executionRuntime?.sourceStatus === 'available'
    ? executionRuntime.jobs.filter(job => job.runId === run.id)
    : [];
  if (['failed', 'paused'].includes(run.status)
    || tasks.some(task => task.run_id === run.id && (['blocked', 'failed', 'waiting_approval'].includes(task.status) || taskNeedsAttention(task)))
    || overview.approvals?.some(item => item.status === 'pending' && tasks.some(task => task.id === item.task_id && task.run_id === run.id))
    || relatedJobs.some(job => ['blocked', 'paused', 'dead_letter'].includes(job.status))) return 'attention';
  if (['succeeded', 'cancelled'].includes(run.status)) return 'idle';
  if (relatedJobs.some(job => job.status === 'running')
    || tasks.some(task => task.run_id === run.id && task.kind === 'production'
      && (task.status === 'running' || (task.status === 'waiting_external'
        && (task.output?.waitState as TaskWaitState | undefined)?.kind === 'processing')))) return 'producing';
  return 'idle';
}
