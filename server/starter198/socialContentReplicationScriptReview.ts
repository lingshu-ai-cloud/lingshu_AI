import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentDiscovery.js';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialEnterpriseProductBinding } from './socialContentTaskEvidenceProjection.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { parseStoredSocialReferenceVideoAnalysis, parseStoredSocialReplicationScript } from './socialContentScriptSources.js';
import { assertVersion, nextVersion } from './socialContentTaskSupport.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';

export interface SocialReplicationScriptSceneDecision {
  shotId: string;
  conclusion: 'approved' | 'rejected';
  evidence: string[];
}

export interface ConfirmSocialReplicationScriptInput {
  expectedVersion: string;
  analysisId: string;
  analysisHash: string;
  scriptHash: string;
  sceneDecisions: SocialReplicationScriptSceneDecision[];
  reviewEvidence: string[];
}

/** Hashes the reviewed script body while deliberately excluding its mutable
 * status and review receipt. This hash therefore remains valid after the
 * command changes review_required to confirmed. */
export function socialReplicationScriptReviewHash(value: unknown): string {
  const script = socialObject(socialJson(value));
  if (!script) throw new SocialContentWorkflowError('social_replication_script_review_invalid', 400);
  const { status: _status, review: _review, ...body } = script;
  return socialRequestHash(body);
}

export interface SocialReplicationIdentityGap {
  shotId: string;
  code: 'enterprise_product_binding_missing' | 'product_identity_not_locked' | 'product_fact_not_bound';
}

/** Advanced review may approve creative choices, but it may not turn an
 * inferred reference-video product into the tenant's real SKU. Product shots
 * must carry the exact stable product id and confirmed fact revision frozen by
 * the server before they can be confirmed. */
export function socialReplicationIdentityGaps(
  script: SocialReplicationScriptVersion,
  binding: SocialEnterpriseProductBinding | null | undefined,
): SocialReplicationIdentityGap[] {
  const gaps: SocialReplicationIdentityGap[] = [];
  for (const shot of script.shots) {
    const plan = shot.materialPlan;
    const visual = plan.visualContract;
    const needsProduct = visual?.subjects.some(subject => subject.kind === 'product')
      || plan.productSceneReplication != null;
    if (!needsProduct) continue;
    if (!binding) { gaps.push({ shotId: shot.shotId, code: 'enterprise_product_binding_missing' }); continue; }
    if (!visual || visual.product.policy !== 'locked' || visual.product.source !== 'user_explicit'
      || visual.product.requestedProductId !== binding.productId
      || visual.productUsage.productId !== binding.productId) {
      gaps.push({ shotId: shot.shotId, code: 'product_identity_not_locked' }); continue;
    }
    if (!plan.truthBoundary.confirmedFactRefs.includes(binding.enterpriseFactRef)) {
      gaps.push({ shotId: shot.shotId, code: 'product_fact_not_bound' });
    }
  }
  return gaps;
}

export async function readSocialReplicationScriptReviewContext(input: {
  repository: Starter198Repository; tenantId: string; taskId: string;
}) {
  const record = await requireSocialTask(input);
  const analysis = parseStoredSocialReferenceVideoAnalysis(record.reference_video_analysis);
  const script = parseStoredSocialReplicationScript(record.replication_script);
  if (!analysis || !script) throw new SocialContentWorkflowError('social_replication_script_review_not_ready', 409);
  const detail = await readSocialTaskDetail(input);
  const identityGaps = socialReplicationIdentityGaps(script, detail?.enterpriseProductBinding);
  return {
    expectedVersion: socialText(record.version), analysisId: analysis.analysisId,
    analysisHash: socialRequestHash(analysis), scriptHash: socialReplicationScriptReviewHash(script),
    scriptVersion: script.version, status: script.status,
    scenes: script.shots.map(shot => ({ shotId: shot.shotId,
      identityGaps: identityGaps.filter(gap => gap.shotId === shot.shotId).map(gap => gap.code) })),
  };
}

