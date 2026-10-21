import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask, SocialImageFrozenRenderPlan, SocialImageGenerationJob } from '../../shared/contracts/socialImageCreation.js';
import { requireSocialImageAtomicStore, SocialImagePaidJobError } from './socialImagePaidJob.js';
import { planSocialImageRenderUnits } from './socialImageRenderPlan.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Snapshot every field that can affect a paid multi-output render. */
export function socialImagePlanSourceHash(task: SocialImageCreationTask): string {
  return digest({
    taskId: task.id, imageType: task.imageType, creationPath: task.creationPath,
    contentBrief: task.contentBrief, creativeRecipe: task.creativeRecipe,
    imageTextContract: task.imageTextContract, renderBrief: task.renderBrief,
    deliverySpec: task.deliverySpec, materialIds: task.materialIds,
    referenceUrls: task.referenceUrls, referenceSnapshot: task.referenceSnapshot,
    replicationRecipe: task.replicationRecipe, enterpriseAssets: task.enterpriseAssets,
    layerGraph: task.layerGraph,
  });
}

/** Freeze carousel/GIF units and receipt identities before any paid call. */
export async function persistSocialImageMultiUnitPlan(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
}): Promise<SocialImageCreationTask> {
  await requireSocialImageAtomicStore(input.store);
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImagePaidJobError('social_image_task_missing');
  if (task.imageType !== 'carousel' && task.imageType !== 'gif_poster') {
    throw new SocialImagePaidJobError('social_image_multi_plan_type_required');
  }
  if (!task.renderBrief?.headline) throw new SocialImagePaidJobError('social_image_render_brief_required');
  const sourceHash = socialImagePlanSourceHash(task);
  if (task.renderPlan?.sourceHash === sourceHash && task.renderPlan.units.every(unit => task.generationJobs.some(job => (
    job.id === unit.jobId && job.idempotencyKey === unit.idempotencyKey && job.plannedInputHash === unit.plannedInputHash
  )))) return task;
  if (task.version !== input.expectedVersion) throw new SocialImagePaidJobError('social_image_plan_version_conflict');
  if (task.generationJobs.some(job => ['queued', 'running', 'outcome_unknown'].includes(job.status) && !job.outputNodeIds.length)) {
    throw new SocialImagePaidJobError('social_image_prior_paid_job_unresolved');
  }
  const planVersion = (task.renderPlan?.version || 0) + 1;
  const createdAt = new Date().toISOString();
  const units = planSocialImageRenderUnits({
    imageType: task.imageType, poster: task.renderBrief as Record<string, unknown>,
    idempotencyKey: `${task.id}:plan:${planVersion}`, requestedCount: task.deliverySpec.outputCount,
  }).map(unit => {
    if (unit.role === 'single') throw new SocialImagePaidJobError('social_image_multi_plan_unit_invalid');
    return {
      ...unit, role: unit.role as 'carousel_page' | 'gif_plate',
      jobId: digest({ taskId: task.id, planVersion, unitIndex: unit.index }).slice(0, 32),
      plannedInputHash: digest({ sourceHash, planVersion, unitIndex: unit.index, role: unit.role, poster: unit.poster }),
    };
  });
  const renderPlan: SocialImageFrozenRenderPlan = { version: planVersion, sourceHash, createdAt, units };
  const jobs: SocialImageGenerationJob[] = units.map(unit => ({
    id: unit.jobId, idempotencyKey: unit.idempotencyKey,
    planVersion, unitIndex: unit.index, plannedInputHash: unit.plannedInputHash,
    status: 'queued', outputNodeIds: [], attempt: 0, createdAt, updatedAt: createdAt,
  }));
  const saved = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    status: 'planned', step: 'generate', renderPlan, generationJobs: [...task.generationJobs, ...jobs],
  });
  if (saved.kind !== 'updated') throw new SocialImagePaidJobError('social_image_plan_write_conflict');
  return saved.task;
}

/** Reserve one frozen multi-output unit with the exact server-built provider request hash. This does not submit it. */
export async function claimSocialImagePlannedUnit(input: {
  store: DataStore; tenantId: string; taskId: string; jobId: string; idempotencyKey: string;
  plannedInputHash: string; renderRequestHash: string;
}): Promise<SocialImageCreationTask> {
  await requireSocialImageAtomicStore(input.store);
  if (!/^[a-f0-9]{64}$/.test(input.renderRequestHash)) {
    throw new SocialImagePaidJobError('social_image_render_request_hash_invalid');
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
    if (!task) throw new SocialImagePaidJobError('social_image_task_missing');
    const plan = task.renderPlan;
    if ((task.imageType !== 'carousel' && task.imageType !== 'gif_poster') || !plan || plan.sourceHash !== socialImagePlanSourceHash(task)) {
      throw new SocialImagePaidJobError('social_image_frozen_plan_invalid');
    }
    const unit = plan.units.find(item => item.jobId === input.jobId);
    const job = task.generationJobs.find(item => item.id === input.jobId);
    if (!unit || !job || unit.idempotencyKey !== input.idempotencyKey || unit.plannedInputHash !== input.plannedInputHash
      || job.idempotencyKey !== unit.idempotencyKey || job.planVersion !== plan.version
      || job.unitIndex !== unit.index || job.plannedInputHash !== unit.plannedInputHash) {
      throw new SocialImagePaidJobError('social_image_planned_unit_identity_invalid');
    }
    if (job.status !== 'queued' || job.inputHash || job.outputNodeIds.length) {
      throw new SocialImagePaidJobError('social_image_paid_job_already_started');
    }
    if (plan.units.some(other => other.index < unit.index && task.generationJobs.some(previous =>
      previous.id === other.jobId && !previous.outputNodeIds.length))) {
      throw new SocialImagePaidJobError('social_image_prior_paid_job_unresolved');
    }
    const now = new Date().toISOString();
    const saved = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
      status: 'generating', step: 'generate',
      generationJobs: task.generationJobs.map(item => item.id === job.id
        ? { ...item, status: 'running', inputHash: input.renderRequestHash, attempt: item.attempt + 1, updatedAt: now }
        : item),
    });
    if (saved.kind === 'updated') return saved.task;
    if (saved.kind !== 'conflict') throw new SocialImagePaidJobError('social_image_planned_unit_claim_invalid');
  }
  throw new SocialImagePaidJobError('social_image_planned_unit_claim_conflict');
}
