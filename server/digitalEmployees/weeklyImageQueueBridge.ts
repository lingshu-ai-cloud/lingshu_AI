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
import { listContentExecutionJobs } from '../contentExecution/durableQueue.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { randomUUID } from 'node:crypto';

export class WeeklyImageQueueError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

const originalImages = (pack: WeeklyPackage | undefined) => (pack?.mixedContentSlots || [])
  .filter(slot => slot.kind === 'image' && slot.productionRole === 'original');

type Reference = { id: string; tenantId?: string; tenant_id?: string; contentFormat?: unknown; status?: unknown;
  title?: unknown; sourceUrl?: unknown; thumbnailUrl?: unknown; aiAnalysis?: unknown; platform?: unknown; createdAt?: unknown };

const currentEvidence = (reference: Reference) => {
  const evidence = videoAnalysisOf(reference).imageEvidence as Record<string, unknown> | undefined;
  return evidence?.version === 2 && evidence.status === 'analyzed'
    && Array.isArray(evidence.productionLabels) && evidence.productionLabels.length === 1;
};

export function weeklyImageScope(pack: WeeklyPackage | undefined) {
  const slots = originalImages(pack);
  // Only duplicate identities are a whole-plan integrity error. Missing
  // product/reference inputs belong to their own image slot after activation.
  if (slots.some(slot => !slot.slotId)
    || new Set(slots.map(slot => slot.slotId)).size !== slots.length) {
    throw new WeeklyImageQueueError('weekly_image_scope_incomplete');
  }
  return slots;
}

/** Strict read-only diagnostic for a frozen set of image references. */
export async function preflightWeeklyImageQueue(store: DataStore, tenantId: string, pack: WeeklyPackage | undefined) {
  const slots = weeklyImageScope(pack);
  if (!slots.length) return [];
  if (new Set(slots.map(slot => slot.referenceId)).size !== slots.length
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
    if (!currentEvidence(reference)) {
      throw new WeeklyImageQueueError('weekly_image_reference_analysis_incomplete');
    }
    const imageUrl = (analysis.imageUrls as string[])[0]!;
    checked.push({ slot, reference, imageUrl });
  }
  return checked;
}

/** Post-activation reconciliation. Deterministic identities and a plan lease prevent duplicate or parallel paid work. */
export async function ensureWeeklyImageQueue(input: {
  store: DataStore; tenantId: string; userId: string; plan: PlanRecord; run: RunRecord;
  onIssue?: (slotId: string, code: string) => Promise<void>;
}) {
  const { store, tenantId, userId, plan, run } = input;
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  if (plan.status !== 'approved' || run.plan_id !== plan.id || run.tenant_id !== tenantId
    || !contentGenerationAuthorization(body.contentGenerationAuthorization)
    || !String(body.packageApprovedBy || '') || !String(body.packageApprovedAt || '')) {
    throw new WeeklyImageQueueError('weekly_image_approval_missing');
  }
  const slots = weeklyImageScope(body.businessPackage as WeeklyPackage | undefined);
  const repository = createStarter198Repository(store);
  const receipts: Array<{ slotId: string; contentTaskId: string; imageTaskId: string; jobId: string; status: string }> = [];
  const active = new Set(['queued', 'running', 'retry_wait', 'reconciling']);
  // A plan-scoped lease makes the one-at-a-time admission rule safe across workers.
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId,
    scope: 'weekly-image-admission', subjectId: plan.id, ownerId: randomUUID(), leaseDurationMs: 60_000 });
  if (!lease) return receipts;
  try {
  const jobs = await listContentExecutionJobs(store, tenantId);
  const activeSlots = slots.flatMap(slot => jobs.filter(job => job.taskType === 'social_image_replication'
    && job.taskId === weeklyImageTaskId(tenantId, plan.id, slot.slotId) && active.has(job.status))
    .map(job => ({ slot, job })));
  if (activeSlots.length > 1) throw new WeeklyImageQueueError('weekly_image_parallel_jobs_require_reconciliation', 503);
  if (activeSlots[0]) {
    const { slot, job } = activeSlots[0];
    return [{ slotId: slot.slotId, contentTaskId: job.taskId, imageTaskId: job.runId,
      jobId: job.id, status: job.status }];
  }
  const contentTasks = new Map<string, Awaited<ReturnType<typeof createSocialContentTask>>>();
  // Establish all independently addressable image tasks before checking any
  // reference or admitting the first paid image job.
  for (const slot of slots) {
    if (!slot.productId || !slot.productName) {
      await input.onIssue?.(slot.slotId, 'weekly_image_product_missing');
      continue;
    }
    const contentTaskId = weeklyImageTaskId(tenantId, plan.id, slot.slotId);
    const idempotencyKey = `weekly-image:${contentTaskId}`;
    try {
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
      contentTasks.set(slot.slotId, content);
    } catch (error) {
      const code = error instanceof Error ? ('code' in error ? String(error.code) : error.message) : 'weekly_image_content_task_unavailable';
      if (code === 'local_store_reconciliation_required') throw error;
      await input.onIssue?.(slot.slotId, code);
    }
  }
  for (const slot of slots) {
    const contentTaskId = weeklyImageTaskId(tenantId, plan.id, slot.slotId);
    const content = contentTasks.get(slot.slotId);
    if (!content) continue;
    const previous = jobs.filter(job => job.taskType === 'social_image_replication' && job.taskId === contentTaskId);
    if (previous.length > 1) throw new WeeklyImageQueueError('weekly_image_queue_identity_ambiguous', 503);
    if (previous[0]) {
      receipts.push({ slotId: slot.slotId, contentTaskId, imageTaskId: previous[0].runId,
        jobId: previous[0].id, status: previous[0].status });
      if (active.has(previous[0].status)) break;
      continue;
    }
    try {
    if (!slot.productId || !slot.productName || !slot.referenceId || !slot.referenceSourceUrl) {
      await input.onIssue?.(slot.slotId, 'weekly_image_scope_incomplete');
      continue;
    }
    // Invalid or stale references are item-local. Other images may still advance.
    const reference = await store.getById<Reference>('trend_videos', slot.referenceId!);
    if (!reference || (reference.tenantId !== tenantId && reference.tenant_id !== tenantId)
      || String(reference.sourceUrl || '') !== slot.referenceSourceUrl) {
      await input.onIssue?.(slot.slotId, 'weekly_image_reference_changed');
      continue;
    }
    const analysis = videoAnalysisOf(reference);
    if (!currentEvidence(reference)) {
      const queueState = String(analysis.imageAnalysisQueueState || '');
      const requestedForThisPlan = analysis.weeklyImageAnalysisRequestedPlanId === plan.id;
      if (!['queued', 'processing', 'unknown'].includes(queueState) && !requestedForThisPlan) {
        const { imagePostAnalysisQueue } = await import('../routes/videos.js');
        await imagePostAnalysisQueue.queue(reference.id, {
          tenantId, platform: String(reference.platform || 'instagram') as 'instagram',
          title: String(reference.title || ''), sourceUrl: String(reference.sourceUrl || ''),
          thumbnailUrl: String(reference.thumbnailUrl || ''), caption: String(analysis.caption || reference.title || ''),
          imageUrls: Array.isArray(analysis.imageUrls) ? analysis.imageUrls.map(String) : [],
          views: String(analysis.views || ''), tags: [], uploadedAt: String(analysis.uploadedAt || ''),
        }, String(analysis.keyword || ''), { weeklyPlanId: plan.id });
      } else if (queueState === 'unknown' || queueState === 'failed') {
        await input.onIssue?.(slot.slotId, `weekly_image_reference_analysis_${queueState}`);
      }
      continue;
    }
    if (!usableWeeklyImageReference(reference)) {
      await input.onIssue?.(slot.slotId, 'weekly_image_reference_unusable');
      continue;
    }
    const imageUrl = (analysis.imageUrls as string[])[0]!;
    const idempotencyKey = `weekly-image:${contentTaskId}`;
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
    // Admit only one image. The next is admitted on the next worker cycle after this one ends.
    break;
    } catch (error) {
      const code = error instanceof Error ? ('code' in error ? String(error.code) : error.message) : 'weekly_image_queue_unavailable';
      if (code === 'local_store_reconciliation_required') throw error;
      await input.onIssue?.(slot.slotId, code);
      // A problem with this image does not stop admission of a healthy sibling.
    }
  }
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
  return receipts;
}

