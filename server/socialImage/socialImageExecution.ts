import type { DataStore } from '../storage/datastore.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { ContentExecutionStoppedError, assertCurrentContentExecutionActive } from '../contentExecution/context.js';
import { readSocialImageTask } from './socialImageTask.js';
import { assertSocialImageCurrentContentTask } from './socialImageProductionRun.js';
import { IMAGE_EXECUTION_TYPE, imageExecutionInputHash } from './socialImageExecutionQueue.js';
import { socialImageV3PaidPrerequisiteIssue } from './socialImagePaidPrerequisites.js';
import { socialImageFrozenGraphMatches } from './socialImageReferenceStrategy.js';
import { localCompositeRepairCandidate } from './socialImageLocalCompositeRepair.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { referenceProductCheckIssue } from './socialImageReferenceProductPolicy.js';
import { readSocialImageReferenceBytes } from './socialImageReferenceBytes.js';
export interface ImageExecutionPorts {
    prepare(task: SocialImageCreationTask): Promise<void>;
    plan(task: SocialImageCreationTask): Promise<void>;
    render(task: SocialImageCreationTask): Promise<void>;
    quality(task: SocialImageCreationTask): Promise<void>;
    repair?(task: SocialImageCreationTask): Promise<{ additionalPaidQualityRequired: boolean }>;
    readReference?: typeof readSocialImageReferenceBytes;
}
function repairedCandidateNeedsQualityReview(task: SocialImageCreationTask): boolean {
    const current = task.outputs.find(output => output.state !== 'superseded');
    if (!current || current.state !== 'quality_checking' || current.qualityPreflight) return false;
    return task.repairInstructions.some(instruction => instruction.status === 'completed'
        && instruction.toVersion === current.version
        && task.outputs.some(output => output.id === instruction.outputNodeId
            && output.state === 'superseded' && output.qualityPreflight?.status === 'completed'));
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
        if (!task.outputs.some(output => output.state !== 'superseded')) {
            const url = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || '';
            const reference = url ? await (ports.readReference || readSocialImageReferenceBytes)(job.tenantId, url) : null;
            const issue = referenceProductCheckIssue(task, reference?.bytes || null);
            if (issue) throw new Error(issue);
        }
        if (!task.productionRuntime?.nodes.some(node => node.nodeId === 'adaptation' && node.status === 'completed')) {
            await ports.prepare(task);
            task = await read();
            if (!task.productionRuntime?.nodes.some(node => node.nodeId === 'adaptation' && node.status === 'completed'))
                throw new Error('social_image_evidence_incomplete');
        }
        // A saved candidate is already past paid admission. Its QA repair
        // instruction can make the old render spec stale without authorizing a
        // new planner or image request.
        if (!task.outputs.some(output => output.state !== 'superseded')
            && socialImageV3PaidPrerequisiteIssue(task, 'execute') && !socialImageFrozenGraphMatches(task)) {
            await ports.plan(task);
            task = await read();
            if (socialImageV3PaidPrerequisiteIssue(task, 'execute') && !socialImageFrozenGraphMatches(task))
                throw new Error('social_image_execution_plan_incomplete');
        }
        if (!task.outputs.some(output => output.state !== 'superseded')) {
            await ports.render(task);
            task = await read();
            if (!task.outputs.some(output => output.state !== 'superseded'))
                throw new Error('social_image_candidate_missing');
        }
        if (task.productionRuntime?.nodes.find(node => node.nodeId === 'quality_check')?.status !== 'completed'
            && localCompositeRepairCandidate(task) && ports.repair) {
            const repaired = await ports.repair(task);
            task = await read();
            // Local recomposition is free; a second visual QA needs an explicit
            // review of the previous provider receipt, not a budget ceiling.
            if (repaired.additionalPaidQualityRequired)
                throw new Error('social_image_repair_quality_requires_review');
        }
        if (task.productionRuntime?.nodes.find(node => node.nodeId === 'quality_check')?.status !== 'completed') {
            // The decision survives worker restarts; never call visual QA on a
            // repaired candidate whose predecessor already consumed QA.
            if (repairedCandidateNeedsQualityReview(task))
                throw new Error('social_image_repair_quality_requires_review');
            await ports.quality(task);
            task = await read();
        }
        if (task.productionRuntime?.nodes.find(node => node.nodeId === 'quality_check')?.status !== 'completed'
            && localCompositeRepairCandidate(task) && ports.repair) {
            const repaired = await ports.repair(task);
            task = await read();
            if (repaired.additionalPaidQualityRequired || repairedCandidateNeedsQualityReview(task))
                throw new Error('social_image_repair_quality_requires_review');
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
        const failure = error as { code?: unknown; body?: { code?: unknown } } | null;
        const stableCode = failure?.body?.code || failure?.code;
        const reason = typeof stableCode === 'string' && /^social_image_[a-z0-9_]+$/.test(stableCode)
            ? stableCode : error instanceof Error ? error.message : 'social_image_execution_failed';
        throw new Error(`user_input_required:${reason}`);
    }
}
export async function executePersistedImageProduction(store: DataStore, job: ContentExecutionJob) {
    const { createImageExecutionPorts } = await import('./socialImageExecutionRuntime.js');
    return executeImageProduction(store, job, createImageExecutionPorts(store, job));
}
