/** Only retry failures in internal/read-only steps automatically. Provider-side
 * uncertainty is left for explicit recovery rather than repeating an effect. */
export interface TaskFailure { attempts: number; retryAt: string | null }
export function nextTaskFailure(previous: Partial<TaskFailure> | undefined, safeToRetry: boolean, now = Date.now()): TaskFailure {
  const attempts = Math.max(0, Number(previous?.attempts) || 0) + 1;
  return { attempts, retryAt: safeToRetry && attempts < 3 ? new Date(now + (attempts === 1 ? 60_000 : 300_000)).toISOString() : null };
}
export function taskRetryDue(failure: TaskFailure | undefined, now = Date.now()): boolean {
  return !failure || Boolean(failure.retryAt && Date.parse(failure.retryAt) <= now);
}
