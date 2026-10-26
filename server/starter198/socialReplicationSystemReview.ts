import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import type { Starter198Repository } from './repository.js';
import { readSocialTaskDetail } from './socialContentRecords.js';
import { confirmSocialReplicationScript, readSocialReplicationScriptReviewContext, socialReplicationIdentityGaps } from './socialContentReplicationScriptReview.js';
import { socialContentReviewAdmissionAllowed } from './socialContentTestBypass.js';
import { SocialContentWorkflowError, socialJson, socialObject } from './socialContentValidation.js';

export function systemReviewAppliedForStart(record: Record<string, unknown>, operationId: string): boolean {
  const script = socialObject(socialJson(record.replication_script)), review = socialObject(script?.review);
  return script?.status === 'confirmed' && review?.reviewedBy === 'system:replication-review'
    && Array.isArray(review.evidence) && review.evidence.includes(`system:request:${operationId}:system-review`)
    && review.evidence.includes(`system:confirmed-task-version:${record.version}`);
}

/** Internal evidence derived from the current task, never client supplied approvals. */
export function replicationSystemReviewBlockers(task: SocialContentTaskDetail): string[] {
  const reasons: string[] = [];
  if (task.brief.creationMode !== 'viral_replication') reasons.push('replication_mode_required');
  const analysis = task.referenceVideoAnalysis;
  const script = task.replicationScript;
  if (analysis?.status !== 'ready' || !analysis.coverage?.fullTimelineCovered) reasons.push('reference_analysis_incomplete');
  if (!script || script.referenceAnalysisId !== analysis?.analysisId || !script.shots.length) reasons.push('script_analysis_mismatch');
  if (script && socialReplicationIdentityGaps(script, task.enterpriseProductBinding).length) reasons.push('product_identity_unresolved');
  const review = task.agentWorkflow?.executionPlanReview;
  if (!review || !socialContentReviewAdmissionAllowed(review)) reasons.push(...(review?.reasonCodes.length ? review.reasonCodes : ['execution_plan_unavailable']));
  if (review && (review.failedCriteria.length || review.requiredRevision.length || !review.sceneResults.length
    || review.sceneResults.some(scene => !scene.approved || scene.failedCriteria.length)
    || review.sceneResults.length !== task.agentWorkflow?.directorBrief.scenes.length)) reasons.push('scene_review_incomplete');
  return [...new Set(reasons)];
}

export async function reviewReplicationBySystem(input: {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string;
  expectedVersion: string; idempotencyKey: string; now?: Date;
}): Promise<SocialContentTaskDetail> {
  const task = await readSocialTaskDetail(input);
  if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
  const context = await readSocialReplicationScriptReviewContext(input);
  if (task.version !== input.expectedVersion) throw new SocialContentWorkflowError('social_content_task_version_conflict', 409);
  const blockers = replicationSystemReviewBlockers(task);
  if (blockers.length) throw new SocialContentWorkflowError(`social_replication_system_review_blocked:${blockers.join(',')}`, 409);
  if (task.replicationScript?.status === 'confirmed') return task;
  return confirmSocialReplicationScript({ ...input, userId: 'system:replication-review', systemReview: true, value: {
    expectedVersion: task.version, analysisId: context.analysisId, analysisHash: context.analysisHash,
    scriptHash: context.scriptHash,
    sceneDecisions: context.scenes.map(scene => ({ shotId: scene.shotId, conclusion: 'approved',
      evidence: [`system:execution-plan:${task.agentWorkflow!.executionPlanReview.reviewId}`, `system:script:${context.scriptHash}`] })),
    reviewEvidence: ['system:replication-review.v1', `requested-by:${input.userId}`,
      `system:request:${input.idempotencyKey}`, `system:confirmed-task-version:${Number(task.version) + 1}`,
      `analysis:${context.analysisHash}`, `script:${context.scriptHash}`, 'system:product-identity-and-execution-conditions-verified'],
  } });
}
