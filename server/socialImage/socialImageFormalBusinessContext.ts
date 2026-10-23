import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageNodeValueMap, SocialImageVersionedRef } from '../../shared/contracts/socialImageProduction.js';
import { socialTaskSummary } from '../starter198/socialContentRecords.js';
import { STARTER_COLLECTIONS, type StarterRecord } from '../starter198/repository.js';
import { readSocialImageTask } from './socialImageTask.js';
import { recordSocialImageNodeOutput, SocialImageProductionRunError } from './socialImageProductionRun.js';

/** Promote only a current, canonical ContentTask brief into the first formal image node. */
export async function ensureSocialImageBusinessContext(input: {
  store: DataStore; tenantId: string; taskId: string; expectedVersion: number;
}): Promise<SocialImageCreationTask> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const binding = task.productionRuntime?.binding;
  if (task.schemaVersion !== 'social-image-creation.v3' || !binding || binding.productionRunId !== task.id) {
    throw new SocialImageProductionRunError('social_image_content_task_binding_missing', 409);
  }
  const rows = await input.store.list<StarterRecord>(STARTER_COLLECTIONS.socialContentTasks, {
    where: { tenant_id: input.tenantId, task_id: binding.contentTaskId }, perPage: 2,
  });
  if (rows.totalItems > 1 || rows.items.length > 1) throw new SocialImageProductionRunError('social_image_content_task_integrity_violation', 503);
  if (!rows.items[0]) throw new SocialImageProductionRunError('social_image_content_task_not_found', 404);
  const contentTask = socialTaskSummary(rows.items[0]);
  const brief = contentTask.brief;
  if (contentTask.version !== binding.contentTaskVersion
    || brief.objective !== task.contentBrief.coreClaim
    || !brief.productId || task.contentBrief.productRefs[0] !== brief.productId
    || !brief.platforms.includes(task.deliverySpec.platform)
    || (brief.aspectRatio && brief.aspectRatio !== task.deliverySpec.aspectRatio)
    || !brief.languages.includes(task.deliverySpec.language)) {
    throw new SocialImageProductionRunError('social_image_content_task_inputs_changed', 409);
  }
  const sourceRef: SocialImageVersionedRef = {
    objectType: 'social_content_task', id: contentTask.taskId, version: contentTask.version,
    contentHash: createHash('sha256').update(JSON.stringify(brief)).digest('hex'),
  };
  const value: SocialImageNodeValueMap['business_context'] = {
    objective: brief.objective, topicType: task.contentBrief.topicType,
    deliverableType: task.imageType === 'carousel' ? 'carousel_cover'
      : task.imageType === 'product_poster' ? 'product_hero' : 'social_single',
    productRefs: [...task.contentBrief.productRefs], enterpriseFactSnapshotRef: null,
    audience: [...task.contentBrief.audience], ownedAccountId: brief.targetAccountRef?.id || null,
    accountDraftId: null, platforms: [...brief.platforms], targetAction: brief.callToAction,
    successMetrics: [],
    deliverySpec: { platform: task.deliverySpec.platform, aspectRatio: task.deliverySpec.aspectRatio,
      language: task.deliverySpec.language, outputCount: task.deliverySpec.outputCount, format: task.deliverySpec.format },
    budgetAndDeadline: { maximumCostCny: brief.perItemBudgetCny ?? null, dueAt: brief.dueAt },
    fieldsToConfirm: [...task.fieldsToConfirm],
  };
  return recordSocialImageNodeOutput({ ...input, nodeId: 'business_context', status: 'completed', value,
    inputRefs: [sourceRef], evidenceRefs: [sourceRef], createdBy: { kind: 'system', id: 'canonical_content_task' } });
}
