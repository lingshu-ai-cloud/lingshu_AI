import type { DataStore } from '../storage/datastore.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { ContentExecutionStoppedError, assertCurrentContentExecutionActive } from '../contentExecution/context.js';
import { readSocialImageTask } from './socialImageTask.js';
import { assertSocialImageCurrentContentTask } from './socialImageProductionRun.js';
import { IMAGE_EXECUTION_TYPE, imageExecutionInputHash } from './socialImageExecutionQueue.js';
import { socialImageFrozenGraphMatches } from './socialImageReferenceStrategy.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
export interface ImageExecutionPorts {
    prepare(task: SocialImageCreationTask): Promise<void>;
    plan(task: SocialImageCreationTask): Promise<void>;
    render(task: SocialImageCreationTask): Promise<void>;
    quality(task: SocialImageCreationTask): Promise<void>;
}
/** One executor on the existing durable worker. Every boundary rereads persisted facts. */
export async function executeImageProduction(store: DataStore, job: ContentExecutionJob, ports: ImageExecutionPorts) {
    if (job.taskType !== IMAGE_EXECUTION_TYPE)
        throw new Error('user_input_required:social_image_executor_mismatch');
    const read = async () => {
        await assertCurrentContentExecutionActive();
        const task = await readSocialImageTask(store, job.tenantId, job.runId);
        if (!task || task.productionRuntime?.binding?.contentTaskId !== job.taskId
            || job.checkpoints['image.confirmed']?.inputHash !== imageExecutionInputHash(task))
            throw new Error('user_input_required:social_image_confirmed_inputs_changed');
        await assertSocialImageCurrentContentTask(store, job.tenantId, task, 'dispatch');
        if (task.generationJobs.some(unit => ['running', 'outcome_unknown'].includes(unit.status)))
            throw new Error('user_input_required:social_image_paid_outcome_unresolved');
        return task;
    };
    try {
        let task = await read();
        if (task.status === 'approved' || task.approvedArtifact)
            return;
        if (!task.productionRuntime?.nodes.some(node => node.nodeId === 'adaptation' && node.status === 'completed')) {
            await ports.prepare(task);
            task = await read();
            if (!task.productionRuntime?.nodes.some(node => node.nodeId === 'adaptation' && node.status === 'completed'))
                throw new Error('social_image_evidence_incomplete');
        }
        if (!socialImageFrozenGraphMatches(task)) {
            await ports.plan(task);
            task = await read();
            if (!socialImageFrozenGraphMatches(task))
                throw new Error('social_image_execution_plan_incomplete');
        }
        if (!task.outputs.some(output => output.state !== 'superseded')) {
            await ports.render(task);
            task = await read();
            if (!task.outputs.some(output => output.state !== 'superseded'))
                throw new Error('social_image_candidate_missing');
        }
        if (task.productionRuntime?.nodes.find(node => node.nodeId === 'quality_check')?.status !== 'completed') {
            await ports.quality(task);
            task = await read();
        }
        if (task.productionRuntime?.nodes.find(node => node.nodeId === 'quality_check')?.status !== 'completed')
            throw new Error('social_image_quality_requires_review');
        if (task.directorReviewDecision?.decision !== 'accept_for_user_review')
            throw new Error('social_image_director_review_requires_changes');
        // User acceptance and publishing are deliberately outside this production job.
    }
    catch (error) {
        if(error instanceof ContentExecutionStoppedError)throw error;
    // A lost planning/QA receipt is never a reason to replay a paid request.
        throw new Error(`user_input_required:${error instanceof Error ? error.message : 'social_image_execution_failed'}`);
    }
}
export async function executePersistedImageProduction(store: DataStore, job: ContentExecutionJob) {
    const { createImageExecutionPorts } = await import('./socialImageExecutionRuntime.js');
    return executeImageProduction(store, job, createImageExecutionPorts(store, job));
}
