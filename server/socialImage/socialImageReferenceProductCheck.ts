import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { listContentExecutionJobs } from '../contentExecution/durableQueue.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { readSocialImageReferenceBytes } from './socialImageReferenceBytes.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { readSocialImageTask, SOCIAL_IMAGE_TASKS_COLLECTION, updateSocialImageTask } from './socialImageTask.js';
import { assertSocialImageCurrentContentTask, SocialImageProductionRunError } from './socialImageProductionRun.js';
export { referenceProductCheckIssue } from './socialImageReferenceProductPolicy.js';

const referenceUrl = (task: SocialImageCreationTask) => task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || '';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Exact-byte agent observation is preferred; uncertain images still need a human decision. */
export async function confirmReferenceProduct(input: {
  store: DataStore; tenantId: string; userId: string; taskId: string; expectedVersion: number; decision: 'auto' | 'present' | 'absent';
  readReference?: typeof readSocialImageReferenceBytes;
}): Promise<SocialImageCreationTask> {
  const { store, tenantId } = input;
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId, scope: 'social_image_dispatch', subjectId: input.taskId, ownerId: randomUUID(), leaseDurationMs: 30000 });
  if (!lease) throw new SocialImageProductionRunError('social_image_dispatch_busy', 409);
  try {
    const task = await readSocialImageTask(store, tenantId, input.taskId);
    if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
    if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
    if (!input.userId.trim() || task.creationPath !== 'viral_replication' || !task.productionRuntime?.binding) throw new SocialImageProductionRunError('social_image_reference_check_scope_invalid', 422);
    await assertSocialImageCurrentContentTask(store, tenantId, task, 'dispatch');
    const jobs = await listContentExecutionJobs(store, tenantId);
    if (jobs.some(job => job.taskType === 'social_image_replication' && job.runId === task.id) || task.generationJobs.length || task.outputs.length) throw new SocialImageProductionRunError('social_image_existing_production_requires_review', 409);
    if (!store.compareAndSwap || await store.supportsAtomicCompareAndSwapFor?.(SOCIAL_IMAGE_TASKS_COLLECTION) !== true) throw new SocialImageProductionRunError('social_image_atomic_store_required', 503);
    const source = await (input.readReference || readSocialImageReferenceBytes)(tenantId, referenceUrl(task));
    if (!source?.bytes.length) throw new SocialImageProductionRunError('social_image_reference_bytes_unreadable', 422);
    try { await sharp(source.bytes, { limitInputPixels: 16000000 }).rotate().toBuffer(); }
    catch { throw new SocialImageProductionRunError('social_image_reference_bytes_unreadable', 422); }
    const sourceSha256 = digest(source.bytes);
    let confirmedBy = input.userId;
    let decision: 'present' | 'absent' = input.decision === 'absent' ? 'absent' : 'present';
    if (input.decision === 'auto') {
      const sourceId = task.referenceSnapshot?.sourceRecordId;
      const row = sourceId ? await store.getById<Record<string, unknown>>('trend_videos', sourceId) : null;
      const analysis = row && String(row.tenantId || row.tenant_id || '') === tenantId ? videoAnalysisOf(row) : null;
      const evidence = analysis?.contentFormat === 'image' ? analysis.imageEvidence as Record<string, unknown> | undefined : undefined;
      if (sourceId) {
        const state = String(analysis?.imageAnalysisQueueState || '');
        if (state === 'queued' || state === 'processing') throw new SocialImageProductionRunError('social_image_reference_analysis_in_progress', 409);
        if (state === 'unknown') throw new SocialImageProductionRunError('social_image_reference_analysis_reconciliation_required', 409);
        if (analysis?.imageAnalysisStatus === 'failed') throw new SocialImageProductionRunError('social_image_reference_analysis_failed', 422);
        if (!Array.isArray(evidence?.productionLabels) && evidence?.status === 'analyzed') throw new SocialImageProductionRunError('social_image_reference_analysis_outdated', 422);
        if (row && analysis && !Array.isArray(evidence?.productionLabels)) throw new SocialImageProductionRunError('social_image_reference_analysis_required', 422);
      }
      const labels = evidence?.version === 2 && evidence.status === 'analyzed' && Array.isArray(evidence.productionLabels)
        ? evidence.productionLabels.filter((raw: unknown) => raw && typeof raw === 'object' && (raw as Record<string, unknown>).sourceSha256 === sourceSha256)
        : [];
      const label = labels.length === 1 ? labels[0] as Record<string, unknown> : null;
      if ((label?.productPresence !== 'present' && label?.productPresence !== 'absent' && label?.kind !== 'product_only')
        || (label?.kind === 'product_only' && label.productPresence === 'absent')
        || typeof label.confidence !== 'number' || label.confidence < .8
        || typeof label.evidence !== 'string' || !label.evidence.trim()) {
        throw new SocialImageProductionRunError('social_image_reference_product_uncertain', 422);
      }
      decision = label.productPresence === 'absent' ? 'absent' : 'present';
      confirmedBy = 'agent:image-post-evidence.v2';
    }
    await assertDurableOperationLease({ dataStore: store, lease });
    const state = decision === 'absent' ? { status: 'blocked' as const, step: 'inputs' as const }
      : task.status === 'blocked' && task.referenceProductCheck?.decision === 'absent' ? { status: 'draft' as const, step: 'inputs' as const } : {};
    const result = await updateSocialImageTask(store, tenantId, task.id, task.version, { ...state, referenceProductCheck: {
      sourceSha256, decision, confirmedBy, confirmedAt: new Date().toISOString(),
    } });
    if (result.kind !== 'updated') throw new SocialImageProductionRunError('social_image_version_conflict', 409);
    return result.task;
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}
