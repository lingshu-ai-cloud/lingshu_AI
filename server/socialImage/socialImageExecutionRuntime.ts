import {getTenantSubscription,isEntitled,isSubscriptionEnforced} from '../middleware/subscription.js';
import type { DataStore } from '../storage/datastore.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { consumeIdentityDemoQuota } from '../lib/demo.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { planStudioPoster } from './studioPosterPlanning.js';
import { prepareImageEvidence, renderImageLayers, preflightImage } from './socialImageWorkflowCommands.js';
import { imageWorkflowAssets } from './socialImageWorkflowAssets.js';
import { compileEvidenceGuidedSocialImage, socialImageFrozenGraphMatches } from './socialImageReferenceStrategy.js';
import { compileSocialImageV3PaidPlan } from './socialImageFormalPlan.js';
import { renderSocialImagePaidWorker } from './socialImagePaidWorkerRender.js';
import { readSocialImageTask } from './socialImageTask.js';
import { socialImagePackagingLabelHint } from './socialImagePackagingLabel.js';
import type { ImageExecutionPorts } from './socialImageExecution.js';
import type { SocialImageElementInventory } from '../../shared/contracts/socialImageProduction.js';
export function createImageExecutionPorts(store: DataStore, job: ContentExecutionJob): ImageExecutionPorts {
    const assets = imageWorkflowAssets(store);
    const allowPaidCall = async () => {
        if (process.env.SOCIAL_IMAGE_EXECUTION_PAID_ENABLED === 'false')
            throw new Error('social_image_paid_execution_disabled');
        if(isSubscriptionEnforced()&&!isEntitled(await getTenantSubscription(job.tenantId)))throw new Error('social_image_subscription_required');
        const quota = await consumeIdentityDemoQuota({ tenantId: job.tenantId, userId: job.userId }, 'generation');
        if (!quota.ok)
            throw new Error(quota.error);
        return true;
    };
    const command = (task: Parameters<ImageExecutionPorts['prepare']>[0]) => ({
        store, tenantId: job.tenantId, taskId: task.id, expectedVersion: task.version, ...assets, allowPaidCall,
    });
    return {
        prepare: async (task) => { await prepareImageEvidence(command(task)); },
        plan: async (source) => {
            let task = source;
            const inventory = task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'element_inventory'
                && node.status === 'completed').sort((left, right) => right.version - left.version)[0];
            if (!inventory) throw new Error('social_image_reference_evidence_incomplete');
            // Prove that the selected reference can produce the requested canvas
            // before the first paid planning request is claimed or submitted.
            compileEvidenceGuidedSocialImage({ task, inventory: inventory.value as SocialImageElementInventory,
                productId: task.contentBrief.productRefs[0] || '', headline: 'layout preflight' });
            if (task.productionRuntime?.nodes.find(node => node.nodeId === 'director_brief')?.status !== 'completed') {
                if (process.env.SOCIAL_IMAGE_EXECUTION_PAID_ENABLED === 'false')
                    throw new Error('social_image_paid_execution_disabled');
                const claim = { stage: 'image.planning', version: '1', inputHash: job.checkpoints['image.confirmed']!.inputHash };
                if (readCurrentContentExecutionCheckpoint(claim))
                    throw new Error('social_image_planning_outcome_requires_review');
                let providerCallStarted = false;
                try {
                    const selectedProduct = task.contentBrief.productRefs[0]
                        ? await assets.enterpriseProductAsset(job.tenantId, task.contentBrief.productRefs[0]) : null;
                    const packagingHint = selectedProduct ? await socialImagePackagingLabelHint(selectedProduct.bytes) : '';
                    await planStudioPoster({ store, tenantId: job.tenantId,
                        body: { imageTaskId: task.id, expectedImageTaskVersion: task.version },
                        packagingHint,
                        enterpriseCtx: async () => buildEnterpriseContext(await readTenantEnterpriseProfile(job.tenantId)), allowPaidCall,
                        beforeProviderCall: async () => {
                            // Only pre-transport claims are uncertain. Validation and
                            // quota denials must not poison the task as a paid result.
                            await recordCurrentContentExecutionCheckpoint({ ...claim, payload: { state: 'started' } });
                            providerCallStarted = true;
                        } });
                } catch (error) {
                    const code = error && typeof error === 'object' && 'body' in error
                        ? String((error as { body?: { code?: string } }).body?.code || 'social_image_planning_failed')
                        : 'social_image_planning_failed';
                    if (providerCallStarted)
                        await recordCurrentContentExecutionCheckpoint({ ...claim, payload: { state: 'outcome_unknown', code } });
                    throw new Error(code);
                }
                const planned = await readSocialImageTask(store, job.tenantId, task.id);
                const directorCompleted = planned?.productionRuntime?.nodes.find(node => node.nodeId === 'director_brief')?.status === 'completed';
                await recordCurrentContentExecutionCheckpoint({ ...claim, payload: directorCompleted
                    ? { state: 'completed' } : { state: 'completed_requires_review', code: 'social_image_planner_result_requires_review' } });
                if (!planned || !directorCompleted)
                    throw new Error('social_image_planner_result_requires_review');
                task = planned;
            }
            await compileSocialImageV3PaidPlan({ store, tenantId: job.tenantId, taskId: task.id,
                expectedVersion: task.version });
        },
        render: async (task) => { if (socialImageFrozenGraphMatches(task)) await renderImageLayers(command(task));
            else await renderSocialImagePaidWorker(command(task)); },
        quality: async (task) => { await preflightImage(command(task)); },
    };
}
