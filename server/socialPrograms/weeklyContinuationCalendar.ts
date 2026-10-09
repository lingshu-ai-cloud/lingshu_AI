import type { WeeklyExecutionTask, VersionedSocialRef } from '../../shared/contracts/socialProgram.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { SocialProgramError } from './service.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { createWeeklyExecutionContinuationService } from './weeklyExecutionContinuations.js';

/** Expose an original production entry without copying its results into the new task. */
export async function projectWeeklyContinuationCalendar(store: DataStore, tasks: WeeklyExecutionTask[]): Promise<WeeklyExecutionTask[]> {
  const continuation = createWeeklyExecutionContinuationService(store);
  return Promise.all(tasks.map(async storedTask => {
    const { continuationObservation: _storedProjection, ...task } = storedTask;
    const ref = task.inputSnapshot?.weeklyContinuationRef as VersionedSocialRef | undefined;
    if (!ref && !task.inputSnapshot?.weeklyContinuationPending) return task;
    if (!ref) return { ...task, continuationObservation: { status: 'blocked' as const, code: 'weekly_execution_continuation_verification_required' } };
    try {
      const observed = await continuation.readValidated({ tenantId: task.tenantId, programId: task.programId, packageId: task.packageId, targetVersion: task.packageVersion, targetTaskId: task.taskId, ref });
      const ids = new Set(observed.resultRefs.filter(item => ['starter_social_content_task', 'starter_social_content_script_baseline', 'starter_social_content_director_plan', 'starter_social_content_material_demand'].includes(item.type)).map(item => item.id));
      if (observed.status === 'ready' && observed.sourceTask.productionProgress?.contentTaskId) ids.add(observed.sourceTask.productionProgress.contentTaskId);
      if (observed.status === 'ready' && observed.sourceTask.workflowKind === 'content' && observed.resultRefs.some(item => item.type === 'starter_social_content_artifact')) {
        // Completion clears progress; resolve the already-validated artifact's original production binding.
        const bindings = await store.list<Record_>('starter_social_content_tasks', { where: { tenant_id: task.tenantId, create_idempotency_key: `weekly-production:${task.packageId}:${observed.detail.sourceVersion}:${observed.sourceTask.publicationTaskId}` }, perPage: 2 });
        if (bindings.totalItems === 1 && bindings.items.length === 1 && typeof bindings.items[0]!.task_id === 'string') ids.add(bindings.items[0]!.task_id as string);
      }
      return { ...task, continuationObservation: { status: observed.status, code: observed.code, sourceVersion: observed.detail.sourceVersion, sourceTaskId: observed.sourceTask.taskId, ...(observed.status === 'ready' ? { sourceActualFinishedAt: observed.sourceTask.schedule.actualFinishedAt ?? observed.observedCompletedAt ?? null, sourceLatestFinishAt: observed.sourceTask.schedule.latestFinishAt ?? observed.sourceTask.schedule.estimatedFinishAt ?? null } : {}), ...(observed.status === 'ready' && ids.size === 1 ? { contentTaskId: [...ids][0] } : {}) } };
    } catch (error) {
      if (!(error instanceof SocialProgramError) && !(error instanceof SocialContentWorkflowError)) throw error;
      return { ...task, continuationObservation: { status: 'blocked' as const, code: error.code } };
    }
  }));
}
