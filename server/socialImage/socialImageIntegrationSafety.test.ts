import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageDirectorReviewDecision, SocialImageProductionRuntime } from '../../shared/contracts/socialImageProduction.js';
import { auditCommercialClaims, userFacingPosterText } from '../lib/studioGenerationTruthfulness.js';
import { socialImageFrozenCommercialIssue, socialImageV3PaidPrerequisiteIssue } from './socialImagePaidPrerequisites.js';
import { socialImageDirectorReviewMatchesSet, resolveSocialImageReviewSet } from './socialImageReviewSet.js';
import { defaultSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

function candidateTask(): SocialImageCreationTask {
  const task = defaultSocialImageTask({ coreClaim: '产品展示', productRefs: ['product-a'] });
  task.id = 'image-task-a';
  task.schemaVersion = 'social-image-creation.v3';
  task.outputs = [{ id: 'candidate-a', role: 'single', label: '首版', state: 'quality_checking',
    version: 1, contentHash: 'a'.repeat(64), qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({
      key, verdict: 'pass', severity: 'hard', checker: 'deterministic', note: '已核验',
    })) }];
  return task;
}

function reviewedDecision(task: SocialImageCreationTask): SocialImageDirectorReviewDecision {
  const reviewSet = resolveSocialImageReviewSet(task, 'candidate-a', 1)!;
  return { schemaVersion: 'social-image-director-review.v1', decision: 'accept_for_user_review',
    candidateId: reviewSet.anchor.id, candidateVersion: reviewSet.anchor.version,
    candidateRefs: reviewSet.refs, candidateSetHash: reviewSet.contentHash,
    qualityEvidenceHash: reviewSet.qualityEvidenceHash, passedCriteria: [], failedCriteria: [],
    factorResults: [], problemRegions: [], reasonCodes: [], repairInstructions: [],
    reviewConfidence: 1, reviewedAt: '2026-10-24T00:00:00.000Z' };
}

test('director acceptance is bound to both single-image bytes and quality evidence', () => {
  const task = candidateTask();
  const decision = reviewedDecision(task);
  assert.equal(socialImageDirectorReviewMatchesSet(resolveSocialImageReviewSet(task, 'candidate-a', 1), decision), true);

  const changedBytes = structuredClone(task);
  changedBytes.outputs[0]!.contentHash = 'b'.repeat(64);
  assert.equal(socialImageDirectorReviewMatchesSet(resolveSocialImageReviewSet(changedBytes, 'candidate-a', 1), decision), false);

  const changedQuality = structuredClone(task);
  changedQuality.outputs[0]!.qualityChecks[0]!.note = '重新检查的证据';
  assert.equal(socialImageDirectorReviewMatchesSet(resolveSocialImageReviewSet(changedQuality, 'candidate-a', 1), decision), false);
});

test('any V3 output/preflight write retires the old director review even with unchanged pixels', async () => {
  const task = candidateTask();
  task.directorReviewDecision = reviewedDecision(task);
  const row: { id: string; tenant_id: string; spec: { socialImageTask: SocialImageCreationTask } } = {
    id: task.id, tenant_id: 'tenant-a', spec: { socialImageTask: task },
  };
  const store = {
    getById: async () => row,
    update: async (_collection: string, _id: string, data: Record<string, unknown>) => {
      Object.assign(row, data); return true;
    },
  } as unknown as DataStore;
  const updated = await updateSocialImageTask(store, 'tenant-a', task.id, task.version, {
    outputs: structuredClone(task.outputs), status: 'review_required', step: 'review',
  });
  assert.equal(updated.kind, 'updated');
  if (updated.kind === 'updated') assert.equal(updated.task.directorReviewDecision, undefined);
});

test('V3 frozen claims must replan rather than mutate a paid image request', () => {
  const unsupported = auditCommercialClaims(userFacingPosterText({ poster: {
    headline: 'Free samples guaranteed',
  }, imagePrompt: 'Show the offer' }), '公司名称：Aurelia');
  assert.equal(socialImageFrozenCommercialIssue({ ...unsupported,
    headline: 'Free samples guaranteed', imagePrompt: 'Show the offer' }),
  'social_image_frozen_commercial_claim_replan_required');
  const safe = auditCommercialClaims(userFacingPosterText({ poster: { headline: '产品 A' },
    imagePrompt: 'Present the product' }), '公司名称：Aurelia');
  assert.equal(socialImageFrozenCommercialIssue({ ...safe, headline: '产品 A', imagePrompt: 'Present the product' }), null);
  assert.equal(socialImageFrozenCommercialIssue({ ...safe, headline: '', imagePrompt: 'Present the product' }),
    'social_image_frozen_render_input_incomplete');
});

test('V3 paid admission rejects a second product outside the canonical ContentTask identity', () => {
  const task = candidateTask();
  task.contentBrief.productRefs = ['product-a', 'product-b'];
  task.productionRuntime = { binding: { productionRunId: task.id } } as unknown as SocialImageProductionRuntime;
  assert.equal(socialImageV3PaidPrerequisiteIssue(task, 'queue'), 'social_image_single_product_required');
});
