import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';

type PlannedMultiOutputInput = {
  task: SocialImageCreationTask;
  planUnits: (task: SocialImageCreationTask) => Promise<SocialImageCreationTask>;
  renderUnit: (taskId: string, jobId: string) => Promise<{ ok: boolean; task?: SocialImageCreationTask; url?: string; error?: string }>;
  onTask?: (task: SocialImageCreationTask, url?: string) => void;
  signal?: AbortSignal;
};

/** Submit frozen carousel pages or GIF plates in order; never retry an unknown paid outcome. */
export async function runPlannedMultiOutput(input: PlannedMultiOutputInput): Promise<SocialImageCreationTask> {
  if (input.task.imageType !== 'carousel' && input.task.imageType !== 'gif_poster') {
    throw new Error('social_image_multi_output_type_required');
  }
  let current = input.task.renderPlan ? input.task : await input.planUnits(input.task);
  const units = current.renderPlan?.units;
  const role = input.task.imageType === 'gif_poster' ? 'gif_plate' : 'carousel_page';
  if (!units?.length || units.some(unit => unit.role !== role)) throw new Error('social_image_multi_output_plan_missing');
  input.onTask?.(current);
  for (const unit of [...units].sort((left, right) => left.index - right.index)) {
    const job = current.generationJobs.find(item => item.id === unit.jobId);
    if (job?.outputNodeIds.length) continue;
    if (input.signal?.aborted) throw new Error('social_image_multi_output_wait_stopped');
    if (job?.status !== 'queued') throw new Error('social_image_multi_output_unit_requires_reconciliation');
    const result = await input.renderUnit(current.id, unit.jobId);
    if (!result.ok || !result.task) throw new Error(result.error || 'social_image_multi_output_unit_result_unknown');
    const completed = result.task.generationJobs.find(item => item.id === unit.jobId);
    if (!completed?.outputNodeIds.length || !result.task.outputs.some(output => completed.outputNodeIds.includes(output.id)
      && output.role === unit.role && output.label === unit.label && output.materialId && output.mediaUrl)) {
      throw new Error('social_image_multi_output_unit_not_durable');
    }
    current = result.task;
    input.onTask?.(current, result.url);
  }
  return current;
}

export function runPlannedCarousel(input: PlannedMultiOutputInput): Promise<SocialImageCreationTask> {
  if (input.task.imageType !== 'carousel') throw new Error('social_image_carousel_type_required');
  return runPlannedMultiOutput(input);
}
