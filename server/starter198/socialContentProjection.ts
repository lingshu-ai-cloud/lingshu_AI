import {
  SOCIAL_CONTENT_TASK_STATUSES,
  type SocialContentTaskStatus,
} from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { parseSocialTaskBrief, requireSocialTask, socialTaskReadiness } from './socialContentRecords.js';
import { SocialContentWorkflowError, socialText } from './socialContentValidation.js';

const PROGRESS_RANK: Partial<Record<SocialContentTaskStatus, number>> = {
  draft: 0,
  needs_input: 0,
  plan_review: 1,
  producing: 2,
  asset_review: 3,
  packaging: 4,
  delivered: 5,
  awaiting_publish: 6,
  awaiting_metrics: 7,
  reviewed: 8,
};

async function count(input: {
  repository: Starter198Repository;
  tenantId: string;
  collection: Parameters<Starter198Repository['list']>[0];
  where: Record<string, string | number | boolean>;
}): Promise<number> {
  const result = await input.repository.list(input.collection, input.tenantId, {
    where: input.where,
    page: 1,
    perPage: 1,
  });
  if (!Number.isSafeInteger(result.totalItems) || result.totalItems < 0) {
    throw new SocialContentWorkflowError('social_content_projection_integrity_violation', 503);
  }
  return result.totalItems;
}

function laterStatus(current: SocialContentTaskStatus, candidate: SocialContentTaskStatus): SocialContentTaskStatus {
  const currentRank = PROGRESS_RANK[current];
  const candidateRank = PROGRESS_RANK[candidate];
  if (currentRank === undefined || candidateRank === undefined) return candidate;
  return currentRank >= candidateRank ? current : candidate;
}

function nextVersion(task: StarterRecord): string {
  const current = Number(task.version);
  if (!Number.isSafeInteger(current) || current < 1) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  return String(current + 1);
}

export async function readSocialContentSourceCoverage(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
}): Promise<{ total: number; knowledge: number; material: number }> {
  const where = { task_id: input.taskId, status: 'active' };
  const [total, knowledge, materials, references] = await Promise.all([
    count({ ...input, collection: STARTER_COLLECTIONS.socialTaskSources, where }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialTaskSources, where: { ...where, source_kind: 'knowledge' } }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialTaskSources, where: { ...where, source_kind: 'material' } }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialTaskSources, where: { ...where, source_kind: 'reference_link' } }),
  ]);
  // A text_note is user-authored task context, not authenticated enterprise
  // knowledge and not source material. It remains in total for lineage/capacity,
  // but must never make either readiness gate pass.
  const coverage = { total, knowledge, material: materials + references };
  if (coverage.total < coverage.knowledge + coverage.material) {
    throw new SocialContentWorkflowError('social_content_projection_integrity_violation', 503);
  }
  return coverage;
}

/**
 * Repair denormalized task counters from immutable child rows. This is called
 * both on the first write and during recovery, so A → B → replay(A) can never
 * increment a counter twice or regress a later workflow status.
 */
export async function reconcileSocialContentTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  userId: string;
  operationId: string;
  preferredStatus?: SocialContentTaskStatus;
  enforceReadiness?: boolean;
  now?: Date;
}): Promise<StarterRecord> {
  const task = await requireSocialTask(input);
  const where = { task_id: input.taskId };
  const [
    coverage,
    artifactCount,
    approvedArtifactCount,
    deliveryPackageCount,
    publicationCount,
    metricSubmissionCount,
  ] = await Promise.all([
    readSocialContentSourceCoverage(input),
    count({ ...input, collection: STARTER_COLLECTIONS.socialContentArtifacts, where }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialContentArtifacts, where: { ...where, status: 'approved' } }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialDeliveryPackages, where }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialPublications, where }),
    count({ ...input, collection: STARTER_COLLECTIONS.socialMetricSubmissions, where }),
  ]);
  const brief = parseSocialTaskBrief(task.brief);
  const currentStatus = socialText(task.status) as SocialContentTaskStatus;
  if (!SOCIAL_CONTENT_TASK_STATUSES.includes(currentStatus)) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  const readiness = socialTaskReadiness(brief, coverage);
  let status = currentStatus;
  if (input.enforceReadiness && !readiness.complete) {
    status = 'needs_input';
  } else {
    let candidate = input.preferredStatus;
    if (publicationCount > 0) candidate = 'awaiting_metrics';
    else if (deliveryPackageCount > 0) candidate = 'delivered';
    else if (artifactCount > 0) candidate = 'asset_review';
    else if (readiness.complete && ['draft', 'needs_input'].includes(status)) candidate = 'plan_review';
    if (candidate) status = laterStatus(status, candidate);
  }
  const projection = {
    source_count: coverage.total,
    knowledge_source_count: coverage.knowledge,
    material_source_count: coverage.material,
    artifact_count: artifactCount,
    approved_artifact_count: approvedArtifactCount,
    delivery_package_count: deliveryPackageCount,
    publication_count: publicationCount,
    metric_submission_count: metricSubmissionCount,
    status,
  };
  const changed = Object.entries(projection).some(([key, value]) => String(task[key] ?? '') !== String(value));
  if (!changed) return task;
  await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, task.id, {
    ...projection,
    version: nextVersion(task),
    last_operation_id: input.operationId,
    updated_by: input.userId,
    updated_at: (input.now ?? new Date()).toISOString(),
  });
  return requireSocialTask(input);
}
