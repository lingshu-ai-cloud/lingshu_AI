import { hasSocialMeasuredMediaHardFailure, hasPassedVoiceDrivenVideoReview } from './socialContentGraphQualityGate.js';
import type { SocialContentTaskBrief } from '../../shared/contracts/socialContentWorkflow.js';
import {PRODUCTION_BUDGET_POLICY,productionBudgetDuration,productionBudgetLimitCny,productionBudgetMaximumCny,productionBudgetExceeded} from '../../shared/contracts/productionBudgetPolicy.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nonempty = (value: unknown) => Array.isArray(value) && value.length > 0;

export interface SocialContentReleaseQualityInput {
  tenantId?: string;
  brief: SocialContentTaskBrief;
  content: unknown;
  mode: 'human' | 'managed';
}

/** Human review may judge subjective fidelity, never missing identity, rights,
 * enterprise-fact, timeline, technical or budget evidence. */
export function inspectSocialContentReleaseQuality(input: SocialContentReleaseQualityInput): {
  approved: boolean; applicable: boolean; failures: string[];
} {
  const content = object(input.content);
  const applicable = content.workflowSchema === 'social-content.auto-production.v3';
  if (!applicable) return { approved: true, applicable: false, failures: [] };
  const failures: string[] = [];
  if (input.brief.materialRoutingPolicyVersion === 'type-aware.v3'
    && !hasPassedVoiceDrivenVideoReview(content.technicalQualityReport, object(content.productionWorkspaceSource).outputSha256))
    failures.push('voice_driven_quality_unverified');
  if(content.testOnly===true||content.publishable===false)failures.push('test_input_not_publishable');
  if(input.brief.presenterSpeechReviewPolicy==='heygen_native_human_review'){
    const speech=object(content.presenterSpeechReview);
    if(speech.policy!=='heygen_native_human_review'||speech.provider!=='heygen'||speech.status!=='pending_human_review'||speech.automatedLipSyncPassed!==false)failures.push('presenter_human_review_evidence_missing');
    if(input.mode==='managed')failures.push('presenter_human_review_required');
  }
  const result = object(content.productionResult), technical = object(result.technicalReview);
  const creative = object(result.creativeReview), render = object(content.render);
  if (technical.approved !== true || nonempty(technical.failures)
    || render.qualityPassed !== true || render.audioDecoded !== true || render.completed !== true) failures.push('technical_failed');
  if (creative.approved !== true || nonempty(creative.failedCriteria)) failures.push('creative_failed');
  if (!Array.isArray(technical.failures) || !Array.isArray(creative.failedCriteria)) failures.push('quality_evidence_missing');
  if (hasSocialMeasuredMediaHardFailure(object(content.technicalQualityReport).mediaHardProbe)) failures.push('measured_media_hard_failure');
  if (object(content.delivery).status === 'requires_revision'
    || object(content.delivery).status === 'concept_preview') failures.push('delivery_not_ready');
  const cost=object(content.costSummary),evidence=object(cost.productionBudget);
  const limit=productionBudgetMaximumCny(input.brief);
  const estimated=cost.estimatedBeforeGenerationCny;
  const recorded=[cost.recordedProviderCostCny,cost.recordedProviderEstimatedCostCny].filter(amount);
  const invalidRecorded=[cost.recordedProviderCostCny,cost.recordedProviderEstimatedCostCny].some(value=>value!=null&&!amount(value));
  if(!amount(estimated)||!recorded.length||invalidRecorded||cost.currency!=='CNY')failures.push('budget_evidence_missing');
  else if([estimated,...recorded].some(value=>productionBudgetExceeded(value,limit)))failures.push('budget_exceeded');
  if(cost.productionBudget!=null){
    if(evidence.policyVersion!==PRODUCTION_BUDGET_POLICY||!amount(evidence.retainedCny)
      ||!amount(evidence.maximumCny)||evidence.maximumCny<=0||!amount(evidence.acquisitionCny)
      ||!amount(evidence.durationSeconds)||evidence.durationSeconds<=0)failures.push('budget_evidence_missing');
    else if(productionBudgetExceeded(evidence.maximumCny,limit)
      ||productionBudgetExceeded(evidence.retainedCny,Math.min(limit,evidence.maximumCny)))failures.push('budget_exceeded');
  }
  // Basic media acceptance is independent of how a film was conceived. Only
  // reference-specific evidence belongs to the single-source fidelity branch.
  if (input.brief.materialRoutingPolicyVersion === 'type-aware.v3' || input.brief.referenceMode !== 'single_source_fidelity') {
    return { approved: failures.length === 0, applicable: true, failures };
  }
  const replication = object(content.replicationEvaluation);
  if (!['passed', 'review_required'].includes(String(replication.status))
    || !['passed', 'review_required'].includes(String(object(replication.viralFactorFidelity).status)))
    failures.push('reference_fidelity_evidence_missing_or_failed');
  const timeline = object(replication.referenceTimelineAudit);
  if (timeline.fullCoverageValidated !== true || !Number.isInteger(timeline.referenceShotCount)
    || Number(timeline.referenceShotCount) < 1 || timeline.outputShotCount !== timeline.referenceShotCount
    || !amount(timeline.referenceDurationSeconds) || timeline.referenceDurationSeconds <= 0) failures.push('reference_timeline_incomplete');
  const dimensions = ['viralFactorFidelity', 'identityReplacement', 'originalityDifference', 'unauthorizedReuseRisk', 'accountAndFactFit'];
  if (!['passed', 'not_applicable'].includes(String(object(replication.identityReplacement).status))) failures.push('identity_evidence_incomplete');
  if (['originalityDifference', 'unauthorizedReuseRisk', 'accountAndFactFit']
    .some(key => !['passed', 'not_applicable'].includes(String(object(replication[key]).status))))
    failures.push('rights_or_enterprise_fact_evidence_incomplete');
  if (dimensions.some(key => !['passed', 'not_applicable', 'review_required', 'failed'].includes(String(object(replication[key]).status)))) failures.push('replication_evidence_missing');
  if (dimensions.some(key => object(replication[key]).status === 'failed')
    || object(replication.directorDecision).status === 'changes_required'
    || nonempty(object(replication.directorDecision).failedCriteria)) failures.push('replication_failed');
  if (input.mode === 'managed' && (technical.approved !== true || creative.approved !== true
    || render.completed !== true || render.qualityPassed !== true || render.audioDecoded !== true
    || replication.status !== 'passed'
    || dimensions.some(key => !['passed', 'not_applicable'].includes(String(object(replication[key]).status))))) failures.push('managed_quality_incomplete');
  return { approved: failures.length === 0, applicable: true, failures };
}

export function assertSocialContentReleaseQuality(input: SocialContentReleaseQualityInput): void {
  const review = inspectSocialContentReleaseQuality(input);
  if (!review.approved) throw new Error(`social_artifact_release_quality_failed:${review.failures.join(',')}`);
}
