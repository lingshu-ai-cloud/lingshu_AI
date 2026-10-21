import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';

/** Submit frozen carousel units in order. A lost response never triggers an automatic retry. */
export async function runPlannedCarousel(input: {
  task: SocialImageCreationTask;
  planUnits: (task: SocialImageCreationTask) => Promise<SocialImageCreationTask>;
  renderUnit: (taskId: string, jobId: string) => Promise<{ ok: boolean; task?: SocialImageCreationTask; url?: string; error?: string }>;
  onTask?: (task: SocialImageCreationTask, url?: string) => void;
  signal?: AbortSignal;
}): Promise<SocialImageCreationTask> {
  if (input.task.imageType !== 'carousel') throw new Error('social_image_carousel_type_required');
  let current = input.task.renderPlan ? input.task : await input.planUnits(input.task);
  const units = current.renderPlan?.units;
  if (!units?.length || units.some(unit => unit.role !== 'carousel_page')) throw new Error('social_image_carousel_plan_missing');
  input.onTask?.(current);
  for (const unit of [...units].sort((left, right) => left.index - right.index)) {
    const job = current.generationJobs.find(item => item.id === unit.jobId);
    if (job?.outputNodeIds.length) continue;
    if (input.signal?.aborted) throw new Error('social_image_carousel_wait_stopped');
    if (job?.status !== 'queued') throw new Error('social_image_carousel_unit_requires_reconciliation');
    const result = await input.renderUnit(current.id, unit.jobId);
    if (!result.ok || !result.task) throw new Error(result.error || 'social_image_carousel_unit_result_unknown');
    const completed = result.task.generationJobs.find(item => item.id === unit.jobId);
    if (!completed?.outputNodeIds.length || !result.task.outputs.some(output => completed.outputNodeIds.includes(output.id)
      && output.role === unit.role && output.label === unit.label && output.materialId && output.mediaUrl)) {
      throw new Error('social_image_carousel_unit_not_durable');
    }
    current = result.task;
    input.onTask?.(current, result.url);
  }
  return current;
}