function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function normalizedInput(value: ConfirmSocialReplicationScriptInput): ConfirmSocialReplicationScriptInput {
  const decisions = Array.isArray(value.sceneDecisions) ? value.sceneDecisions.map(item => ({
    shotId: socialText(item?.shotId),
    conclusion: item?.conclusion,
    evidence: Array.isArray(item?.evidence) ? item.evidence.map(socialText).filter(Boolean) : [],
  })) : [];
  const input = {
    expectedVersion: socialText(value.expectedVersion),
    analysisId: socialText(value.analysisId),
    analysisHash: socialText(value.analysisHash),
    scriptHash: socialText(value.scriptHash),
    sceneDecisions: decisions,
    reviewEvidence: Array.isArray(value.reviewEvidence) ? value.reviewEvidence.map(socialText).filter(Boolean) : [],
  };
  if (!input.expectedVersion || !input.analysisId || !validHash(input.analysisHash) || !validHash(input.scriptHash)
    || !input.sceneDecisions.length || !input.reviewEvidence.length
    || input.sceneDecisions.some(item => !item.shotId || !['approved', 'rejected'].includes(item.conclusion)
      || !item.evidence.length || item.evidence.some(item => item.length > 500))
    || input.reviewEvidence.some(item => item.length > 500)) {
    throw new SocialContentWorkflowError('social_replication_script_review_invalid', 400);
  }
  return input as ConfirmSocialReplicationScriptInput;
}

export async function confirmSocialReplicationScript(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: ConfirmSocialReplicationScriptInput;
  now?: Date;
}): Promise<SocialContentTaskDetail> {
  const value = normalizedInput(input.value);
  const mutation = await executeSocialContentMutation<{task: SocialContentTaskDetail}>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(value),
    operation: 'confirm_social_replication_script',
    targetId: input.taskId,
    processingReceipt: { expectedVersion: value.expectedVersion, analysisId: value.analysisId,
      analysisHash: value.analysisHash, scriptHash: value.scriptHash },
    now: input.now,
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }),
    action: async operationId => {
      const record = await requireSocialTask(input);
      if (socialText(record.last_operation_id) === operationId) return { task: (await readSocialTaskDetail(input))! };
      assertVersion(record, value.expectedVersion);
      const brief = socialObject(socialJson(record.brief));
      if (brief?.creationMode !== 'viral_replication' || brief?.managementMode === 'one_click_managed') {
        throw new SocialContentWorkflowError('social_replication_script_review_not_applicable', 409);
      }
      const analysis = parseStoredSocialReferenceVideoAnalysis(record.reference_video_analysis);
      const script = parseStoredSocialReplicationScript(record.replication_script);
      if (!analysis || analysis.status !== 'ready' || analysis.analysisId !== value.analysisId
        || socialRequestHash(analysis) !== value.analysisHash) {
        throw new SocialContentWorkflowError('social_replication_script_review_analysis_changed', 409);
      }
      if (!script || script.referenceAnalysisId !== analysis.analysisId
        || socialReplicationScriptReviewHash(script) !== value.scriptHash) {
        throw new SocialContentWorkflowError('social_replication_script_review_script_changed', 409);
      }
      if (script.status !== 'review_required') {
        throw new SocialContentWorkflowError('social_replication_script_review_state_invalid', 409);
      }
      const detail = await readSocialTaskDetail(input);
      if (socialReplicationIdentityGaps(script, detail?.enterpriseProductBinding).length) {
        throw new SocialContentWorkflowError('social_replication_script_review_identity_unresolved', 409);
      }
      const expectedShotIds = script.shots.map(shot => shot.shotId);
      const decisionIds = value.sceneDecisions.map(item => item.shotId);
      if (new Set(decisionIds).size !== decisionIds.length
        || expectedShotIds.length !== decisionIds.length
        || expectedShotIds.some(id => !decisionIds.includes(id))) {
        throw new SocialContentWorkflowError('social_replication_script_review_scene_coverage_invalid', 409);
      }
      if (value.sceneDecisions.some(item => item.conclusion !== 'approved')) {
        throw new SocialContentWorkflowError('social_replication_script_review_rejected', 409);
      }
      const reviewedAt = (input.now ?? new Date()).toISOString();
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
        replication_script: { ...script, status: 'confirmed', review: {
          schemaVersion: 'social-replication-script-review.v1', analysisId: value.analysisId,
          analysisHash: value.analysisHash, scriptHash: value.scriptHash,
          sceneDecisions: value.sceneDecisions, evidence: value.reviewEvidence,
          reviewedBy: input.userId, reviewedAt,
        } },
        version: nextVersion(record), last_operation_id: operationId,
        updated_by: input.userId, updated_at: reviewedAt,
      });
      return { task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value.task;
}