export async function weeklyImageProgress(store: DataStore, tenantId: string, plan: PlanRecord) {
  const slots = weeklyImageScope(jsonObject<Record<string, unknown>>(plan.plan, {}).businessPackage as WeeklyPackage | undefined);
  if (!slots.length) return { total: 0, succeeded: 0, active: 0, blocked: 0, firstIssue: '' };
  const jobs = await listContentExecutionJobs(store, tenantId);
  const relevant = slots.map(slot => jobs.filter(job => job.taskType === 'social_image_replication'
    && job.taskId === weeklyImageTaskId(tenantId, plan.id, slot.slotId)));
  if (relevant.some(rows => rows.length > 1)) throw new WeeklyImageQueueError('weekly_image_queue_identity_ambiguous', 503);
  let blockedWithoutJob = 0;
  let firstIssue = '';
  for (let index = 0; index < slots.length; index += 1) {
    if (relevant[index]?.[0]) continue;
    const slot = slots[index]!;
    if (!slot.productId || !slot.productName || !slot.referenceId || !slot.referenceSourceUrl) {
      blockedWithoutJob += 1;
      firstIssue ||= `第 ${index + 1} 张图片还缺${!slot.productId || !slot.productName ? '产品' : '参考图片'}。`;
      continue;
    }
    const reference = await store.getById<Reference>('trend_videos', slot.referenceId!);
    if (!reference || (reference.tenantId !== tenantId && reference.tenant_id !== tenantId)
      || String(reference.sourceUrl || '') !== slot.referenceSourceUrl) {
      blockedWithoutJob += 1;
      firstIssue ||= `第 ${index + 1} 张图片的参考已变化，请重新选择。`;
      continue;
    }
    const analysis = videoAnalysisOf(reference);
    if (['failed', 'unknown', 'source_changed'].includes(String(analysis.imageAnalysisQueueState || ''))
      || (currentEvidence(reference) && !usableWeeklyImageReference(reference))) {
      blockedWithoutJob += 1;
      firstIssue ||= `第 ${index + 1} 张参考图片暂不可用，请处理该图片任务。`;
    } else if (!currentEvidence(reference)) {
      firstIssue ||= `第 ${index + 1} 张参考图片正在补做最新分析。`;
    }
  }
  return { total: slots.length, succeeded: relevant.filter(rows => rows[0]?.status === 'succeeded').length,
    active: relevant.filter(rows => rows[0] && ['queued', 'running', 'retry_wait', 'reconciling'].includes(rows[0].status)).length,
    blocked: blockedWithoutJob + relevant.filter(rows => rows[0] && ['blocked', 'paused', 'cancelled', 'dead_letter'].includes(rows[0].status)).length,
    firstIssue };
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
