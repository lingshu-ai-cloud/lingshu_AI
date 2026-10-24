import { createHash } from 'node:crypto';
import type { SocialContentTaskSummary, TaskContextSnapshot } from '../../shared/contracts/socialContentTaskContract.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => key !== 'contentHash' && item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

export function taskContextSnapshotContentHash(value: Omit<TaskContextSnapshot, 'contentHash'> | TaskContextSnapshot): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function taskContextSnapshotIssue(snapshot: TaskContextSnapshot | undefined, expected: {
  tenantId: string; contentTaskId: string; contentTaskVersion: string; productionRunId: string;
}): string | null {
  if (!snapshot || snapshot.schemaVersion !== 'task-context-snapshot.v1') return 'social_image_task_context_snapshot_missing';
  if (snapshot.tenantId !== expected.tenantId || snapshot.contentTaskId !== expected.contentTaskId
    || snapshot.snapshotVersion !== Number(expected.contentTaskVersion)
    || snapshot.id !== `task-context:${expected.contentTaskId}:${expected.contentTaskVersion}`
    || snapshot.graphVersion !== 'social-image-production.v3'
    || !snapshot.confirmedBy || !snapshot.confirmedAt || !snapshot.factVersionId
    || snapshot.outputType !== 'image'
    || snapshot.contentHash !== taskContextSnapshotContentHash(snapshot)) return 'social_image_task_context_snapshot_invalid';
  return null;
}

export function createSocialImageTaskContextSnapshot(input: {
  tenantId: string;
  contentTask: SocialContentTaskSummary & { createdBy: string };
  task: Pick<SocialImageCreationTask, 'id' | 'imageType' | 'deliverySpec' | 'enterpriseAssets' | 'materialIds' | 'referenceSnapshot'>;
  factVersionId: string;
  now: string;
}): TaskContextSnapshot {
  const brief = input.contentTask.brief;
  const version = Number(input.contentTask.version);
  if (!Number.isSafeInteger(version) || version < 1 || !input.factVersionId || !input.contentTask.createdBy) {
    throw new Error('social_image_task_context_snapshot_source_invalid');
  }
  const reference = input.task.referenceSnapshot;
  const body: Omit<TaskContextSnapshot, 'contentHash'> = {
    schemaVersion: 'task-context-snapshot.v1', id: `task-context:${input.contentTask.taskId}:${input.contentTask.version}`,
    tenantId: input.tenantId, contentTaskId: input.contentTask.taskId, snapshotVersion: version,
    factVersionId: input.factVersionId, productIds: brief.productId ? [brief.productId] : [],
    platformIds: [...brief.platforms], assetIds: [...new Set([...input.task.enterpriseAssets.map(asset => asset.assetId), ...input.task.materialIds])],
    ...(brief.presenterAssetId ? { presenterId: brief.presenterAssetId } : {}), audience: brief.audience,
    language: input.task.deliverySpec.language, contentGoal: brief.objective, primaryCta: brief.callToAction,
    constraints: [...brief.restrictions, ...(brief.specialRequirements ? [brief.specialRequirements] : [])],
    taskLocalOverrides: [],
    ...(reference?.sourceRecordId ? { referenceRef: { objectType: 'social-image-reference', id: reference.sourceRecordId,
      version: reference.fingerprint || 'unversioned' } } : {}),
    outputType: 'image', deliverySpec: { platform: input.task.deliverySpec.platform,
      aspectRatio: input.task.deliverySpec.aspectRatio, language: input.task.deliverySpec.language,
      outputCount: input.task.deliverySpec.outputCount, format: input.task.imageType },
    graphVersion: 'social-image-production.v3', confirmedBy: input.contentTask.createdBy, confirmedAt: input.now,
  };
  return { ...body, contentHash: taskContextSnapshotContentHash(body) };
}
