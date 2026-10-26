import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { admitContentExecutionJob, listContentExecutionJobs, type ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { readSocialImageTask } from './socialImageTask.js';
import { assertSocialImageCurrentContentTask, SocialImageProductionRunError } from './socialImageProductionRun.js';
import { socialImageProductionHash } from './socialImageProductionHash.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution.js';
export const IMAGE_EXECUTION_TYPE = 'social_image_replication';
export function imageExecutionInputHash(task: SocialImageCreationTask): string {
    return socialImageProductionHash({ binding: task.productionRuntime?.binding, creationPath: task.creationPath,
        imageType: task.imageType, contentBrief: task.contentBrief, deliverySpec: task.deliverySpec,
        enterpriseAssets: task.enterpriseAssets, materialIds: task.materialIds,
        referenceUrls: task.referenceUrls, referenceSnapshot: task.referenceSnapshot });
}
export const imageExecutionReceipt = (job: ContentExecutionJob): SocialImageExecutionReceipt => ({
    jobId: job.id, status: job.status, attempt: job.attempt, lastError: job.lastError ? (job.lastError.match(/social_image_[a-z0-9_]+|demo_[a-z0-9_]+/)?.[0] || 'social_image_execution_requires_review') : null,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
});
export async function readImageExecutionJob(store: DataStore, tenantId: string, task: SocialImageCreationTask) {
    const contentId = task.productionRuntime?.binding?.contentTaskId;
    if (!contentId)
        return null;
    const jobs = await listContentExecutionJobs(store, tenantId);
    const matches = jobs.filter(job => job.taskType === IMAGE_EXECUTION_TYPE && job.taskId === contentId && job.runId === task.id);
    if (matches.length > 1)
        throw new SocialImageProductionRunError('social_image_queue_identity_ambiguous', 503);
    return matches[0] || null;
}
/** Persist admission under the same run identity. Repeated confirmation returns the original receipt. */
export async function enqueueImageExecution(input: {
    store: DataStore;
    tenantId: string;
    userId: string;
    taskId: string;
    expectedVersion: number;
}) {
    const lease = await acquireDurableOperationLease({ dataStore: input.store, tenantId: input.tenantId,
        scope: 'social_image_dispatch', subjectId: input.taskId, ownerId: randomUUID(), leaseDurationMs: 30000 });
    if (!lease)
        throw new SocialImageProductionRunError('social_image_dispatch_busy', 409);
    try {
        const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
        if (!task)
            throw new SocialImageProductionRunError('social_image_task_missing', 404);
        await assertSocialImageCurrentContentTask(input.store, input.tenantId, task, 'dispatch');
        const binding = task.productionRuntime?.binding;
        if (!binding || task.creationPath !== 'viral_replication' || task.imageType !== 'product_poster')
            throw new SocialImageProductionRunError('social_image_queue_scope_unsupported', 422);
        const existing = await readImageExecutionJob(input.store, input.tenantId, task);
        if (existing)
            return { task, execution: imageExecutionReceipt(existing) };
        if (task.version !== input.expectedVersion)
            throw new SocialImageProductionRunError('social_image_version_conflict', 409);
        if (task.outputs.length || task.generationJobs.length || task.status === 'approved')
            throw new SocialImageProductionRunError('social_image_existing_production_requires_review', 409);
        const content = await input.store.list<Record<string, unknown>>('starter_social_content_tasks', {
            where: { tenant_id: input.tenantId, task_id: binding.contentTaskId }, perPage: 2
        });
        if (content.totalItems !== 1 || ['cancelled', 'cancelling'].includes(String(content.items[0]?.status)))
            throw new SocialImageProductionRunError('social_image_content_task_not_executable', 409);
        if (!input.store.compareAndSwap || await input.store.supportsAtomicCompareAndSwapFor?.('content_execution_jobs') !== true)
            throw new SocialImageProductionRunError('social_image_atomic_store_required', 503);
        const inputHash = imageExecutionInputHash(task);
        const job = await admitContentExecutionJob({ dataStore: input.store, tenantId: input.tenantId,
            userId: input.userId, taskId: binding.contentTaskId, runId: task.id, taskType: IMAGE_EXECUTION_TYPE,
            initialCheckpoints: { 'image.confirmed': { version: '1', inputHash,
                    payload: { imageTaskId: task.id, contentTaskId: binding.contentTaskId }, updatedAt: new Date().toISOString() } } });
        return { task, execution: imageExecutionReceipt(job) };
    }
    finally {
        await releaseDurableOperationLease({ dataStore: input.store, lease });
    }
}
