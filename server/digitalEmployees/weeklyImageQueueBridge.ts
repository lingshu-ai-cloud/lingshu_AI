import type { DataStore } from '../storage/datastore.js';
import type { WeeklyMixedContentSlot } from '../../shared/contracts/weeklyMixedContentPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { contentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { createStarter198Repository } from '../starter198/repository.js';
import { createSocialContentTask } from '../starter198/socialContentTasks.js';
import { createOrResumeBoundSocialImageRun, SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
import { readImageExecutionJob, enqueueImageExecution, imageExecutionReceipt } from '../socialImage/socialImageExecutionQueue.js';
import { confirmReferenceProduct } from '../socialImage/socialImageReferenceProductCheck.js';
import { updateSocialImageTask } from '../socialImage/socialImageTask.js';
import { usableWeeklyImageReference } from './weeklyImageReferences.js';
import { jsonObject, type PlanRecord, type RunRecord } from './records.js';
import { weeklyImageTaskId } from './weeklyImageAuthority.js';

export class WeeklyImageQueueError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

const originalImages = (pack: WeeklyPackage | undefined) => (pack?.mixedContentSlots || [])
  .filter(slot => slot.kind === 'image' && slot.productionRole === 'original');

type Reference = { id: string; tenantId?: string; tenant_id?: string; contentFormat?: unknown; status?: unknown;
  title?: unknown; sourceUrl?: unknown; thumbnailUrl?: unknown; aiAnalysis?: unknown; platform?: unknown; createdAt?: unknown };

/** Read-only check before approval: no partial plan activation for missing or changed references. */
export async function preflightWeeklyImageQueue(store: DataStore, tenantId: string, pack: WeeklyPackage | undefined) {
  const slots = originalImages(pack);
  if (!slots.length) return [];
  if (new Set(slots.map(slot => slot.slotId)).size !== slots.length
    || new Set(slots.map(slot => slot.referenceId)).size !== slots.length
    || new Set(slots.map(slot => slot.productId)).size < 3) throw new WeeklyImageQueueError('weekly_image_scope_incomplete');
  const checked: Array<{ slot: WeeklyMixedContentSlot; reference: Reference; imageUrl: string }> = [];
  for (const slot of slots) {
    if (!slot.productId || !slot.productName || !slot.referenceId || !slot.referenceSourceUrl) {
      throw new WeeklyImageQueueError('weekly_image_scope_incomplete');
    }
    const reference = await store.getById<Reference>('trend_videos', slot.referenceId);
    if (!reference || (reference.tenantId !== tenantId && reference.tenant_id !== tenantId)
      || !usableWeeklyImageReference(reference) || String(reference.sourceUrl) !== slot.referenceSourceUrl) {
      throw new WeeklyImageQueueError('weekly_image_reference_changed');
    }
    const analysis = videoAnalysisOf(reference);
    const evidence = analysis.imageEvidence as Record<string, unknown> | undefined;
    if (evidence?.version !== 2 || evidence.status !== 'analyzed'
      || !Array.isArray(evidence.productionLabels) || evidence.productionLabels.length !== 1) {
      throw new WeeklyImageQueueError('weekly_image_reference_analysis_incomplete');
    }
    const imageUrl = (analysis.imageUrls as string[])[0]!;
    checked.push({ slot, reference, imageUrl });
  }
  return checked;
}

/** Replayed on an initializing run. Deterministic ContentTask and queue identities prevent duplicate paid work. */
export async function ensureWeeklyImageQueue(input: {
  store: DataStore; tenantId: string; userId: string; plan: PlanRecord; run: RunRecord;
}) {
  const { store, tenantId, userId, plan, run } = input;
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  if (plan.status !== 'approved' || run.plan_id !== plan.id || run.tenant_id !== tenantId
    || !contentGenerationAuthorization(body.contentGenerationAuthorization)
    || !String(body.packageApprovedBy || '') || !String(body.packageApprovedAt || '')) {
    throw new WeeklyImageQueueError('weekly_image_approval_missing');
  }
  const checked = await preflightWeeklyImageQueue(store, tenantId, body.businessPackage as WeeklyPackage | undefined);
  const repository = createStarter198Repository(store);
  const receipts: Array<{ slotId: string; contentTaskId: string; imageTaskId: string; jobId: string; status: string }> = [];
  for (const { slot, reference, imageUrl } of checked) {
    const contentTaskId = weeklyImageTaskId(tenantId, plan.id, slot.slotId);
    const idempotencyKey = `weekly-image:${contentTaskId}`;
    const content = await createSocialContentTask({ repository, tenantId, userId, taskId: contentTaskId,
      idempotencyKey, entry: 'weekly_package', value: {
        title: `${slot.productName} · ${slot.referenceTitle || '原创产品单图'}`.slice(0, 200),
        objective: slot.contentTheme || `制作${slot.productName}的原创产品单图`,
        productId: slot.productId, productRef: slot.productName,
        formats: ['social_image'], platforms: [slot.platform], languages: ['en'], aspectRatio: '4:5',
        requestedOutputCount: 1, creationMode: 'viral_replication', mode: 'weekly', weeklyPlanId: plan.id,
      } });
    if (content.taskId !== contentTaskId || content.brief.productId !== slot.productId
      || content.brief.creationMode !== 'viral_replication' || content.contentOrder?.entry !== 'weekly_package') {
      throw new WeeklyImageQueueError('weekly_image_content_scope_conflict');
    }
    const taskRows = await store.list<Record<string, unknown>>('starter_social_content_tasks', {
      where: { tenant_id: tenantId, task_id: contentTaskId }, perPage: 2,
    });
    if (taskRows.totalItems !== 1 || taskRows.items[0]?.weekly_plan_id !== plan.id) {
      throw new WeeklyImageQueueError('weekly_image_content_scope_conflict');
    }
    const bound = await createOrResumeBoundSocialImageRun(store, tenantId, {
      contentTaskId, expectedContentTaskVersion: content.version, idempotencyKey,
      deliverableKey: slot.slotId, entrySource: 'weekly_package', imageType: 'product_poster',
    });
    let imageTask = bound.task;
    const existingJob = await readImageExecutionJob(store, tenantId, imageTask);
    if (existingJob) {
      if (imageTask.referenceSnapshot?.sourceRecordId !== reference.id
        || imageTask.referenceSnapshot.imageUrls[0] !== imageUrl) throw new WeeklyImageQueueError('weekly_image_reference_scope_conflict');
      receipts.push({ slotId: slot.slotId, contentTaskId, imageTaskId: imageTask.id,
        jobId: existingJob.id, status: imageExecutionReceipt(existingJob).status });
      continue;
    }
    if (imageTask.referenceSnapshot?.sourceRecordId) {
      if (imageTask.referenceSnapshot.sourceRecordId !== reference.id
        || imageTask.referenceSnapshot.imageUrls[0] !== imageUrl) throw new WeeklyImageQueueError('weekly_image_reference_scope_conflict');
    } else {
      const updated = await updateSocialImageTask(store, tenantId, imageTask.id, imageTask.version, {
        referenceUrls: [imageUrl], referenceSnapshot: {
          sourceRecordId: reference.id, sourceUrl: slot.referenceSourceUrl, title: slot.referenceTitle,
          platform: String(reference.platform || ''), imageUrls: [imageUrl],
          collectedAt: String(reference.createdAt || new Date().toISOString()), fingerprint: '',
        },
      });
      if (updated.kind !== 'updated') throw new WeeklyImageQueueError('weekly_image_reference_bind_failed', 503);
      imageTask = updated.task;
    }
    if (!imageTask.referenceProductCheck) {
      imageTask = await confirmReferenceProduct({ store, tenantId, userId, taskId: imageTask.id,
        expectedVersion: imageTask.version, decision: 'auto' });
    }
    const admitted = await enqueueImageExecution({ store, tenantId, userId, taskId: imageTask.id,
      expectedVersion: imageTask.version });
    receipts.push({ slotId: slot.slotId, contentTaskId, imageTaskId: imageTask.id,
      jobId: admitted.execution.jobId, status: admitted.execution.status });
  }
  return receipts;
}

export function weeklyImageQueueFailure(error: unknown) {
  const code = error instanceof WeeklyImageQueueError ? error.code
    : error instanceof SocialImageProductionRunError ? error.code : 'weekly_image_queue_unavailable';
  const status = error instanceof WeeklyImageQueueError || error instanceof SocialImageProductionRunError
    ? error.status : 503;
  const message = code === 'weekly_image_reference_analysis_incomplete'
    ? '所选爆款单图的分析还未齐全，请完成分析后再开始本周图片制作。'
    : code === 'weekly_image_reference_changed' || code === 'weekly_image_scope_incomplete'
      ? '本周图片的参考或产品信息已变化，请刷新并重新确认计划。'
      : '本周图片尚未全部进入制作队列；已保留当前计划和已有任务，请查看缺失信息后继续。';
  return { status, body: { error: code, message } };
}
