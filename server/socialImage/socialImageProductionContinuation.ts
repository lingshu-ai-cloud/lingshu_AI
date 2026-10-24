import type { DataStore } from '../storage/datastore.js';
import { socialImageReviewOutputs, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageDeliveryPackage } from '../../shared/contracts/socialImageProduction.js';
import { readSocialImageTask } from './socialImageTask.js';
import {
  createSocialImageDeliveryPackage,
  runSocialImageDirectorReview,
  SocialImageProductionRunError,
} from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';

export type SocialImageProductionContinuation = {
  task: SocialImageCreationTask;
  deliveryPackage?: SocialImageDeliveryPackage;
  advancedNodes: Array<'director_review' | 'delivery'>;
};

/**
 * Continue only deterministic, no-provider production nodes.
 *
 * Evidence collection, paid planning, candidate generation, visual preflight,
 * repair and explicit user approval have their own guarded commands. This
 * function deliberately stops at those boundaries instead of guessing intent
 * or turning a browser retry into a paid provider retry.
 */
export async function continueSocialImageProduction(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  now?: string;
}): Promise<SocialImageProductionContinuation> {
  const found = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!found) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (found.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  let task: SocialImageCreationTask = found;
  const advancedNodes: SocialImageProductionContinuation['advancedNodes'] = [];
  let deliveryPackage: SocialImageDeliveryPackage | undefined;

  for (let step = 0; step < 3; step += 1) {
    const snapshot = projectSocialImageProductionSnapshot(task);
    if (snapshot.currentNode === 'director_review' && snapshot.currentStatus === 'needs_review') {
      const outputs = socialImageReviewOutputs(task);
      if (!outputs.length) break;
      const anchor = task.imageType === 'gif_poster' ? outputs.at(-1)! : outputs[0]!;
      task = await runSocialImageDirectorReview({
        store: input.store,
        tenantId: input.tenantId,
        taskId: task.id,
        expectedVersion: task.version,
        candidateId: anchor.id,
        candidateVersion: anchor.version,
        now: input.now,
      });
      advancedNodes.push('director_review');
      if (task.directorReviewDecision?.decision !== 'accept_for_user_review') break;
      continue;
    }
    if (snapshot.currentNode === 'delivery' && snapshot.currentStatus === 'needs_review') {
      const delivered = await createSocialImageDeliveryPackage({
        store: input.store,
        tenantId: input.tenantId,
        taskId: task.id,
        expectedVersion: task.version,
        now: input.now,
      });
      task = delivered.task;
      deliveryPackage = delivered.deliveryPackage;
      advancedNodes.push('delivery');
      continue;
    }
    break;
  }

  return { task, advancedNodes, ...(deliveryPackage ? { deliveryPackage } : {}) };
}
